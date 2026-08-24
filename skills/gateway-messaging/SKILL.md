---
name: gateway-messaging
description: Send or recall Feishu/Lark Bot messages through the local Feishu Codex gateway, with mentions, idempotency, delivery results, and dashboard observability. Use when the user asks Codex to send, post, announce, notify, withdraw, or recall a Feishu chat message through the gateway.
---

# Feishu Gateway Messaging

Use `lark_gateway_send_message` for proactive Feishu group messages. Do not call `lark-cli im +messages-send` directly when this gateway tool is available.

## Send

1. Confirm that the user requested an actual send. If the user asked only for a draft or preview, return the proposed content without calling the tool.
2. Use the destination `chat_id` supplied or confirmed by the user.
3. Put the message body in `content` and choose `markdown` unless plain text is explicitly required.
4. Use `mention_all=true` for `@所有人`. Use `mention_user_ids` for specific `ou_...` users. Do not place raw `<at>` tags in `content`.
5. Create a stable, meaningful `idempotency_key` no longer than 50 characters. Reuse the same key when retrying the same destination and content; create a new key when the destination or content changes.
6. Report the returned Feishu message ID and dashboard URL after success. On failure, report the gateway error and use `lark_gateway_events` with the idempotency key to locate the failed record.

The gateway always sends with the Bot identity. Do not offer a user-identity option.

Inbound image messages are downloaded with the authorized user identity into the gateway's private state directory. The gateway sends those files to the Codex App Server as local image inputs and includes their local paths in the Codex prompt; callers do not need to provide a second upload or a public URL.

An ordinary group that is not configured yet can enter through a Bot event only when the message explicitly mentions the current Bot. The gateway persists that group in `allowedChatIds` before processing the same message. This does not enable user-identity polling for the group.

## Recall

Use `lark_gateway_recall_message` when the user explicitly asks to withdraw one exact message previously sent by the gateway Bot.

1. Require the exact `om_...` message ID. Do not infer a message from similar text when multiple messages may match.
2. Treat recall as destructive. Do not call the tool for a draft, hypothetical request, or status question.
3. Pass `message_id` to `lark_gateway_recall_message`; the gateway performs the operation with the Bot identity and records queued, recalling, recalled, or failed traffic.
4. Report the returned message ID after success. On failure, use `lark_gateway_events` with that message ID to inspect the gateway record.

Do not fall back to `lark-cli im messages delete` when the gateway recall tool is available.
