import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_ID_PATTERN = /^oc_[A-Za-z0-9]+$/;
const OPEN_ID_PATTERN = /^ou_[A-Za-z0-9]+$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODEX_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CODEX_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function expandHome(value) {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function userConfigDirectory() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "lark-codex-gateway");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "lark-codex-gateway");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "lark-codex-gateway");
}

export function defaultStateDirectory() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "lark-codex-gateway");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "lark-codex-gateway");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "lark-codex-gateway");
}

function stringArray(value, name) {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${name} 必须是非空字符串数组`);
  }
  return value.map((item) => item.trim());
}

function positiveInteger(value, name, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

function normalizeConfig(raw, configPath) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`网关配置必须是 JSON 对象：${configPath}`);
  }
  const enableDocComments = raw.enableDocComments === true;
  const threadId = typeof raw.threadId === "string" ? raw.threadId.trim() : "";
  if (threadId && !THREAD_ID_PATTERN.test(threadId)) {
    throw new Error(`threadId 必须是 Codex 任务 UUID：${configPath}`);
  }
  if (enableDocComments && !threadId) {
    throw new Error(`启用文档评论时必须配置当前机器上的 Codex 任务 threadId：${configPath}`);
  }
  const codexWorkdirValue = typeof raw.codexWorkdir === "string" ? raw.codexWorkdir.trim() : "";
  if (!codexWorkdirValue) {
    throw new Error(`codexWorkdir 不能为空：${configPath}`);
  }
  const codexModel = typeof raw.codexModel === "string" && raw.codexModel.trim()
    ? raw.codexModel.trim()
    : "gpt-5.6-sol";
  if (!CODEX_MODEL_PATTERN.test(codexModel)) {
    throw new Error(`codexModel 不是有效的 Codex 模型 ID：${configPath}`);
  }
  const codexReasoningEffort = typeof raw.codexReasoningEffort === "string" && raw.codexReasoningEffort.trim()
    ? raw.codexReasoningEffort.trim().toLowerCase()
    : "high";
  if (!CODEX_REASONING_EFFORTS.has(codexReasoningEffort)) {
    throw new Error(
      `codexReasoningEffort 必须是 ${[...CODEX_REASONING_EFFORTS].join("、")} 之一：${configPath}`,
    );
  }
  const chatRoutes = Array.isArray(raw.chatRoutes) ? raw.chatRoutes : [];
  const fixedRouteChatIds = chatRoutes.map((route, index) => {
    const chatId = typeof route?.chatId === "string" ? route.chatId.trim() : "";
    const routeThreadId = typeof route?.threadId === "string" ? route.threadId.trim() : "";
    const threadTitle = typeof route?.threadTitle === "string" ? route.threadTitle.trim() : "";
    if (!CHAT_ID_PATTERN.test(chatId)) {
      throw new Error(`chatRoutes[${index}].chatId 不是有效的飞书 chat_id`);
    }
    if (!THREAD_ID_PATTERN.test(routeThreadId)) {
      throw new Error(`chatRoutes[${index}].threadId 必须是 Codex 任务 UUID`);
    }
    if (threadTitle.length > 120) {
      throw new Error(`chatRoutes[${index}].threadTitle 不能超过 120 个字符`);
    }
    return chatId;
  });
  if (new Set(fixedRouteChatIds).size !== fixedRouteChatIds.length) {
    throw new Error("chatRoutes 包含重复的 chatId");
  }
  const topicChatRoutes = Array.isArray(raw.topicChatRoutes) ? raw.topicChatRoutes : [];
  const topicRouteChatIds = topicChatRoutes.map((route, index) => {
    const chatId = typeof route?.chatId === "string" ? route.chatId.trim() : "";
    const skillName = typeof route?.skillName === "string" ? route.skillName.trim() : "";
    if (!CHAT_ID_PATTERN.test(chatId)) {
      throw new Error(`topicChatRoutes[${index}].chatId 不是有效的飞书 chat_id`);
    }
    if (skillName && (!SKILL_NAME_PATTERN.test(skillName) || skillName.length > 64)) {
      throw new Error(`topicChatRoutes[${index}].skillName 必须是最长 64 字符的小写连字符 Skill 名称`);
    }
    if (
      route?.replyApprovalRequired !== undefined &&
      typeof route.replyApprovalRequired !== "boolean"
    ) {
      throw new Error(`topicChatRoutes[${index}].replyApprovalRequired 必须是布尔值`);
    }
    return chatId;
  });
  if (new Set(topicRouteChatIds).size !== topicRouteChatIds.length) {
    throw new Error("topicChatRoutes 包含重复的 chatId");
  }
  const topicRouteChatIdSet = new Set(topicRouteChatIds);
  const overlappingChatId = fixedRouteChatIds.find((chatId) => topicRouteChatIdSet.has(chatId));
  if (overlappingChatId) {
    throw new Error(`同一个群不能同时配置在 chatRoutes 和 topicChatRoutes：${overlappingChatId}`);
  }
  const configuredAllowedChatIds = stringArray(raw.allowedChatIds, "allowedChatIds");
  const allowedChatIds = configuredAllowedChatIds ?? topicRouteChatIds;
  for (const chatId of allowedChatIds) {
    if (!CHAT_ID_PATTERN.test(chatId)) {
      throw new Error(`allowedChatIds 包含无效的飞书 chat_id：${chatId}`);
    }
  }
  const acceptedMessageTypes = stringArray(raw.acceptedMessageTypes, "acceptedMessageTypes") ?? ["text", "post"];
  const commandSenderIds = stringArray(raw.commandSenderIds, "commandSenderIds") ?? [];
  for (const senderId of commandSenderIds) {
    if (!OPEN_ID_PATTERN.test(senderId)) {
      throw new Error(`commandSenderIds 包含无效的飞书 open_id：${senderId}`);
    }
  }
  const dashboardPort = positiveInteger(raw.dashboardPort, "dashboardPort", 47931);
  if (dashboardPort > 65535) {
    throw new Error("dashboardPort 必须小于等于 65535");
  }
  const stateDirValue = typeof raw.stateDir === "string" ? raw.stateDir.trim() : "";
  const pollUserMessages = raw.pollUserMessages === true;
  if (pollUserMessages && topicRouteChatIds.length === 0) {
    throw new Error("启用 pollUserMessages 时必须至少配置一个 topicChatRoutes 群");
  }
  const config = {
    threadId,
    codexWorkdir: path.resolve(expandHome(codexWorkdirValue)),
    codexModel,
    codexReasoningEffort,
    stateDir: stateDirValue ? path.resolve(expandHome(stateDirValue)) : defaultStateDirectory(),
    dashboardHost: typeof raw.dashboardHost === "string" && raw.dashboardHost.trim()
      ? raw.dashboardHost.trim()
      : "127.0.0.1",
    dashboardPort,
    chatRoutes,
    topicChatRoutes,
    allowedChatIds: [...new Set(allowedChatIds)],
    commandSenderIds: [...new Set(commandSenderIds)],
    allowUnconfiguredChats: raw.allowUnconfiguredChats === true,
    acceptedMessageTypes: [...new Set(acceptedMessageTypes)],
    acceptGroupMessages: raw.acceptGroupMessages !== false,
    enableDocComments,
    replyEnabled: raw.replyEnabled !== false,
    pollUserMessages,
    pollIntervalMs: positiveInteger(raw.pollIntervalMs, "pollIntervalMs", 5000),
    groupContextMessages: positiveInteger(raw.groupContextMessages, "groupContextMessages", 20),
    maxContextChars: positiveInteger(raw.maxContextChars, "maxContextChars", 20000),
    maxInputChars: positiveInteger(raw.maxInputChars, "maxInputChars", 30000),
    codexTimeoutMs: positiveInteger(raw.codexTimeoutMs, "codexTimeoutMs", 30 * 60 * 1000),
    reconnectDelayMs: positiveInteger(raw.reconnectDelayMs, "reconnectDelayMs", 5000),
    readyTimeoutMs: positiveInteger(raw.readyTimeoutMs, "readyTimeoutMs", 30000),
  };
  return config;
}

function fingerprintConfig(config) {
  return createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex")
    .slice(0, 16);
}

export async function addAllowedChatId(configPath, chatId) {
  if (!CHAT_ID_PATTERN.test(chatId)) {
    throw new Error("chatId 必须是有效的飞书群聊 ID（oc_...）");
  }
  let raw;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`读取网关配置失败：${configPath}：${error.message}`, { cause: error });
  }
  const current = normalizeConfig(raw, configPath);
  if (current.allowedChatIds.includes(chatId)) {
    return { added: false, config: current, fingerprint: fingerprintConfig(current) };
  }
  raw.allowedChatIds = [...current.allowedChatIds, chatId];
  const updated = normalizeConfig(raw, configPath);
  const temporaryPath = `${configPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, configPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw new Error(`写入网关配置失败：${configPath}：${error.message}`, { cause: error });
  }
  return { added: true, config: updated, fingerprint: fingerprintConfig(updated) };
}

export async function loadGatewayConfig(pluginRoot) {
  const candidates = [];
  if (process.env.LARK_CODEX_GATEWAY_CONFIG) {
    candidates.push(path.resolve(expandHome(process.env.LARK_CODEX_GATEWAY_CONFIG)));
  }
  candidates.push(path.join(pluginRoot, "config.local.json"));
  candidates.push(path.join(userConfigDirectory(), "config.json"));
  candidates.push(path.join(pluginRoot, "config.json"));
  const configPath = candidates.find((candidate) => existsSync(candidate));
  if (!configPath) {
    throw new Error(
      `找不到私有配置。复制 config.example.json 到 ${path.join(userConfigDirectory(), "config.json")}，` +
      "或设置 LARK_CODEX_GATEWAY_CONFIG。",
    );
  }
  let raw;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`读取网关配置失败：${configPath}：${error.message}`, { cause: error });
  }
  const config = normalizeConfig(raw, configPath);
  const fingerprint = fingerprintConfig(config);
  return { config, configPath, fingerprint };
}

export function gatewayEnvironment(config, fingerprint, configPath = "") {
  return {
    CODEX_THREAD_ID: config.threadId,
    CODEX_WORKDIR: config.codexWorkdir,
    CODEX_MODEL: config.codexModel,
    CODEX_REASONING_EFFORT: config.codexReasoningEffort,
    GATEWAY_STATE_DIR: config.stateDir,
    GATEWAY_DASHBOARD_HOST: config.dashboardHost,
    GATEWAY_DASHBOARD_PORT: String(config.dashboardPort),
    GATEWAY_CONFIG_FINGERPRINT: fingerprint,
    GATEWAY_CONFIG_PATH: configPath,
    GATEWAY_REPLY_ENABLED: config.replyEnabled ? "1" : "0",
    GATEWAY_POLL_USER_MESSAGES: config.pollUserMessages ? "1" : "0",
    GATEWAY_POLL_INTERVAL_MS: String(config.pollIntervalMs),
    GATEWAY_GROUP_CONTEXT_MESSAGES: String(config.groupContextMessages),
    GATEWAY_MAX_CONTEXT_CHARS: String(config.maxContextChars),
    GATEWAY_MAX_INPUT_CHARS: String(config.maxInputChars),
    CODEX_TIMEOUT_MS: String(config.codexTimeoutMs),
    GATEWAY_RECONNECT_DELAY_MS: String(config.reconnectDelayMs),
    LARK_READY_TIMEOUT_MS: String(config.readyTimeoutMs),
    LARK_CHAT_ROUTES: JSON.stringify(config.chatRoutes),
    LARK_TOPIC_CHAT_ROUTES: JSON.stringify(config.topicChatRoutes),
    LARK_ALLOWED_CHAT_IDS: config.allowedChatIds.join(","),
    LARK_COMMAND_SENDER_IDS: config.commandSenderIds.join(","),
    LARK_ALLOW_UNCONFIGURED_CHATS: config.allowUnconfiguredChats ? "1" : "0",
    LARK_ACCEPTED_MESSAGE_TYPES: config.acceptedMessageTypes.join(","),
    LARK_ACCEPT_GROUP_MESSAGES: config.acceptGroupMessages ? "1" : "0",
    LARK_ENABLE_DOC_COMMENTS: config.enableDocComments ? "1" : "0",
  };
}
