const POLLABLE_SENDER_TYPES = new Set(["user", "app"]);

export function pollingRouteAcceptsChatMode(chatMode, allowRegularChat = false) {
  return chatMode === "topic" || (allowRegularChat && chatMode === "group");
}

function senderIdentifier(value) {
  if (typeof value === "string") {
    return value;
  }
  return value?.open_id || value?.openId || "";
}

export function polledMessageSenderId(message) {
  const sender = message?.sender;
  return senderIdentifier(
    sender?.open_bot_id ||
    sender?.openBotId ||
    sender?.id ||
    sender,
  );
}

export function polledMessageSenderName(message) {
  return typeof message?.sender?.name === "string" ? message.sender.name.trim() : "";
}

export function isPollableMessage(message, options = {}) {
  if (message?.deleted) {
    return false;
  }
  if (!POLLABLE_SENDER_TYPES.has(message?.sender?.sender_type)) {
    return false;
  }
  if (typeof message?.message_id !== "string" || !message.message_id.startsWith("om_")) {
    return false;
  }
  const senderId = polledMessageSenderId(message);
  if (!senderId) {
    return false;
  }
  const botOpenId = typeof options.botOpenId === "string" ? options.botOpenId : "";
  return !botOpenId || senderId !== botOpenId;
}
