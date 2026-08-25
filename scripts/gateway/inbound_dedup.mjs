const MESSAGE_ID_PATTERN = /^om_[A-Za-z0-9]+$/;

export function businessMessageId(event) {
  if (event?.source === "doc_comment") {
    return "";
  }
  return typeof event?.message_id === "string" && MESSAGE_ID_PATTERN.test(event.message_id)
    ? event.message_id
    : "";
}

function normalizedIds(ids) {
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id) : [];
}

export function createInboundDeduplicator({
  eventIds = [],
  messageIds = [],
  maxSavedIds = 1000,
} = {}) {
  let savedEventIds = normalizedIds(eventIds).slice(-maxSavedIds);
  let savedMessageIds = normalizedIds(messageIds).slice(-maxSavedIds);
  const eventIdSet = new Set(savedEventIds);
  const messageIdSet = new Set(savedMessageIds);
  const queuedEventIds = new Set();
  const queuedMessageIds = new Set();

  function queuedDuplicateReason(event) {
    if (queuedEventIds.has(event?.event_id || "")) {
      return "duplicate_event";
    }
    const messageId = businessMessageId(event);
    return messageId && queuedMessageIds.has(messageId) ? "duplicate_message" : "";
  }

  function duplicateReason(event) {
    const eventId = event?.event_id || "";
    if (eventIdSet.has(eventId)) {
      return "duplicate_event";
    }
    const messageId = businessMessageId(event);
    if (messageId && messageIdSet.has(messageId)) {
      return "duplicate_message";
    }
    return queuedDuplicateReason(event);
  }

  function reserve(event) {
    const reason = duplicateReason(event);
    if (reason) {
      return { accepted: false, reason };
    }
    if (event?.event_id) {
      queuedEventIds.add(event.event_id);
    }
    const messageId = businessMessageId(event);
    if (messageId) {
      queuedMessageIds.add(messageId);
    }
    return { accepted: true, reason: "" };
  }

  function remember(event) {
    if (event?.event_id && !eventIdSet.has(event.event_id)) {
      eventIdSet.add(event.event_id);
      savedEventIds.push(event.event_id);
    }
    const messageId = businessMessageId(event);
    if (messageId && !messageIdSet.has(messageId)) {
      messageIdSet.add(messageId);
      savedMessageIds.push(messageId);
    }
    if (savedEventIds.length > maxSavedIds) {
      const removed = savedEventIds.splice(0, savedEventIds.length - maxSavedIds);
      for (const id of removed) {
        eventIdSet.delete(id);
      }
    }
    if (savedMessageIds.length > maxSavedIds) {
      const removed = savedMessageIds.splice(0, savedMessageIds.length - maxSavedIds);
      for (const id of removed) {
        messageIdSet.delete(id);
      }
    }
  }

  function forget(event) {
    if (event?.event_id) {
      eventIdSet.delete(event.event_id);
      savedEventIds = savedEventIds.filter((id) => id !== event.event_id);
    }
    const messageId = businessMessageId(event);
    if (messageId) {
      messageIdSet.delete(messageId);
      savedMessageIds = savedMessageIds.filter((id) => id !== messageId);
    }
  }

  function release(event) {
    if (event?.event_id) {
      queuedEventIds.delete(event.event_id);
    }
    const messageId = businessMessageId(event);
    if (messageId) {
      queuedMessageIds.delete(messageId);
    }
  }

  function snapshot() {
    return {
      eventIds: [...savedEventIds],
      messageIds: [...savedMessageIds],
    };
  }

  return { duplicateReason, queuedDuplicateReason, reserve, remember, forget, release, snapshot };
}
