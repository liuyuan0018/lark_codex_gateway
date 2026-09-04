export const NO_REPLY_TOKEN = "[NO_REPLY]";

export function isAutomatedFailureCard(messageType, content) {
  return messageType === "interactive" &&
    /(?:失败|异常|报错|error|failed|failure|build\s*fail)/i.test(String(content || ""));
}

export function buildReplyDecisionInstructions({
  topicMessage = false,
  forceReply = false,
  automatedFailureCard = false,
} = {}) {
  const instructions = [];
  if (topicMessage) {
    instructions.push(
      "当前群配置为全量监听：每条话题消息都会进入 Codex，但不代表每条消息都需要 Bot 回复。",
      "请先判断当前消息是否需要 Bot 介入。明确向 Bot 提问或求助、要求排查或执行操作、需要补充关键事实或最少必要追问时，应正常处理并回复。",
      "成员之间的对话、已被他人完整处理后的补充或确认、致谢、没有请求的状态同步、重复消息，通常不需要 Bot 回复。",
      `如果不需要回复，最终答案必须且只能是 ${NO_REPLY_TOKEN}；不要附加解释。网关会把这个决定记录为 no_reply。`,
    );
    if (automatedFailureCard) {
      instructions.push(
        "当前消息是外部应用发送的构建/运行失败卡片。此类异常通知属于需要 Bot 介入的请求，即使没有人明确 @Bot 或提出问题，也必须读取相关任务、日志或上下文并给出诊断结果；不得因为它是卡片、来自外部应用或没有自然语言提问而返回 [NO_REPLY]。",
      );
    }
  }
  if (forceReply) {
    instructions.push(
      `该发送者位于 Bot 指令白名单，并且本条消息明确 @Bot。必须把当前请求作为需要执行并回复的 Bot 指令；不得仅因群成员已经介入或给过建议而输出 ${NO_REPLY_TOKEN}。如果执行失败，回复具体原因或最少的必要追问。`,
    );
  }
  return instructions;
}

export function shouldSuppressReply(text) {
  return typeof text === "string" && text.trim() === NO_REPLY_TOKEN;
}

export function noReplyObservationFields(durationMs) {
  return {
    stage: "no_reply",
    status: "success",
    summary: "Codex Agent 判断无需回复",
    replyDecision: "no_reply",
    durationMs,
  };
}

export function topicReplyNeedsApproval({ source, topicRoute }) {
  return source === "message" && Boolean(topicRoute) && topicRoute.replyApprovalRequired !== false;
}
