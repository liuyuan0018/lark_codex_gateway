import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTopicInitializationPrompt,
  normalizePersistedTopicAssignment,
  topicSetupShouldRun,
} from "./topic_setup.mjs";

test("legacy assignments are never reinitialized after the upgrade", () => {
  const assignment = normalizePersistedTopicAssignment({
    threadId: "00000000-0000-0000-0000-000000000001",
    initializationPending: true,
  }, 4);
  assert.equal(assignment.setupStatus, "legacy");
  assert.equal(assignment.initializationPending, false);
  assert.equal(topicSetupShouldRun(assignment), false);
});

test("new pending assignments keep their one-time setup state", () => {
  const assignment = normalizePersistedTopicAssignment({
    threadId: "00000000-0000-0000-0000-000000000002",
    setupStatus: "pending",
    setupId: "setup-id",
    skillName: "incident-triage",
    skillVersion: "123456789abc",
  }, 5);
  assert.equal(assignment.setupStatus, "pending");
  assert.equal(assignment.initializationPending, true);
  assert.equal(topicSetupShouldRun(assignment), true);
});

test("the short route prompt invokes the configured project skill", () => {
  const prompt = buildTopicInitializationPrompt({
    initializationPrompt: "Handle one incident topic.",
    skillName: "incident-triage",
  });
  assert.match(prompt, /Handle one incident topic\./);
  assert.match(prompt, /\$incident-triage/);
  assert.match(prompt, /AGENTS\.md/);
});
