import assert from "node:assert/strict";
import test from "node:test";

import {
  createManualRetryDeliveryScope,
  replyIdempotencyKey,
} from "./outbound_idempotency.mjs";

test("manual retries use a fresh reply idempotency domain", () => {
  const eventId = "im.message.receive_v1:om_message1";
  const original = replyIdempotencyKey({ event_id: eventId }, 0);
  const firstRetry = replyIdempotencyKey({
    event_id: eventId,
    reply_idempotency_scope: createManualRetryDeliveryScope(eventId, "retry-1"),
  }, 0);
  const secondRetry = replyIdempotencyKey({
    event_id: eventId,
    reply_idempotency_scope: createManualRetryDeliveryScope(eventId, "retry-2"),
  }, 0);

  assert.notEqual(firstRetry, original);
  assert.notEqual(secondRetry, firstRetry);
});

test("chunks within one delivery scope remain deterministic", () => {
  const event = {
    event_id: "event",
    reply_idempotency_scope: "manual-retry-scope",
  };
  assert.equal(replyIdempotencyKey(event, 0), replyIdempotencyKey(event, 0));
  assert.notEqual(replyIdempotencyKey(event, 0), replyIdempotencyKey(event, 1));
});
