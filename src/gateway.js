import http from "node:http";
import { URL } from "node:url";

const env = loadEnvFile(".env", process.env);

const host = env.GATEWAY_HOST || "127.0.0.1";
const port = Number(env.GATEWAY_PORT || 8787);
const gatewayApiKey = env.GATEWAY_API_KEY || "";
const upstreamBaseUrl = trimTrailingSlash(env.UPSTREAM_BASE_URL || "");
const upstreamApiKey = env.UPSTREAM_API_KEY || "";
const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS || 120000);
const models = parseModels(env.GATEWAY_MODELS || "dev-fast,dev-balanced,dev-best");
const modelMap = parseModelMap(env.GATEWAY_MODEL_MAP || "");
const defaultTemperature = parseOptionalNumber(env.GATEWAY_DEFAULT_TEMPERATURE);

export const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: {
        message: error instanceof Error ? error.message : "Internal server error",
        type: "gateway_error"
      }
    });
  }
});

server.listen(port, host, () => {
  console.log(`OpenCode intranet gateway listening on http://${host}:${port}/v1`);
  console.log(upstreamBaseUrl ? `Proxy mode: ${upstreamBaseUrl}` : "Mock mode: no UPSTREAM_BASE_URL configured");
});

async function route(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, {
      error: {
        message: "Missing or invalid gateway API key",
        type: "authentication_error"
      }
    });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return sendJson(res, 200, {
      object: "list",
      data: models.map((id) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "intranet"
      }))
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    const body = await readJson(req);
    if (upstreamBaseUrl) {
      return proxyChatCompletion(body, res);
    }
    return mockChatCompletion(body, res);
  }

  return sendJson(res, 404, {
    error: {
      message: `Unsupported endpoint: ${req.method} ${url.pathname}`,
      type: "not_found"
    }
  });
}

async function proxyChatCompletion(body, res) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), upstreamTimeoutMs);
  const upstreamBody = mapUpstreamBody(body);

  try {
    const upstreamRes = await fetch(`${upstreamBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(upstreamApiKey ? { authorization: `Bearer ${upstreamApiKey}` } : {})
      },
      body: JSON.stringify(upstreamBody),
      signal: controller.signal
    });

    res.statusCode = upstreamRes.status;
    for (const [key, value] of upstreamRes.headers.entries()) {
      if (!["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    }

    if (!upstreamRes.body) {
      return res.end();
    }

    for await (const chunk of upstreamRes.body) {
      res.write(chunk);
    }
    res.end();
  } finally {
    clearTimeout(timeout);
  }
}

function mapUpstreamBody(body) {
  const next = { ...body };
  if (typeof next.model === "string" && modelMap[next.model]) {
    next.model = modelMap[next.model];
  }
  if (defaultTemperature !== undefined && next.temperature === undefined) {
    next.temperature = defaultTemperature;
  }
  return next;
}

function mockChatCompletion(body, res) {
  const model = body.model || models[0];
  const userText = lastUserText(body.messages);
  const content = [
    "这是内网 OpenCode gateway 的 mock 响应。",
    `模型: ${model}`,
    userText ? `收到: ${userText}` : "没有收到 user 消息。",
    "把 .env 里的 UPSTREAM_BASE_URL 配成真实内网模型服务后，这里会转发到真实模型。"
  ].join("\n");

  if (body.stream) {
    return sendMockStream(res, model, content);
  }

  return sendJson(res, 200, {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: estimateTokens(JSON.stringify(body.messages || [])),
      completion_tokens: estimateTokens(content),
      total_tokens: estimateTokens(JSON.stringify(body.messages || [])) + estimateTokens(content)
    }
  });
}

function sendMockStream(res, model, content) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  const id = `chatcmpl-${Date.now()}`;
  for (const part of splitForStream(content)) {
    res.write(`data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta: { content: part },
          finish_reason: null
        }
      ]
    })}\n\n`);
  }

  res.write(`data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop"
      }
    ]
  })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function isAuthorized(req) {
  if (!gatewayApiKey) {
    return true;
  }
  const authorization = req.headers.authorization || "";
  return authorization === `Bearer ${gatewayApiKey}`;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function lastUserText(messages) {
  if (!Array.isArray(messages)) {
    return "";
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== "user") {
      continue;
    }
    return normalizeContent(message.content);
  }
  return "";
}

function normalizeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        return part?.text || "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function splitForStream(text) {
  const parts = [];
  for (let i = 0; i < text.length; i += 24) {
    parts.push(text.slice(i, i + 24));
  }
  return parts;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text).length / 4));
}

function parseModels(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseModelMap(value) {
  const result = {};
  for (const pair of value.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }
    const alias = trimmed.slice(0, index).trim();
    const upstream = trimmed.slice(index + 1).trim();
    if (alias && upstream) {
      result[alias] = upstream;
    }
  }
  return result;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function loadEnvFile(path, baseEnv) {
  const env = { ...baseEnv };
  try {
    const fs = awaitImportFs();
    if (!fs.existsSync(path)) {
      return env;
    }
    const raw = fs.readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const index = trimmed.indexOf("=");
      if (index === -1) {
        continue;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!(key in env)) {
        env[key] = stripQuotes(value);
      }
    }
  } catch {
    return env;
  }
  return env;
}

function awaitImportFs() {
  // Keep this file dependency-free while still allowing optional .env loading.
  return process.getBuiltinModule("fs");
}

function stripQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
