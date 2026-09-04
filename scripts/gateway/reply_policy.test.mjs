import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReplyDecisionInstructions,
  isAutomatedFailureCard,
  noReplyObservationFields,
  shouldSuppressReply,
  topicReplyNeedsApproval,
} from "./reply_policy.mjs";

test("topic messages require an explicit reply decision", () => {
  const instructions = buildReplyDecisionInstructions({ topicMessage: true });
  assert.ok(instructions.some((line) => line.includes("每条话题消息")));
  assert.ok(instructions.some((line) => line.includes("[NO_REPLY]")));
});

test("an authorized explicit Bot command cannot choose no reply", () => {
  const instructions = buildReplyDecisionInstructions({ topicMessage: true, forceReply: true });
  assert.ok(instructions.some((line) => line.includes("必须把当前请求作为需要执行并回复的 Bot 指令")));
});

test("automated failure cards require intervention even without a human question", () => {
  const instructions = buildReplyDecisionInstructions({
    topicMessage: true,
    automatedFailureCard: true,
  });
  assert.ok(instructions.some((line) => line.includes("外部应用发送的构建/运行失败卡片")));
  assert.ok(instructions.some((line) => line.includes("不得因为它是卡片")));
});

test("automated failure card detection is limited to failure-like interactive cards", () => {
  assert.equal(isAutomatedFailureCard("interactive", '<card title="构建失败">...'), true);
  assert.equal(isAutomatedFailureCard("interactive", "构建完成"), false);
  assert.equal(isAutomatedFailureCard("text", "构建失败"), false);
});

test("only the exact no-reply token suppresses delivery", () => {
  assert.equal(shouldSuppressReply("[NO_REPLY]"), true);
  assert.equal(shouldSuppressReply("  [NO_REPLY]\n"), true);
  assert.equal(shouldSuppressReply("[NO_REPLY] because it is handled"), false);
  assert.equal(shouldSuppressReply("无需回复"), false);
});

test("a no-reply decision has its own successful observable stage", () => {
  assert.deepEqual(noReplyObservationFields(25), {
    stage: "no_reply",
    status: "success",
    summary: "Codex Agent 判断无需回复",
    replyDecision: "no_reply",
    durationMs: 25,
  });
});

test("ordinary chat replies never enter topic approval", () => {
  assert.equal(topicReplyNeedsApproval({ source: "message", topicRoute: undefined }), false);
});

test("topic routes require approval by default", () => {
  assert.equal(topicReplyNeedsApproval({ source: "message", topicRoute: {} }), true);
});

test("a topic route can disable reply approval", () => {
  assert.equal(
    topicReplyNeedsApproval({ source: "message", topicRoute: { replyApprovalRequired: false } }),
    false,
  );
});

test("document comments never enter topic reply approval", () => {
  assert.equal(topicReplyNeedsApproval({ source: "doc_comment", topicRoute: {} }), false);
});
