import assert from "node:assert/strict";
import test from "node:test";

import { isInvalidPersistedThreadReference } from "./session_recovery.mjs";

test("recognizes an invalid persisted thread resume error", () => {
  assert.equal(isInvalidPersistedThreadReference({
    rpcMethod: "thread/resume",
    rpcCode: -32602,
    rpcMessage: "Thread not found",
  }), true);
  assert.equal(isInvalidPersistedThreadReference({
    rpcMethod: "thread/resume",
    rpcCode: -32000,
    rpcMessage: "任务不存在",
  }), true);
  assert.equal(isInvalidPersistedThreadReference({
    rpcMethod: "thread/resume",
    rpcCode: -32600,
    rpcMessage: "no rollout found for thread id 01abc",
  }), true);
});

test("does not classify active writer or unrelated errors as an invalid reference", () => {
  assert.equal(isInvalidPersistedThreadReference({
    rpcMethod: "thread/resume",
    rpcCode: -32600,
    rpcMessage: "already has an active writer",
  }), false);
  assert.equal(isInvalidPersistedThreadReference({
    rpcMethod: "thread/resume",
    rpcCode: -32602,
    rpcMessage: "invalid params",
  }), false);
  assert.equal(isInvalidPersistedThreadReference({
    rpcMethod: "turn/start",
    rpcCode: -32602,
    rpcMessage: "Thread not found",
  }), false);
});
