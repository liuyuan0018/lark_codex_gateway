import assert from "node:assert/strict";
import test from "node:test";

import { isActiveWriterConflict, runWithActiveWriterRetry } from "./active_writer_retry.mjs";

function activeWriterError() {
  const error = new Error("thread/resume failed");
  error.rpcCode = -32600;
  error.rpcMessage = "Thread already has an active writer";
  error.rpcMethod = "thread/resume";
  return error;
}

test("active writer conflict retries with bounded exponential backoff and then succeeds", async () => {
  let calls = 0;
  const delays = [];
  const result = await runWithActiveWriterRetry(async () => {
    calls += 1;
    if (calls < 3) {
      throw activeWriterError();
    }
    return "ok";
  }, {
    maxAttempts: 4,
    initialDelayMs: 10,
    maxDelayMs: 15,
    sleep: async (delayMs) => delays.push(delayMs),
    now: () => 100,
  });

  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [10, 15]);
});

test("active writer exhaustion reaches the final failure path exactly once", async () => {
  let attempts = 0;
  let failureNotifications = 0;
  let finalError;
  try {
    await runWithActiveWriterRetry(async () => {
      attempts += 1;
      throw activeWriterError();
    }, {
      maxAttempts: 3,
      sleep: async () => {},
      now: () => 250,
    });
  } catch (error) {
    finalError = error;
    failureNotifications += 1;
  }

  assert.equal(isActiveWriterConflict(finalError), true);
  assert.equal(attempts, 3);
  assert.equal(finalError.activeWriterRetryAttempts, 3);
  assert.equal(failureNotifications, 1);
});

test("other JSON-RPC errors are not retried", async () => {
  let attempts = 0;
  const error = activeWriterError();
  error.rpcCode = -32601;
  await assert.rejects(runWithActiveWriterRetry(async () => {
    attempts += 1;
    throw error;
  }, { sleep: async () => {} }), error);
  assert.equal(attempts, 1);
});
