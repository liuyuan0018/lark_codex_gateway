import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { loadGatewayConfig, resolveGatewayConfigPath } from "./config.mjs";
import {
  ensureGateway as ensureGatewayService,
  gatewayDashboardUrl,
} from "./service-manager.mjs";

const pluginRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(
  await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
);
const configPath = resolveGatewayConfigPath(pluginRoot);
const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

let lastStartError = "";
let dashboardUrl = "";
let ensurePromise = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function fetchJson(url, timeoutMs = 2500, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
    ...options,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`);
    error.statusCode = response.status;
    error.gatewayCode = body?.error;
    throw error;
  }
  return body;
}

function ensureGateway() {
  if (!ensurePromise) {
    ensurePromise = loadGatewayConfig(pluginRoot, configPath).then(({
      config,
      fingerprint: configFingerprint,
    }) => {
      dashboardUrl = gatewayDashboardUrl(config);
      return ensureGatewayService({
        pluginRoot,
        config,
        configPath,
        configFingerprint,
        expectedVersion: manifest.version,
      });
    }).then((health) => {
      lastStartError = "";
      return health;
    }).catch((error) => {
      lastStartError = error instanceof Error ? error.message : String(error);
      throw error;
    }).finally(() => {
      ensurePromise = null;
    });
  }
  return ensurePromise;
}

function toolResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

async function gatewayStatus() {
  try {
    const health = await ensureGateway();
    return toolResult(
      `飞书网关${health.connectionState === "connected" ? "已连接" : "状态为 " + health.connectionState}。观察页：${health.dashboardUrl}`,
      health,
    );
  } catch (error) {
    return toolResult(
      `飞书网关未就绪：${error.message}`,
      { ok: false, dashboardUrl, error: error.message, lastStartError },
    );
  }
}

async function gatewayEvents(args) {
  const health = await ensureGateway();
  const limit = Math.min(Math.max(Number.parseInt(args.limit ?? "100", 10) || 100, 1), 500);
  const params = new URLSearchParams({ limit: String(limit) });
  for (const key of ["direction", "kind", "status", "query"]) {
    if (typeof args[key] === "string" && args[key].trim()) {
      params.set(key, args[key].trim());
    }
  }
  const result = await fetchJson(`${health.dashboardUrl}/api/events?${params}`);
  return toolResult(`读取到 ${result.events?.length ?? 0} 条网关记录。`, result);
}

async function gatewaySendMessage(args) {
  const health = await ensureGateway();
  const result = await fetchJson(`${health.dashboardUrl}/api/messages`, 90000, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      chatId: args.chat_id,
      content: args.content,
      format: args.format ?? "markdown",
      mentionAll: args.mention_all === true,
      mentionUserIds: args.mention_user_ids ?? [],
      idempotencyKey: args.idempotency_key,
    }),
  });
  return toolResult(
    `已通过飞书网关以 Bot 身份发送消息。消息 ID：${result.messageId}`,
    result,
  );
}

async function gatewayRecallMessage(args) {
  const health = await ensureGateway();
  const result = await fetchJson(`${health.dashboardUrl}/api/messages/recall`, 90000, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ messageId: args.message_id }),
  });
  return toolResult(
    `已通过飞书网关以 Bot 身份撤回消息。消息 ID：${result.messageId}`,
    result,
  );
}

async function handleToolCall(name, args = {}) {
  if (name === "lark_gateway_status") {
    return gatewayStatus();
  }
  if (name === "lark_gateway_events") {
    return gatewayEvents(args);
  }
  if (name === "lark_gateway_dashboard") {
    const health = await ensureGateway();
    return toolResult(`飞书网关观察页：${health.dashboardUrl}`, {
      ok: true,
      dashboardUrl: health.dashboardUrl,
    });
  }
  if (name === "lark_gateway_send_message") {
    return gatewaySendMessage(args);
  }
  if (name === "lark_gateway_recall_message") {
    return gatewayRecallMessage(args);
  }
  throw new Error(`Unknown tool: ${name}`);
}

const tools = [
  {
    name: "lark_gateway_send_message",
    title: "Send Feishu Message Through Gateway",
    description: "Send an observable proactive message to a Feishu chat through the gateway using the Bot identity. Requires an idempotency key of at most 50 characters. Use mention_all or mention_user_ids instead of writing Feishu mention markup in content.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "string", pattern: "^oc_[A-Za-z0-9]+$" },
        content: { type: "string", minLength: 1, maxLength: 30000 },
        format: { type: "string", enum: ["text", "markdown"], default: "markdown" },
        mention_all: { type: "boolean", default: false },
        mention_user_ids: {
          type: "array",
          items: { type: "string", pattern: "^ou_[A-Za-z0-9]+$" },
          maxItems: 50,
          default: [],
        },
        idempotency_key: { type: "string", minLength: 1, maxLength: 50 },
      },
      required: ["chat_id", "content", "idempotency_key"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "lark_gateway_recall_message",
    title: "Recall Feishu Bot Message Through Gateway",
    description: "Recall a Feishu message previously sent by the gateway Bot. This is destructive and should be called only after the user explicitly requests that exact message ID be recalled.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "string", pattern: "^om_[A-Za-z0-9]+$" },
      },
      required: ["message_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "lark_gateway_status",
    title: "Get Feishu Gateway Status",
    description: "Read the current Feishu-to-Codex gateway health, queue, counters, connection state, and dashboard URL. The plugin starts the gateway first when needed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "lark_gateway_events",
    title: "Read Feishu Gateway Traffic",
    description: "Read recent inbound, outbound, ignored, error, and lifecycle records from the local Feishu gateway observability store.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
        direction: { type: "string", enum: ["all", "inbound", "outbound", "internal"] },
        kind: { type: "string", enum: ["all", "message", "doc_comment", "system"] },
        status: { type: "string", enum: ["all", "accepted", "ignored", "queued", "processing", "success", "error", "connected", "disconnected", "info"] },
        query: { type: "string" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "lark_gateway_dashboard",
    title: "Get Feishu Gateway Dashboard",
    description: "Return the local browser URL for the Feishu gateway observability dashboard, starting the gateway first when needed.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const bootstrapPromise = ensureGateway().catch(() => null);

async function handleRequest(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    await bootstrapPromise;
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "Feishu Codex Gateway", version: manifest.version },
      instructions: "Use the gateway tools to send or recall Bot messages and inspect the local Feishu-to-Codex service and traffic. The MCP server ensures that the gateway and its dashboard are running when the plugin starts.",
    });
    return;
  }
  if (method === "ping") {
    sendResult(id, {});
    return;
  }
  if (method === "tools/list") {
    sendResult(id, { tools });
    return;
  }
  if (method === "tools/call") {
    try {
      sendResult(id, await handleToolCall(params?.name, params?.arguments));
    } catch (error) {
      sendError(
        id,
        error?.statusCode === 400 ? JsonRpcError.INVALID_PARAMS : JsonRpcError.INTERNAL_ERROR,
        error instanceof Error ? error.message : String(error),
      );
    }
    return;
  }
  if (id !== undefined) {
    sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  try {
    const message = JSON.parse(line);
    if (message.method !== undefined) {
      void handleRequest(message);
    }
  } catch {
    // Ignore malformed stdin so only valid JSON-RPC messages reach stdout.
  }
});
