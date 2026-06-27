# OpenCode 项目文件说明

本文档说明当前项目中为 OpenCode 内网/公网临时模型接入生成的文件作用，以及核心代码的职责。

## 1. 项目目标

当前项目是一个 OpenCode 二次开发 starter，用于验证以下链路：

```text
OpenCode
  -> 本地 OpenAI-compatible gateway
  -> 内网大模型或公网 DeepSeek 临时模型
```

设计原则：

- OpenCode 只连接本地 gateway。
- gateway 再决定转发到内网模型、公网 DeepSeek，或者使用 mock 响应。
- 以后从公网 DeepSeek 切回公司内网模型时，尽量只改 `.env`，不改 OpenCode 配置。

## 2. 根目录文件

### `package.json`

Node.js 项目描述文件。

当前主要作用：

- 声明项目名和 Node 版本要求。
- 提供启动 gateway 的命令。
- 提供 JS 语法检查命令。

关键脚本：

```json
{
  "start:gateway": "node src/gateway.js",
  "check": "node --check src/gateway.js"
}
```

常用命令：

```powershell
npm run start:gateway
npm run check
```

### `opencode.json`

OpenCode 项目配置文件。OpenCode 在当前项目根目录启动时会读取它。

主要作用：

- 定义名为 `intranet` 的模型 provider。
- 将 OpenCode 请求指向本地 gateway：`http://127.0.0.1:8787/v1`。
- 设置默认模型：`intranet/dev-balanced`。
- 设置小模型：`intranet/dev-fast`。
- 设置基础权限策略。

核心配置：

```json
{
  "model": "intranet/dev-balanced",
  "small_model": "intranet/dev-fast"
}
```

这里的 `dev-fast`、`dev-balanced`、`dev-best` 是 gateway 对外暴露的稳定模型别名，不一定是真实模型名。

### `.env.example`

通用环境变量模板。

适合以下场景：

- 本地 mock 测试。
- 未来接公司内网模型。
- 作为 `.env` 的基础模板。

关键变量：

```text
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=8787
GATEWAY_API_KEY=dev-key
GATEWAY_MODELS=dev-fast,dev-balanced,dev-best
UPSTREAM_BASE_URL=
UPSTREAM_API_KEY=
```

当 `UPSTREAM_BASE_URL` 为空时，gateway 使用 mock 模式。

### `.env.deepseek.example`

公网 DeepSeek 临时环境模板。

适合个人电脑连接不了公司内网时使用。

关键配置：

```text
UPSTREAM_BASE_URL=https://api.deepseek.com
UPSTREAM_API_KEY=replace-with-your-deepseek-api-key
GATEWAY_MODEL_MAP=dev-fast=deepseek-v4-flash,dev-balanced=deepseek-v4-flash,dev-best=deepseek-v4-pro
```

使用方式：

```powershell
Copy-Item .env.deepseek.example .env
```

然后把 `.env` 里的 `UPSTREAM_API_KEY` 改成真实 DeepSeek API Key。

### `.gitignore`

Git 忽略规则。

主要避免提交：

- `.env` 密钥文件。
- `node_modules/` 依赖目录。
- 运行日志。
- 系统临时文件。

### `README.md`

项目快速启动说明。

包含：

- mock gateway 启动方式。
- gateway API 测试命令。
- 连接真实内网模型的方式。
- OpenCode 启动方式。
- 后续二开方向。

## 3. `src/` 目录

### `src/gateway.js`

本项目的核心代码，实现一个最小 OpenAI-compatible gateway。

它的职责：

- 监听本地 HTTP 服务。
- 暴露 `/v1/models`。
- 暴露 `/v1/chat/completions`。
- 校验本地 gateway API key。
- 在没有上游模型时返回 mock 响应。
- 在配置上游模型后代理请求。
- 支持模型别名映射。
- 支持默认 temperature 注入。
- 支持流式 mock 响应。

启动后默认监听：

```text
http://127.0.0.1:8787/v1
```

### 核心变量

```js
const env = loadEnvFile(".env", process.env);
```

读取 `.env` 和当前进程环境变量。

```js
const host = env.GATEWAY_HOST || "127.0.0.1";
const port = Number(env.GATEWAY_PORT || 8787);
```

控制 gateway 监听地址。

```js
const gatewayApiKey = env.GATEWAY_API_KEY || "";
```

本地 gateway 认证 key。OpenCode 使用的是这个 key，不是 DeepSeek 或内网模型的真实 key。

```js
const upstreamBaseUrl = trimTrailingSlash(env.UPSTREAM_BASE_URL || "");
const upstreamApiKey = env.UPSTREAM_API_KEY || "";
```

上游模型地址和密钥。

如果 `UPSTREAM_BASE_URL` 为空，gateway 进入 mock 模式。

```js
const models = parseModels(env.GATEWAY_MODELS || "dev-fast,dev-balanced,dev-best");
```

定义 gateway 对 OpenCode 暴露的模型别名。

```js
const modelMap = parseModelMap(env.GATEWAY_MODEL_MAP || "");
```

定义模型别名到真实模型名的映射。

例如：

```text
dev-balanced=deepseek-v4-flash
```

### HTTP server

```js
export const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    ...
  }
});
```

创建 HTTP 服务，并把所有请求交给 `route()` 处理。

`export const server` 的作用是方便测试脚本导入后正常关闭服务。

### `route(req, res)`

请求路由函数。

处理规则：

```text
GET  /health               -> 健康检查
GET  /v1/models            -> 返回模型列表
POST /v1/chat/completions  -> 聊天补全
其他路径                   -> 404
```

`/v1/chat/completions` 的处理逻辑：

```text
如果配置了 UPSTREAM_BASE_URL
  -> 调用 proxyChatCompletion()
否则
  -> 调用 mockChatCompletion()
```

### `proxyChatCompletion(body, res)`

代理真实模型请求。

主要流程：

1. 创建超时控制器。
2. 调用 `mapUpstreamBody()` 转换请求体。
3. 请求 `${UPSTREAM_BASE_URL}/chat/completions`。
4. 复制上游响应状态码和 headers。
5. 将上游响应流原样转发给 OpenCode。

这个函数支持普通响应和流式响应，因为它直接转发上游 body。

### `mapUpstreamBody(body)`

请求体转换函数。

主要作用：

- 把 OpenCode 使用的模型别名转换成真实上游模型名。
- 如果 OpenCode 没有传 `temperature`，可注入默认值。

示例：

```text
OpenCode 请求: model=dev-balanced
gateway 转换: model=deepseek-v4-flash
```

### `mockChatCompletion(body, res)`

mock 模式响应函数。

当 `.env` 中没有配置 `UPSTREAM_BASE_URL` 时使用。

主要作用：

- 让项目不接真实模型也能启动。
- 方便先验证 OpenCode -> gateway 链路。
- 返回 OpenAI-compatible 格式的响应。

### `sendMockStream(res, model, content)`

mock 流式输出函数。

当请求体里 `stream=true` 时，返回 SSE 格式响应：

```text
data: {...}

data: {...}

data: [DONE]
```

用于模拟真实大模型的流式输出体验。

### `isAuthorized(req)`

本地 gateway 鉴权函数。

逻辑：

```text
如果 GATEWAY_API_KEY 为空
  -> 不做鉴权
否则
  -> 要求 Authorization: Bearer <GATEWAY_API_KEY>
```

### `readJson(req)`

读取 HTTP 请求体，并解析为 JSON。

### `lastUserText(messages)` 和 `normalizeContent(content)`

从 OpenAI-compatible messages 中提取最后一条 user 消息。

mock 模式会用它生成测试响应。

### `parseModels(value)`

解析模型列表。

示例：

```text
dev-fast,dev-balanced,dev-best
```

会解析为：

```js
["dev-fast", "dev-balanced", "dev-best"]
```

### `parseModelMap(value)`

解析模型别名映射。

示例：

```text
dev-fast=deepseek-v4-flash,dev-best=deepseek-v4-pro
```

会解析为：

```js
{
  "dev-fast": "deepseek-v4-flash",
  "dev-best": "deepseek-v4-pro"
}
```

### `loadEnvFile(path, baseEnv)`

读取 `.env` 文件。

设计上不依赖 `dotenv` 包，原因是当前项目要兼容内网和离线环境，减少 npm 依赖。

## 4. `scripts/` 目录

### `scripts/start-gateway.ps1`

Windows PowerShell 启动脚本。

主要作用：

- 读取项目根目录 `.env`。
- 将 `.env` 内容写入当前进程环境变量。
- 启动 `src/gateway.js`。

使用：

```powershell
.\scripts\start-gateway.ps1
```

也可以直接使用：

```powershell
npm run start:gateway
```

区别：

- `start-gateway.ps1` 会显式读取 `.env`。
- `npm run start:gateway` 依赖 `gateway.js` 自己读取 `.env`。

### `scripts/start-opencode.ps1`

Windows PowerShell 启动 OpenCode 的辅助脚本。

主要作用：

- 读取项目根目录 `.env`。
- 如果没有设置 `INTRANET_LLM_API_KEY`，则自动使用 `GATEWAY_API_KEY`。
- 启动 `opencode`。

为什么需要它：

`opencode.json` 中使用：

```text
{env:INTRANET_LLM_API_KEY}
```

OpenCode 需要从环境变量读取 key。这个脚本可以自动把 `.env` 里的 `GATEWAY_API_KEY` 传给 OpenCode。

使用：

```powershell
.\scripts\start-opencode.ps1
```

## 5. `.opencode/` 目录

### `.opencode/agents/reviewer.md`

OpenCode 代码审查 agent。

职责：

- 审查代码正确性。
- 查找行为回归。
- 检查安全风险。
- 检查测试缺失。
- 避免只做格式类评论。

适合被 `/review` 命令调用。

### `.opencode/agents/security.md`

OpenCode 安全审查 agent。

职责：

- 检查密钥泄露。
- 检查不安全 shell 执行。
- 检查路径穿越。
- 检查 SSRF 和异常外网访问。
- 检查 SQL 注入。
- 检查过宽文件权限。

### `.opencode/commands/review.md`

OpenCode 自定义命令。

职责：

- 提供 `/review` 命令。
- 调用 `reviewer` agent。
- 要求按严重程度输出问题。

使用方式：

```text
/review
```

## 6. `docs/` 目录

### `docs/opencode-intranet-plan.md`

OpenCode 内网二次开发总体方案。

内容包括：

- 背景与目标。
- 总体架构。
- 模型接入方案。
- 权限与安全设计。
- 审计设计。
- MCP 设计。
- Agent 设计。
- 离线部署方案。
- MVP 里程碑。

### `docs/deepseek-public-config.md`

公网 DeepSeek 临时后端配置说明。

内容包括：

- 为什么用本地 gateway 代理 DeepSeek。
- 如何创建 `.env`。
- 如何启动 gateway。
- 如何测试 `/v1/models` 和 `/v1/chat/completions`。
- 如何启动 OpenCode。
- DeepSeek 模型别名映射说明。
- 安全注意事项。

### `docs/OpenCode项目文件说明.md`

当前文档。

用于解释本项目各文件作用和核心代码作用。

## 7. 启动链路

### mock 模式

不需要真实模型。

```powershell
npm run start:gateway
```

另开终端：

```powershell
.\scripts\start-opencode.ps1
```

链路：

```text
OpenCode -> 本地 gateway -> mock 响应
```

### 公网 DeepSeek 临时模式

```powershell
Copy-Item .env.deepseek.example .env
```

编辑 `.env`：

```text
UPSTREAM_API_KEY=你的 DeepSeek API Key
```

启动：

```powershell
npm run start:gateway
```

另开终端：

```powershell
.\scripts\start-opencode.ps1
```

链路：

```text
OpenCode -> 本地 gateway -> 公网 DeepSeek
```

### 公司内网模型模式

编辑 `.env`：

```text
UPSTREAM_BASE_URL=http://公司内网模型服务/v1
UPSTREAM_API_KEY=公司内网模型 key
GATEWAY_MODEL_MAP=dev-fast=真实快速模型,dev-balanced=真实日常模型,dev-best=真实高质量模型
```

链路：

```text
OpenCode -> 本地 gateway -> 公司内网模型
```

## 8. 命名规则

已经写入 OpenCode 全局规则：

```text
生成文档时，文档文件名默认使用中文；仅当名称包含产品名、协议名、专有技术名、代码包名等特有英文名词时保留英文。
```

因此后续新增文档时，默认使用中文文件名。例如：

```text
部署说明.md
模型网关设计.md
OpenCode项目文件说明.md
DeepSeek临时配置说明.md
```

