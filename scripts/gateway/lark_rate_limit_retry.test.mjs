import assert from "node:assert/strict";
import test from "node:test";

import {
  isLarkRateLimitResult,
  runWithLarkRateLimitRetry,
} from "./lark_rate_limit_retry.mjs";

function commandResult(code, stderr = "", stdout = "") {
  return { code, stderr, stdout };
}

test("recognizes the non-JSON TAT HTTP 429 failure", () => {
  const result = commandResult(
    5,
    "SDK returned an invalid JSON response: failed to parse TAT response (HTTP 429)",
  );
  assert.equal(isLarkRateLimitResult(result), true);
});

test("retries rate limits with bounded exponential backoff and preserves the operation", async () => {
  const delays = [];
  const retryEvents = [];
  let calls = 0;
  const result = await runWithLarkRateLimitRetry(async () => {
    calls += 1;
    return calls < 3
      ? commandResult(5, "HTTP 429: Too Many Requests")
      : commandResult(0, "", '{"ok":true}');
  }, {
    maxAttempts: 5,
    initialDelayMs: 10,
    maxDelayMs: 15,
    sleep: async (delayMs) => delays.push(delayMs),
    now: () => 100,
    onRetry: async (event) => retryEvents.push(event),
  });

  assert.equal(result.value.code, 0);
  assert.equal(result.attempts, 3);
  assert.equal(result.rateLimitExhausted, false);
  assert.deepEqual(delays, [10, 15]);
  assert.deepEqual(retryEvents.map((event) => event.nextAttempt), [2, 3]);
});

test("does not retry unrelated command failures", async () => {
  let calls = 0;
  const result = await runWithLarkRateLimitRetry(async () => {
    calls += 1;
    return commandResult(1, "permission denied");
  }, { sleep: async () => {} });

  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.rateLimitExhausted, false);
});

test("reports exhaustion after the final rate-limited attempt", async () => {
  let calls = 0;
  const result = await runWithLarkRateLimitRetry(async () => {
    calls += 1;
    return commandResult(5, "rate limited");
  }, {
    maxAttempts: 3,
    sleep: async () => {},
    now: () => 250,
  });

  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
  assert.equal(result.rateLimitExhausted, true);
});
