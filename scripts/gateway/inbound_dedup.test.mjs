import assert from "node:assert/strict";
import test from "node:test";

import { createInboundDeduplicator } from "./inbound_dedup.mjs";

function messageEvent(eventId, ingress = "bot_event") {
  return {
    event_id: eventId,
    message_id: "om_same123",
    source: "message",
    ingress,
  };
}

test("bot event and user poll share messageId deduplication", () => {
  const dedup = createInboundDeduplicator();
  const botEvent = messageEvent("bot-event", "bot_event");
  const pollEvent = messageEvent("poll-event", "user_poll");

  assert.deepEqual(dedup.reserve(botEvent), { accepted: true, reason: "" });
  assert.deepEqual(dedup.reserve(pollEvent), {
    accepted: false,
    reason: "duplicate_message",
  });

  dedup.remember(botEvent);
  dedup.release(botEvent);
  assert.equal(dedup.duplicateReason(pollEvent), "duplicate_message");
  assert.deepEqual(dedup.snapshot(), {
    eventIds: ["bot-event"],
    messageIds: ["om_same123"],
  });
});

test("manual retry clears the saved business key once and re-enters normal deduplication", () => {
  const dedup = createInboundDeduplicator();
  const original = messageEvent("poll-event", "user_poll");
  dedup.remember(original);

  const retry = messageEvent("poll-event", "manual_retry");
  dedup.forget(retry);
  assert.deepEqual(dedup.reserve(retry), { accepted: true, reason: "" });
  dedup.remember(retry);
  dedup.release(retry);

  assert.equal(dedup.duplicateReason(messageEvent("another-event")), "duplicate_message");
});
