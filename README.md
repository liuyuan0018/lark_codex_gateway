# Feishu Codex Gateway

A local Codex plugin that listens for Feishu/Lark events, assigns chats or topic threads to Codex tasks, replies with the Bot identity, and exposes a loopback observability dashboard.

The dashboard uses the existing Feishu `eventId` as the problem ID. All receive, processing, approval, send, and failure records for the same business event share that ID; copy it from event details when reporting a gateway issue or use it in dashboard and MCP event searches. Each traffic record also keeps its separate internal `id`.

Inbound Codex work is queued by Codex session ID. Events for one session run in order, while events assigned to different sessions can run concurrently. The health endpoint reports the active sessions and all currently processing event IDs.

## Security model

- The repository contains no Feishu app secret, access token, refresh token, chat ID, user ID, Codex task ID, private prompt, or machine-specific path.
- `lark-cli` owns Feishu application credentials and user authorization outside this repository.
- The gateway reads message history with the authorized user identity and sends replies with the Bot identity.
- The dashboard binds to `127.0.0.1` by default and has no authentication. Do not expose it directly to a LAN or the Internet.
- Message bodies and business identifiers are stored locally in the gateway state directory. Do not upload its `traffic.ndjson`, `state.json`, or logs.
- An unconfigured ordinary group is accepted only when a Bot event explicitly mentions the current Bot. Before processing that first request, the gateway adds the group to `allowedChatIds` in the private configuration file. Messages without `@Bot` remain ignored.

## Requirements

- macOS or Windows
- Node.js 18 or newer
- Codex CLI and Codex desktop app
- `lark-cli`, configured for a Feishu/Lark application

The bundled MCP server and the manual service command both start the gateway with Node.js. Windows and macOS use the same commands and process-management code; PowerShell is not required.

## Private configuration

Copy `config.example.json` to one of these private locations and replace every placeholder:

- macOS: `~/Library/Application Support/lark-codex-gateway/config.json`
- Windows: `%APPDATA%\lark-codex-gateway\config.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/lark-codex-gateway/config.json`
- Development checkout: `config.local.json`

You can also set `LARK_CODEX_GATEWAY_CONFIG` to an explicit file path. Private configuration files are ignored by Git.

On macOS, restrict the private file after creating it:

```bash
chmod 600 "$HOME/Library/Application Support/lark-codex-gateway/config.json"
```

Important fields:

- `threadId`: required only when `enableDocComments` is true; it must identify a Codex task that exists on the current machine. Chat and topic routes create their own Codex tasks.
- `codexWorkdir`: an absolute path, or a path beginning with `~/`, available on the current machine.
- `codexModel` and `codexReasoningEffort`: the model and reasoning effort passed to Codex App Server when the gateway creates, resumes, or starts a turn. They default to `gpt-5.6-sol` and `high`.
- `allowedChatIds`: ordinary chats that may trigger Codex. This list is also updated at runtime when an unconfigured group explicitly mentions the Bot. Fixed and topic route chat IDs are accepted automatically.
- `commandSenderIds`: user `open_id` values allowed to issue an explicit `@Bot` instruction. For these messages Codex must handle and reply to the request even when another group member is already involved; this does not block messages from other senders.
- `chatRoutes`: fixed ordinary-chat bindings. Each entry sends that chat's accepted Bot event to the configured existing Codex task. `threadTitle` is optional.
- `topicChatRoutes`: each `chatId + thread_id` pair owns one Codex task. `skillName` optionally names a project-local Skill under `.agents/skills`; the gateway verifies and explicitly invokes it only when creating a new topic task. Keep `initializationPrompt` short and limited to chat identity and topic scope. Set `replyApprovalRequired` to `false` only when that chat may receive Bot replies without dashboard approval; it defaults to `true`.
- `pollUserMessages`: when enabled, the authorized user reads every new root message and topic reply only from chats configured in `topicChatRoutes`. The first startup records the current time and does not process older messages.
- `pollIntervalMs`: delay between user-identity history checks; defaults to 5000 ms.
- `groupContextMessages`: maximum number of earlier group messages attached only when the current request explicitly asks the gateway to read earlier chat or topic history. Reused Codex tasks otherwise receive only the current message. A message sent as a Feishu reply still includes the one message it directly replies to. This limit does not prevent a newly created topic task from taking its one-time initial snapshot.
- `enableDocComments`: disabled by default so a chat-only deployment does not require Drive comment permissions.
- `allowUnconfiguredChats`: disabled by default.

Inbound rules are intentionally different by route:

- Topic chats in `topicChatRoutes` are polled with the user identity and do not require `@Bot`.
- Before each Codex App Server process starts, the gateway reads the active `model_provider` and
  its `env_key` from the user's `~/.codex/config.toml`. If that variable is missing from the
  gateway process, Windows reads it from the user's environment and macOS reads it from
  `launchctl`; only the child process receives the value. The gateway never writes provider keys
  into plugin configuration, traffic records, or logs.
- Ordinary chats in `allowedChatIds` or `chatRoutes` are not polled. Group messages enter through Bot events only when they explicitly mention the current Bot. When the first explicit `@Bot` event comes from an unconfigured group, the gateway writes its `chat_id` to `allowedChatIds` in the active private configuration before forwarding that same message to Codex. A `chatRoutes` entry is used before any saved automatic assignment, and the gateway removes the obsolete automatic assignment from local state without deleting its Codex task.
- The same chat must not appear in both `chatRoutes` and `topicChatRoutes`.

When a message contains an image, the gateway reads the message with the user identity, downloads each image into the private state directory, and sends the downloaded files to Codex as `localImage` inputs. The prompt also lists the local absolute paths so Codex tools can inspect the same files. Images are limited to eight per message and 20 MiB per image; download failures fail the current request and are recorded in the local dashboard traffic.

When a topic route creates a new Codex task, the gateway also reads every topic message available up to the triggering message and downloads its eligible resources once. It supplies images as `localImage` inputs and lists other downloaded files in the prompt. The initial snapshot is limited to 32 resources and 250 MiB in total; the dashboard marks a snapshot that exceeded a content or resource limit. Later turns receive only new messages unless the current request explicitly asks for history. Topic assignments loaded from an older gateway state are marked `legacy` and are never reinitialized or backfilled during an upgrade.

Use the gateway MCP tools for proactive Bot messages and Bot-message recall. Both operations are recorded in the local traffic log; callers should not invoke `lark-cli` directly when the corresponding gateway tool is available.

Replies generated for a topic route whose `replyApprovalRequired` is not `false` are not sent immediately. The gateway stores them in `state.json`; open the dashboard and review the text under **待授权发送**. Click **授权发送** to let the Bot send it, or **拒绝授权** to remove it without sending. Both decisions are recorded in dashboard traffic. Pending replies survive gateway restarts until one of those actions succeeds. A route with `replyApprovalRequired: false` sends new replies immediately with the Bot identity; changing this setting does not send or remove replies that are already pending.

Every message polled from a topic route reaches its Codex task, but the Agent decides whether Bot intervention is useful. Messages that need no Bot reply must return exactly `[NO_REPLY]`. The gateway then writes a successful `no_reply` internal record with the same Feishu `eventId`; the dashboard labels it **Agent 决定不回复**, so operators can distinguish an Agent decision from filtering, processing failure, or outbound delivery failure.

Runtime state is stored outside the repository:

- macOS: `~/Library/Application Support/lark-codex-gateway/`
- Windows: `%LOCALAPPDATA%\lark-codex-gateway\`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/lark-codex-gateway/`

Do not copy `state.json` between machines unless the referenced Codex task IDs also exist on the destination host. For a normal migration, stop the old gateway and let the new machine create fresh assignments.

## Feishu authentication

Configure the same Feishu application on the destination machine with `lark-cli config init --new`. Complete a new user authorization on that machine; do not copy token files from another computer. The authorized user must be able to read every configured chat, and the Bot must be present in each chat it replies to.

## Running on Windows and macOS

1. Install Node.js, Codex, and `lark-cli`.
2. Create the private configuration described above.
3. Install the plugin from the selected Codex marketplace.
4. Start a new Codex task so the updated MCP server is loaded.
5. Call the gateway status tool or open `http://127.0.0.1:47931` after the gateway reports connected.

The same service commands work in PowerShell, Command Prompt, Terminal, and other shells:

```bash
node scripts/service.mjs start
node scripts/service.mjs status
node scripts/service.mjs restart
node scripts/service.mjs stop
```

`start` returns the existing healthy process when it already uses the current version and configuration. `restart` always stops the existing gateway and starts a new process. Background stdout and stderr files are written under the configured state directory's `logs` folder.

For foreground diagnostics on either operating system:

```bash
node scripts/run-gateway.mjs
```

Run only one gateway for a Feishu application during migration. Stop the old host before starting the new host so local assignment state cannot diverge.

## Public release checklist

1. Confirm `config.local.json`, `config.json`, `.env*`, logs, state, and traffic files are untracked.
2. Run a secret scanner against the complete Git history, not only the current files.
3. Review images and generated artifacts for chat content, task IDs, paths, account names, and internal URLs.
4. Publish from a clean repository if the source previously contained credentials or private configuration.
5. If a secret was ever committed, rotate it first; deleting the current file does not remove it from Git history.

The exact token `[NO_REPLY]` is the gateway protocol for a completed topic-message turn that intentionally produces no Bot reply.
