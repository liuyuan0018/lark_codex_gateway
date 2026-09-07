import assert from "node:assert/strict";
import test from "node:test";

import {
  MESSAGE_STATUS_REACTIONS,
  createMessageStatusReactionController,
  supportsMessageStatusReaction,
} from "./message_status_reactions.mjs";

test("switches received reaction to processing and clears it after completion", async () => {
  const calls = [];
  let nextId = 1;
  const controller = createMessageStatusReactionController({
    createReaction: async (messageId, emojiType) => {
      calls.push(["create", messageId, emojiType]);
      return { data: { reaction_id: `reaction-${nextId++}` } };
    },
    deleteReaction: async (messageId, reactionId) => {
      calls.push(["delete", messageId, reactionId]);
    },
  });
  const event = { source: "message", message_id: "om_accepted" };

  await controller.set(event, MESSAGE_STATUS_REACTIONS.received);
  await controller.set(event, MESSAGE_STATUS_REACTIONS.processing);
  await controller.clear(event);

  assert.deepEqual(calls, [
    ["create", "om_accepted", "OK"],
    ["create", "om_accepted", "Typing"],
    ["delete", "om_accepted", "reaction-1"],
    ["delete", "om_accepted", "reaction-2"],
  ]);
});

test("switches processing reaction to the persistent failure reaction", async () => {
  const calls = [];
  let nextId = 1;
  const controller = createMessageStatusReactionController({
    createReaction: async (messageId, emojiType) => {
      calls.push(["create", messageId, emojiType]);
      return { reaction_id: `reaction-${nextId++}` };
    },
    deleteReaction: async (messageId, reactionId) => {
      calls.push(["delete", messageId, reactionId]);
    },
  });
  const event = { message_id: "om_failed" };

  await controller.set(event, MESSAGE_STATUS_REACTIONS.processing);
  await controller.set(event, MESSAGE_STATUS_REACTIONS.failed);

  assert.deepEqual(calls, [
    ["create", "om_failed", "Typing"],
    ["create", "om_failed", "ERROR"],
    ["delete", "om_failed", "reaction-1"],
  ]);
});

test("does not add status reactions to document comments or invalid message ids", async () => {
  const controller = createMessageStatusReactionController({
    createReaction: async () => assert.fail("createReaction should not be called"),
    deleteReaction: async () => assert.fail("deleteReaction should not be called"),
  });

  assert.equal(supportsMessageStatusReaction({ source: "doc_comment", message_id: "om_doc" }), false);
  assert.equal(supportsMessageStatusReaction({ message_id: "not-a-message" }), false);
  assert.equal((await controller.set({ source: "doc_comment", message_id: "om_doc" }, "OK")).changed, false);
});
