export const MESSAGE_STATUS_REACTIONS = Object.freeze({
  received: "OK",
  processing: "Typing",
  failed: "ERROR",
});

export function supportsMessageStatusReaction(event) {
  return event?.source !== "doc_comment"
    && typeof event?.message_id === "string"
    && event.message_id.startsWith("om_");
}

function reactionIdFromResult(result) {
  const reactionId = result?.data?.reaction_id || result?.reaction_id;
  return typeof reactionId === "string" && reactionId ? reactionId : "";
}

export function createMessageStatusReactionController({ createReaction, deleteReaction }) {
  if (typeof createReaction !== "function" || typeof deleteReaction !== "function") {
    throw new TypeError("createReaction 和 deleteReaction 必须是函数");
  }

  const reactionsByMessageId = new Map();

  async function removeTracked(messageId, tracked) {
    const retained = [];
    const errors = [];
    for (const reaction of tracked) {
      try {
        await deleteReaction(messageId, reaction.reactionId);
      } catch (error) {
        retained.push(reaction);
        errors.push(error);
      }
    }
    if (retained.length > 0) {
      reactionsByMessageId.set(messageId, retained);
    } else {
      reactionsByMessageId.delete(messageId);
    }
    return errors;
  }

  async function set(event, emojiType) {
    if (!supportsMessageStatusReaction(event)) {
      return { supported: false, changed: false, cleanupErrors: [] };
    }
    const messageId = event.message_id;
    const tracked = reactionsByMessageId.get(messageId) || [];
    if (tracked.length === 1 && tracked[0].emojiType === emojiType) {
      return { supported: true, changed: false, cleanupErrors: [] };
    }

    const created = await createReaction(messageId, emojiType);
    const reactionId = reactionIdFromResult(created);
    if (!reactionId) {
      throw new Error(`添加 ${emojiType} 表情成功，但响应缺少 reaction_id`);
    }
    const current = { reactionId, emojiType };
    reactionsByMessageId.set(messageId, [...tracked, current]);
    const cleanupErrors = await removeTracked(messageId, tracked);
    reactionsByMessageId.set(messageId, [
      ...((reactionsByMessageId.get(messageId) || []).filter(
        (reaction) => reaction.reactionId !== current.reactionId,
      )),
      current,
    ]);
    return { supported: true, changed: true, reactionId, emojiType, cleanupErrors };
  }

  async function clear(event) {
    if (!supportsMessageStatusReaction(event)) {
      return { supported: false, changed: false, cleanupErrors: [] };
    }
    const tracked = reactionsByMessageId.get(event.message_id) || [];
    if (tracked.length === 0) {
      return { supported: true, changed: false, cleanupErrors: [] };
    }
    const cleanupErrors = await removeTracked(event.message_id, tracked);
    return {
      supported: true,
      changed: cleanupErrors.length < tracked.length,
      cleanupErrors,
    };
  }

  return { set, clear };
}
