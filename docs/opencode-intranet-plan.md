# OpenCode 内网二次开发方案

## 1. 背景与目标

背景：

- 企业已经在内网部署了中国国内大模型或自研大模型。
- 希望基于 OpenCode 二次开发，连接内网模型，建设类似 Claude Code 的编码助手。
- 使用环境不能访问公网，只能访问企业内网。

目标：

- 用 OpenCode 作为 agent runtime。
- 用企业模型网关适配内网大模型。
- 用 MCP 接入企业内网系统。
- 用权限、审计、策略插件满足企业安全要求。
- 优先避免深度 fork，先基于配置、插件、MCP、SDK 和 Server 做产品化封装。

## 2. 总体架构

```text
开发者机器 / 内网 CI
        |
        v
企业版 OpenCode CLI / TUI / IDE 集成
        |
        v
OpenCode 配置 / Agents / Commands / Plugins
        |
        v
企业模型网关 OpenAI-compatible API
        |
        v
内网大模型集群
Qwen / DeepSeek / Kimi / GLM / 自研模型 / vLLM / SGLang / Ollama
```

辅助系统：

```text
MCP Servers
├─ GitLab / GitHub Enterprise
├─ Jira / TAPD / 禅道
├─ Wiki / Confluence / 飞书文档 / 语雀
├─ Jenkins / GitLab CI
├─ 数据库 Schema
└─ 内网制品库 / 漏洞库 / 规范库

企业治理层
├─ 权限策略
├─ 审计日志
├─ 模型路由
├─ 成本统计
├─ 敏感信息扫描
└─ 离线安装包管理
```

## 3. 当前最小可运行版本

本项目当前已经包含一个 starter：

```text
.
├─ src/gateway.js
├─ scripts/start-gateway.ps1
├─ opencode.json
├─ .opencode/
│  ├─ agents/
│  │  ├─ reviewer.md
│  │  └─ security.md
│  └─ commands/
│     └─ review.md
├─ .env.example
├─ package.json
└─ README.md
```

能力：

- 提供 OpenAI-compatible `/v1/models`。
- 提供 OpenAI-compatible `/v1/chat/completions`。
- 支持 mock 模式。
- 支持代理到真实内网模型服务。
- 提供 OpenCode 项目配置。
- 提供基础 reviewer 和 security agent。
- 提供 `/review` 命令。

启动 mock 网关：

```powershell
npm run start:gateway
```

启动 OpenCode：

```powershell
$env:INTRANET_LLM_API_KEY = "dev-key"
opencode
```

接入真实内网模型：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```text
UPSTREAM_BASE_URL=http://你的内网模型服务/v1
UPSTREAM_API_KEY=你的内网模型服务密钥
```

再启动：

```powershell
.\scripts\start-gateway.ps1
```

## 4. 模型接入方案

不要让 OpenCode 直接适配每个模型。建议建设一个统一的企业模型网关。

对外协议：

```text
GET  /v1/models
POST /v1/chat/completions
```

可选增强：

```text
POST /v1/responses
POST /v1/embeddings
GET  /health
GET  /metrics
```

网关内部路由：

```text
dev-fast       -> 便宜快速模型
dev-balanced   -> 日常编码模型
dev-best       -> 高质量复杂任务模型
review-strict  -> 审查和安全模型
```

推荐不要在 OpenCode 配置里暴露真实模型名，而是使用模型别名。这样以后调整模型不会影响客户端配置。

OpenCode provider 示例：

```json
{
  "provider": {
    "intranet": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Intranet LLM",
      "options": {
        "baseURL": "http://127.0.0.1:8787/v1",
        "apiKey": "{env:INTRANET_LLM_API_KEY}"
      },
      "models": {
        "dev-fast": {
          "name": "Dev Fast"
        },
        "dev-balanced": {
          "name": "Dev Balanced"
        },
        "dev-best": {
          "name": "Dev Best"
        }
      }
    }
  },
  "model": "intranet/dev-balanced",
  "small_model": "intranet/dev-fast"
}
```

模型网关需要重点支持：

- 流式输出。
- tool calling。
- 长上下文。
- 结构化 JSON 输出。
- token usage 返回。
- 请求超时和重试。
- 用户、项目、session 维度的限流。
- 模型别名路由。

## 5. 对标 Claude Code 的功能拆解

| 能力 | OpenCode 二开实现 |
|---|---|
| 终端编码助手 | OpenCode CLI / TUI |
| 自动读写文件 | OpenCode 原生工具和权限配置 |
| 执行命令 | bash permission 和企业策略插件 |
| 多 agent | `.opencode/agents` |
| 自定义命令 | `.opencode/commands` |
| 项目记忆 | AGENTS.md、规则文件、企业知识库 MCP |
| 企业知识库 | MCP servers |
| 私有模型 | OpenAI-compatible provider + 企业模型网关 |
| PR 审查 | GitLab/GitHub MCP + `/review` 命令 |
| CI 修复 | CI MCP + `/fix-ci` 命令 |
| 企业审计 | OpenCode plugin + 审计服务 |
| 成本统计 | 模型网关 usage + 审计数据库 |

建议内置命令：

```text
/review        自动代码审查
/fix-ci        分析 CI 失败并修复
/write-tests   自动补测试
/explain       解释模块
/refactor      受控重构
/security      安全扫描
/doc           生成接口或模块文档
/migrate       框架升级或依赖迁移
```

## 6. 权限与安全设计

建议默认权限保守：

```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "rm -rf *": "deny",
      "del /s *": "deny",
      "curl http*": "ask",
      "wget http*": "ask"
    },
    "edit": "ask",
    "webfetch": "deny"
  }
}
```

企业策略插件应覆盖：

```text
危险命令拦截:
rm -rf
del /s
format
curl 外网
wget 外网
ssh 未授权主机
npm install 公网包
pip install 公网包

敏感文件保护:
.env
*.pem
*.key
id_rsa
config/production.yaml
数据库连接串
密钥和 token

目录边界:
默认只允许当前 repo
禁止读取用户主目录敏感目录
禁止写系统目录
```

建议将 OpenCode action 交给策略引擎判定：

```text
OpenCode action
    |
    v
Policy Engine
    |
    +-- allow
    +-- ask
    +-- deny
    +-- require approval
```

## 7. 审计设计

审计日志至少记录：

```text
用户
项目
session id
模型
prompt 摘要
读取文件路径
修改文件路径
执行命令
命令结果摘要
token 用量
审批记录
最终 diff 摘要
```

不建议默认保存完整源码和完整 prompt。更稳的方案：

- 保存路径、hash、diff 摘要和必要片段。
- 对密钥和 token 做脱敏。
- 对日志设定保留周期。
- 对高风险操作记录审批人和审批时间。

推荐存储：

```text
PostgreSQL: session、用户、项目、审批、成本
ClickHouse: 大规模操作日志和指标
对象存储: 可选，保存脱敏后的长日志
```

## 8. MCP 设计

Claude Code 体验的关键之一是能理解项目和上下文。内网版应通过 MCP 接入企业系统。

建议优先建设：

```text
gitlab-mcp      读取 MR、issue、commit、pipeline
wiki-mcp        读取内部文档、规范、设计方案
jira-mcp        读取需求、缺陷、验收标准
api-mcp         读取 OpenAPI / Swagger
db-schema-mcp   读取数据库表结构
ci-mcp          读取 Jenkins / GitLab CI 日志
artifact-mcp    查询内网制品版本
security-mcp    查询漏洞库和合规规则
```

原则：

- 不允许 agent 直接访问公网。
- 所有外部上下文都通过受控 MCP server 进入。
- MCP server 做权限校验和日志记录。
- MCP 返回内容要做裁剪，避免一次塞入过大上下文。

## 9. Agent 设计

建议内置：

```text
architect      架构分析、模块边界、方案设计
coder          常规编码
reviewer       代码审查
tester         单测和集成测试生成
security       安全审计
devops         CI/CD、Docker、部署脚本
doc-writer     文档生成
migration      框架升级和重构
```

模型绑定建议：

```text
coder      -> dev-balanced
reviewer   -> review-strict
tester     -> dev-fast
architect  -> dev-best
security   -> review-strict
```

这样可以在质量、速度和成本之间做平衡。

## 10. 离线部署方案

由于使用环境不能访问公网，需要提供离线安装包。

建议交付结构：

```text
opencode-enterprise/
├─ bin/
│  ├─ opencode.exe
│  └─ oce.exe
├─ config/
│  ├─ opencode.json
│  ├─ agents/
│  ├─ commands/
│  └─ policies/
├─ plugins/
│  ├─ audit.ts
│  ├─ security-guard.ts
│  └─ cost-tracker.ts
├─ mcp/
│  ├─ gitlab-mcp/
│  ├─ jira-mcp/
│  ├─ wiki-mcp/
│  └─ db-schema-mcp/
├─ schemas/
│  └─ config.json
└─ install.ps1
```

构建流程：

```text
公网构建机
  -> 拉取 OpenCode 源码和 npm 依赖
  -> 固定 lockfile
  -> 构建二进制或安装包
  -> 安全扫描
  -> 上传内网制品库
  -> 内网用户安装
```

内网替代：

| 公网依赖 | 内网替代 |
|---|---|
| npm registry | Verdaccio / Nexus / Artifactory |
| GitHub release | 内网制品库 |
| OpenCode config schema | 内网静态文件 |
| 模型 API | 企业 LLM Gateway |
| MCP 包 | 内网 npm 或二进制包 |
| 文档 | 内网文档站 |
| 日志上报 | 内网审计服务 |

## 11. 是否 fork OpenCode

第一阶段不建议 fork。

先做：

```text
配置模板
自定义 provider
agents
commands
permissions
plugins
MCP
SDK / Web 控制台
模型网关
```

只有遇到以下问题再 fork：

```text
provider 机制无法满足内网模型协议
tool calling 兼容性不够
权限系统无法满足企业策略
TUI / IDE 体验必须深改
需要完全去除公网入口
需要改 session / context 压缩逻辑
```

fork 后建议维护：

```text
upstream/opencode
enterprise/main
enterprise/patches/*
```

每月同步上游，避免长期漂移。

## 12. MVP 里程碑

### 第 1 阶段：2 周

目标：跑通内网模型。

交付：

```text
OpenCode 离线安装包
企业模型网关
OpenAI-compatible 接口
opencode.json 模板
2 到 3 个 coding 模型别名
基础权限配置
```

验收：

```text
无公网环境可启动
能选择内网模型
能读写代码
能执行受控命令
能完成简单 bugfix
```

### 第 2 阶段：3 到 4 周

目标：企业可用。

交付：

```text
内置 agents
内置 commands
审计插件
安全拦截插件
GitLab / Jira / Wiki MCP
token 和成本统计
```

验收：

```text
/review 能审 MR
/fix-ci 能分析 CI 日志
/write-tests 能补测试
所有操作有审计
危险命令被拦截
```

### 第 3 阶段：4 到 8 周

目标：对标 Claude Code 体验。

交付：

```text
Web 控制台
Session 管理
项目画像
团队记忆
多模型路由
批量 PR 审查
IDE 集成增强
```

验收：

```text
开发者可日常使用
代码审查可进入团队流程
CI 失败可自动给出 patch
管理员可查看审计和成本
```

## 13. 推荐技术栈

```text
OpenCode 二开: TypeScript
模型网关: Node.js / Go
模型推理: vLLM / SGLang / Ollama / 厂商内网服务
数据存储: PostgreSQL
缓存和队列: Redis + BullMQ
审计日志: PostgreSQL / ClickHouse
前端控制台: Next.js
MCP: TypeScript 优先
权限策略: OPA / 自研 rule engine
内网包管理: Verdaccio / Nexus
```

## 14. 关键风险

```text
1. 内网模型 tool calling 不稳定。
2. 模型上下文长度不够，仓库级任务效果差。
3. 离线安装依赖没锁死，部署时缺包。
4. 权限太宽，agent 能执行危险命令。
5. 审计日志保存过多源码，带来合规风险。
6. 直接 fork 核心，后续难同步上游。
7. 只接模型，不接企业知识库，体验很难接近 Claude Code。
```

## 15. 下一步建议

下一步优先做：

1. 将当前 gateway 接入真实内网模型。
2. 验证流式输出和 tool calling。
3. 增加审计日志插件。
4. 增加安全策略插件。
5. 建设 GitLab / Wiki / CI MCP。
6. 制作离线安装包。

