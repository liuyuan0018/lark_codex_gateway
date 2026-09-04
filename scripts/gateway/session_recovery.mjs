const INVALID_THREAD_PATTERNS = [
  /(?:thread|conversation|session)[^\n]{0,80}(?:not found|unknown|does not exist|doesn't exist|invalid|unavailable|no longer available|deleted)/i,
  /(?:not found|unknown|does not exist|doesn't exist|invalid|unavailable|no longer available|deleted)[^\n]{0,80}(?:thread|conversation|session)/i,
  /(?:任务|会话|线程)[^\n]{0,30}(?:不存在|无效|失效|已删除|找不到)/,
  /(?:不存在|无效|失效|已删除|找不到)[^\n]{0,30}(?:任务|会话|线程)/,
];

export function isInvalidPersistedThreadReference(error) {
  if (error?.rpcMethod !== "thread/resume") {
    return false;
  }
  const message = `${error?.rpcMessage || ""}\n${error?.message || ""}`;
  if (message.toLowerCase().includes("already has an active writer")) {
    return false;
  }
  return INVALID_THREAD_PATTERNS.some((pattern) => pattern.test(message));
}
