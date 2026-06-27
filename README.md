# OpenCode Intranet Starter

这是一个最小可运行版本，用来验证 OpenCode 连接内网大模型的链路。

当前包含：

- 一个不依赖第三方 npm 包的 OpenAI-compatible gateway
- 一个 OpenCode 配置模板
- Windows PowerShell 启动脚本
- mock 模式，方便在没有真实模型服务时先跑通

## 1. 启动 mock 网关

```powershell
npm run start:gateway
```

默认监听：

```text
http://127.0.0.1:8787/v1
```

测试模型列表：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/v1/models -Headers @{Authorization="Bearer dev-key"}
```

测试聊天：

```powershell
$body = @{
  model = "dev-balanced"
  messages = @(@{ role = "user"; content = "hello" })
  stream = $false
} | ConvertTo-Json -Depth 8

Invoke-RestMethod http://127.0.0.1:8787/v1/chat/completions `
  -Method Post `
  -ContentType "application/json" `
  -Headers @{Authorization="Bearer dev-key"} `
  -Body $body
```

## 2. 连接真实内网模型

复制环境变量模板：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`，设置：

```text
UPSTREAM_BASE_URL=http://你的内网模型服务/v1
UPSTREAM_API_KEY=你的内网模型服务密钥
```

然后用脚本启动：

```powershell
.\scripts\start-gateway.ps1
```

如果 `UPSTREAM_BASE_URL` 为空，网关自动使用 mock 模式。

## 3. OpenCode 配置

当前仓库根目录已经包含 `opencode.json`，OpenCode 在这个目录启动时会直接读取。

关键配置：

```json
{
  "provider": {
    "intranet": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Intranet LLM",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "{env:INTRANET_LLM_API_KEY}"
      }
    }
  }
}
```

启动 OpenCode 前设置：

```powershell
$env:INTRANET_LLM_API_KEY = "dev-key"
opencode
```

内置 agent 和 command 位于：

```text
.opencode/agents/reviewer.md
.opencode/agents/security.md
.opencode/commands/review.md
```

## 4. 后续二开方向

建议下一步加：

- 企业权限策略插件
- 审计日志插件
- GitLab/Jira/Wiki MCP
- 模型路由规则
- 内网安装包和版本锁定
