import assert from "node:assert/strict";
import test from "node:test";

import {
  buildThreadResumeParams,
  buildThreadStartParams,
  buildTurnStartParams,
} from "./codex_app_server.mjs";

test("Codex App Server requests keep the configured model and reasoning effort", () => {
  const common = {
    cwd: "C:\\workspace",
    model: "gpt-5.6-sol",
    effort: "high",
  };

  assert.deepEqual(buildThreadStartParams(common), {
    cwd: common.cwd,
    model: "gpt-5.6-sol",
    config: { model_reasoning_effort: "high" },
  });

  assert.deepEqual(buildThreadResumeParams({ ...common, threadId: "thread-id" }), {
    threadId: "thread-id",
    cwd: common.cwd,
    model: "gpt-5.6-sol",
    config: { model_reasoning_effort: "high" },
    excludeTurns: true,
  });

  const input = [{ type: "text", text: "hello" }];
  assert.deepEqual(buildTurnStartParams({ ...common, threadId: "thread-id", input }), {
    threadId: "thread-id",
    input,
    cwd: common.cwd,
    model: "gpt-5.6-sol",
    effort: "high",
  });
});
