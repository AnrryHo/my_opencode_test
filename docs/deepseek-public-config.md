# Public DeepSeek Temporary Backend

This document explains how to use the public DeepSeek API as a temporary backend when your personal computer cannot connect to the company intranet.

The recommended path is:

```text
OpenCode
  -> local gateway at http://127.0.0.1:8787/v1
  -> public DeepSeek API
```

This keeps the OpenCode side the same as the future intranet setup. When the company intranet model is available, only `.env` needs to change.

## 1. Get a DeepSeek API key

Create an API key in the DeepSeek platform, then keep it local. Do not commit it.

Official docs:

- https://api-docs.deepseek.com/
- https://api-docs.deepseek.com/quick_start/pricing

As of 2026-06-27, the official DeepSeek docs list:

```text
Base URL: https://api.deepseek.com
Models: deepseek-v4-flash, deepseek-v4-pro
```

## 2. Create `.env`

From the project root:

```powershell
Copy-Item .env.deepseek.example .env
```

Edit `.env`:

```text
UPSTREAM_API_KEY=your-real-deepseek-api-key
```

Keep:

```text
UPSTREAM_BASE_URL=https://api.deepseek.com
GATEWAY_MODEL_MAP=dev-fast=deepseek-v4-flash,dev-balanced=deepseek-v4-flash,dev-best=deepseek-v4-pro
```

Do not add `/v1` to the DeepSeek base URL unless DeepSeek changes its official API format.

## 3. Start the gateway

```powershell
npm run start:gateway
```

Or:

```powershell
.\scripts\start-gateway.ps1
```

The gateway listens on:

```text
http://127.0.0.1:8787/v1
```

## 4. Test the gateway

Model list:

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/models `
  -Headers @{Authorization="Bearer dev-key"}
```

Chat completion:

```powershell
$body = @{
  model = "dev-balanced"
  messages = @(@{ role = "user"; content = "用一句话介绍 OpenCode" })
  stream = $false
} | ConvertTo-Json -Depth 8

Invoke-RestMethod http://127.0.0.1:8787/v1/chat/completions `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{Authorization="Bearer dev-key"} `
  -Body $body
```

If this works, OpenCode can use the same gateway.

## 5. Start OpenCode

In a second terminal:

```powershell
.\scripts\start-opencode.ps1
```

The existing `opencode.json` already points OpenCode to:

```text
http://127.0.0.1:8787/v1
```

You can also start OpenCode manually:

```powershell
$env:INTRANET_LLM_API_KEY = "dev-key"
opencode
```

## 6. Model alias behavior

OpenCode uses stable aliases:

```text
dev-fast
dev-balanced
dev-best
```

The gateway translates them before sending requests to DeepSeek:

```text
dev-fast      -> deepseek-v4-flash
dev-balanced  -> deepseek-v4-flash
dev-best      -> deepseek-v4-pro
```

If you want all tasks to use the stronger model temporarily:

```text
GATEWAY_MODEL_MAP=dev-fast=deepseek-v4-pro,dev-balanced=deepseek-v4-pro,dev-best=deepseek-v4-pro
```

## 7. Security notes

- `.env` is ignored by git.
- `GATEWAY_API_KEY` is only the local key between OpenCode and the gateway.
- `UPSTREAM_API_KEY` is your real DeepSeek key.
- Public DeepSeek means prompts and code snippets leave your computer. Do not use it for company confidential code unless your company permits it.
