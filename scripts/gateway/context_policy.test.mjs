import assert from "node:assert/strict";
import test from "node:test";

import { messageRequestsGroupHistory } from "./context_policy.mjs";

test("does not request group history for an ordinary follow-up", () => {
  assert.equal(messageRequestsGroupHistory("这个报错又出现了，继续排查"), false);
  assert.equal(messageRequestsGroupHistory("之前的问题又出现了"), false);
  assert.equal(messageRequestsGroupHistory("请看这张新截图"), false);
});

test("recognizes explicit Chinese group-history requests", () => {
  assert.equal(messageRequestsGroupHistory("结合上面的日志继续排查"), true);
  assert.equal(messageRequestsGroupHistory("请读取这个话题的历史消息"), true);
  assert.equal(messageRequestsGroupHistory("把群里之前的讨论也带上"), true);
  assert.equal(messageRequestsGroupHistory("#带上下文 帮我判断原因"), true);
});

test("recognizes explicit English group-history requests", () => {
  assert.equal(messageRequestsGroupHistory("Please review the earlier messages in this thread."), true);
  assert.equal(messageRequestsGroupHistory("Analyze this error with the previous logs."), true);
  assert.equal(messageRequestsGroupHistory("/context diagnose this failure"), true);
});
