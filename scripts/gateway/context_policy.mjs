const CHINESE_HISTORY_OBJECT =
  "(?:前文|上文|前面(?:的)?(?:消息|日志|内容|讨论)?|上面(?:的)?(?:消息|日志|内容|讨论)?|聊天记录|群聊记录|历史消息|历史记录|话题记录|本话题(?:的)?(?:消息|记录)?|群里(?:之前|前面|上面)(?:的)?(?:消息|日志|内容|讨论)?)";
const CHINESE_HISTORY_ACTION =
  "(?:查看|看(?:一下|下)?|读取|结合|参考|根据|回顾|总结|检查|分析|使用|继续|带上|附上)";
const CHINESE_HISTORY_REQUEST = new RegExp(
  `(?:${CHINESE_HISTORY_ACTION}.{0,24}${CHINESE_HISTORY_OBJECT}|${CHINESE_HISTORY_OBJECT}.{0,24}${CHINESE_HISTORY_ACTION})`,
  "i",
);
const ENGLISH_HISTORY_REQUEST =
  /(?:(?:read|review|check|use|consider|summarize|analyze|include|continue from|look at).{0,48}(?:chat history|thread history|conversation context|earlier messages|previous messages|messages above|previous logs)|(?:chat history|thread history|conversation context|earlier messages|previous messages|messages above|previous logs).{0,48}(?:read|review|check|use|consider|summarize|analyze|include|continue|look at))/i;
const EXPLICIT_CONTEXT_MARKER = /(?:#带上下文|\[(?:带|包含|读取)(?:群聊|话题)?上下文\]|\/(?:with-)?context\b)/i;

export function messageRequestsGroupHistory(content) {
  if (typeof content !== "string") {
    return false;
  }
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return EXPLICIT_CONTEXT_MARKER.test(normalized) ||
    CHINESE_HISTORY_REQUEST.test(normalized) ||
    ENGLISH_HISTORY_REQUEST.test(normalized);
}
