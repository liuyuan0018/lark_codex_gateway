import { createHash, randomUUID } from "node:crypto";

export function createManualRetryDeliveryScope(eventId, nonce = randomUUID()) {
  return `${eventId}:manual-retry:${nonce}`;
}

export function replyIdempotencyKey(event, chunkIndex) {
  const deliveryScope = event.reply_idempotency_scope || event.event_id;
  return createHash("sha256")
    .update(`${deliveryScope}:${chunkIndex}`)
    .digest("hex")
    .slice(0, 32);
}
