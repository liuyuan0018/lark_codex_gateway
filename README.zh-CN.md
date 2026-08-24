<div align="center">
  <img src="assets/logo.png" width="96" alt="飞书 Codex 网关图标" />
  <h1>飞书 Codex 网关</h1>
  <p><strong>让飞书会话成为可观测、可持续处理的 Codex 任务。</strong></p>
  <p>
    把普通群、话题子线程、图片和 Bot 指令交给正确的 Codex 任务，并在本地网页查看完整处理过程。
  </p>

  <p>
    <a href="README.md">English</a> ·
    <a href="README.zh-CN.md"><strong>简体中文</strong></a>
  </p>

  <p>
    <a href="https://github.com/liuyuan0018/lark_codex_gateway/actions/workflows/secret-scan.yml"><img src="https://github.com/liuyuan0018/lark_codex_gateway/actions/workflows/secret-scan.yml/badge.svg" alt="密钥扫描" /></a>
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=nodedotjs&logoColor=white" alt="Node.js 18 或更高版本" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-555" alt="支持 macOS 和 Windows" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  </p>
</div>

> [!IMPORTANT]
> 网关优先把数据保存在本机。消息正文、业务 ID、Codex 任务 ID 和下载的附件都会留在运行网关的机器上，请妥善保护私有配置和运行目录。

## 为什么需要这个网关？

飞书保存团队的真实讨论，Codex 提供执行环境。这个网关把两者连接起来，同时明确记录每条消息进入哪个任务、如何排队、是否需要回复，以及失败发生在哪一步。

| 能力 | 作用 |
| --- | --- |
| 🧭 明确分流 | 普通群绑定一个任务；话题群按 `chat_id + thread_id` 绑定持久 Codex 任务。 |
| ⚡ 按任务并发 | 同一个 Codex 任务内保持顺序，不同任务可以并行处理。 |
| 🖼️ 图片输入 | 下载飞书图片到本机，并作为图片输入交给 Codex。 |
| 🧠 上下文控制 | 复用任务时默认只发送当前消息；用户明确要求时才附带更早的聊天记录。 |
| ✋ 回复授权 | 指定话题群的回复先进入网页，操作人可以批准或拒绝发送。 |
| 🤫 主动不回复 | Agent 返回 `[NO_REPLY]` 时记录为正常完成，不会表现得像消息丢失。 |
| 🔍 全流程观测 | 使用飞书 `eventId` 作为问题 ID，串联接收、排队、Codex、授权、发送和失败记录。 |
| ↩️ Bot 消息撤回 | 通过网关撤回 Bot 已发送的消息，并记录撤回结果。 |

## 工作流程

```mermaid
flowchart LR
    A["普通群<br/>明确 @Bot 的事件"] --> R["路由选择"]
    B["已配置的话题群<br/>用户身份轮询"] --> R
    C["MCP 主动发送或撤回"] --> G["网关操作"]
    R --> Q["按 Codex 任务 ID 排队"]
    Q --> X["Codex App Server"]
    X --> N{"是否回复"}
    N -->|"[NO_REPLY]"| O["记录 Agent 决定不回复"]
    N -->|"需要授权"| P["网页审核"]
    N -->|"直接回复"| S["Bot 身份发送"]
    P -->|"批准"| S
    P -->|"拒绝"| J["记录拒绝"]
    G --> S
    O --> D["本地事件时间线"]
    J --> D
    S --> D
```

## 入站与回复规则

| 路由 | 入站身份 | 群消息是否需要 `@Bot` | Codex 任务 | 回复方式 |
| --- | --- | --- | --- | --- |
| `allowedChatIds` 普通群 | Bot 事件 | 需要 | 自动创建并复用 | 直接发送 |
| `chatRoutes` 固定路由 | Bot 事件 | 需要 | 配置中已有的任务 | 直接发送 |
| `topicChatRoutes` 话题群 | 已授权用户轮询 | 不需要 | 每个 `chat_id + thread_id` 一个任务 | 默认网页授权，可按群关闭 |
| 文档评论 | 飞书事件 | 取决于事件 | 顶层 `threadId` | 直接发送 |

陌生普通群只有在 Bot 事件明确 `@Bot` 时才会进入网关。网关会把该 `chat_id` 写入当前私有配置，但不会把陌生群加入用户身份轮询。

## 环境要求

- macOS 或 Windows
- Node.js 18 或更高版本
- Codex CLI 和 Codex 桌面应用
- 已为飞书应用完成配置的 `lark-cli`
- Bot 已加入所有需要回复的群

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/liuyuan0018/lark_codex_gateway.git
cd lark_codex_gateway
```

### 2. 配置飞书身份

在当前机器配置应用并完成用户授权。用户身份负责读取指定话题群，Bot 身份负责发送回复。

```bash
lark-cli config init --new
lark-cli auth login --domain all
```

不要从另一台机器复制 token 文件。

### 3. 创建私有网关配置

把 [`config.example.json`](config.example.json) 复制到对应平台的私有目录，并替换所有占位内容：

| 平台 | 配置路径 |
| --- | --- |
| macOS | `~/Library/Application Support/lark-codex-gateway/config.json` |
| Windows | `%APPDATA%\lark-codex-gateway\config.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/lark-codex-gateway/config.json` |
| 源码开发目录 | `config.local.json` |

也可以通过 `LARK_CODEX_GATEWAY_CONFIG` 指定其他路径。macOS 创建文件后建议限制权限：

```bash
chmod 600 "$HOME/Library/Application Support/lark-codex-gateway/config.json"
```

### 4. 启动服务

```bash
node scripts/service.mjs start
```

打开 [http://127.0.0.1:47931](http://127.0.0.1:47931)，确认网关已连接且轮询正在运行。

### 5. 把 MCP 服务注册到 Codex

使用仓库的绝对路径注册 MCP 入口：

```bash
codex mcp add lark-codex-gateway -- node /absolute/path/to/lark_codex_gateway/scripts/mcp-server.mjs
```

注册后新建一个 Codex 任务，让 Codex 重新发现网关工具。仓库的 [`skills/`](skills/) 目录还包含 `gateway-messaging` 和 `gateway-operations` 两个 Skill。

## 配置说明

从 [`config.example.json`](config.example.json) 开始配置。主要字段如下：

| 字段 | 作用 |
| --- | --- |
| `codexWorkdir` | Codex 使用的项目目录，必须存在于当前机器。 |
| `codexModel` | 传给 Codex App Server 的模型。 |
| `codexReasoningEffort` | 新建和恢复任务时使用的推理等级。 |
| `allowedChatIds` | 可以通过明确 Bot 事件进入网关的普通群。 |
| `commandSenderIds` | 这些用户明确 `@Bot` 时，Codex 必须处理并回复。 |
| `chatRoutes` | 把普通群固定绑定到当前机器已有的 Codex 任务 UUID。 |
| `topicChatRoutes` | 配置话题群、项目 Skill、初始化提示词和回复授权策略。 |
| `pollUserMessages` | 只为 `topicChatRoutes` 启用用户身份轮询。 |
| `pollIntervalMs` | 话题群轮询间隔，默认 `5000` 毫秒。 |
| `groupContextMessages` | 当前消息明确要求读取历史时，最多附带多少条更早的消息。 |
| `enableDocComments` | 是否处理文档评论，默认关闭。 |

### 话题群配置示例

```json
{
  "chatId": "oc_replace_with_topic_chat_id",
  "threadTitlePrefix": "值班话题",
  "replyApprovalRequired": true,
  "skillName": "incident-triage",
  "initializationPrompt": "你是本群的值班助手。每个话题只处理对应的问题。"
}
```

项目 Skill 必须位于 `<codexWorkdir>/.agents/skills/<skillName>/SKILL.md`。网关创建话题任务时，会写入该 Skill、简短初始化提示词和一次性话题快照；后续消息继续使用同一个任务，不会重复写入旧内容。

## 观测网页与运维

本地网页展示：

- 网关连接、轮询和 Codex 队列状态；
- 正在运行的 Codex 任务和对应飞书事件 ID；
- 入站、内部处理、出站、忽略和失败记录；
- 已下载附件的数量和大小；
- 等待发送的回复，以及**授权发送**和**拒绝授权**按钮；
- 飞书 `eventId` 问题 ID 的一键复制按钮。

MCP 服务提供状态检查、事件搜索、Bot 主动发消息和撤回 Bot 消息等工具。主动操作仍受 `allowedChatIds`、`chatRoutes` 和 `topicChatRoutes` 限制。

### 服务命令

```bash
node scripts/service.mjs start
node scripts/service.mjs status
node scripts/service.mjs restart
node scripts/service.mjs stop
```

前台诊断：

```bash
node scripts/run-gateway.mjs
```

## 消息上下文与附件

- 复用 Codex 任务时，默认只发送当前飞书消息。
- 飞书回复消息会附带它直接回复的那一条消息。
- 只有当前消息明确要求时，网关才会补充更早的群聊或话题记录，例如“结合上面的日志”或 `#带上下文`。
- 新话题任务会获得一次性初始快照，最多 32 个资源、总计 250 MiB。
- 单条消息最多处理 8 张图片，每张不超过 20 MiB。
- 下载的文件只保存在网关私有运行目录。

## Codex Provider 环境

启动 Codex 前，网关会读取 `~/.codex/config.toml` 中当前 `model_provider` 及其 `env_key`。如果网关进程没有该变量，Windows 会从用户环境读取，macOS 会从 `launchctl` 读取；网关只把变量值交给 Codex 子进程。

Provider 密钥不会写入网关配置、事件记录或日志。

## 运行数据与机器迁移

| 平台 | 运行目录 |
| --- | --- |
| macOS | `~/Library/Application Support/lark-codex-gateway/` |
| Windows | `%LOCALAPPDATA%\lark-codex-gateway\` |
| Linux | `${XDG_STATE_HOME:-~/.local/state}/lark-codex-gateway/` |

运行目录包含本地状态、消息记录、日志和下载的附件，请勿提交或分享。

迁移到另一台机器时：

1. 停止旧机器上的网关。
2. 在新机器安装并授权 `lark-cli`。
3. 只复制私有配置，并修改机器路径和 Codex 任务 UUID。
4. 除非新机器上也存在被引用的 Codex 任务，否则不要复制 `state.json`。
5. 启动新网关；同一个飞书应用只保留一台网关运行。

## 安全边界

- 网页默认只监听 `127.0.0.1`，并且没有身份认证。不要直接暴露到局域网或互联网。
- 飞书凭据由 `lark-cli` 保存，不要写入本仓库。
- 不要在公开 Issue 中提交私有提示词、群 ID、用户 ID、任务 ID、消息记录或下载的附件。
- 公开 Fork 前，应扫描完整 Git 历史，而不仅是当前文件。
- 如果凭据曾被提交，应先轮换或撤销，再清理 Git 历史。

安全问题反馈方式见 [SECURITY.md](SECURITY.md)。

## 开发与检查

运行语法检查和本地测试：

```bash
npm --prefix scripts/gateway run check
```

仓库中的 GitHub 工作流会在每次 Push 和 Pull Request 时使用 Gitleaks 扫描密钥。

## 许可证

[MIT](LICENSE)
