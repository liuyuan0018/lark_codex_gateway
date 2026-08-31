import assert from "node:assert/strict";
import test from "node:test";

import {
  isPollableMessage,
  polledMessageSenderId,
  pollingRouteAcceptsChatMode,
} from "./poll_message_policy.mjs";

function message(sender, overrides = {}) {
  return {
    message_id: "om_message1",
    deleted: false,
    sender,
    ...overrides,
  };
}

test("polls user and external app messages", () => {
  assert.equal(isPollableMessage(message({ sender_type: "user", id: "ou_user" })), true);
  assert.equal(isPollableMessage(message({
    sender_type: "app",
    id: "cli_external_app",
    open_bot_id: "ou_external_bot",
  }), { botOpenId: "ou_gateway_bot" }), true);
});

test("filters the gateway bot by open bot id", () => {
  const ownMessage = message({
    sender_type: "app",
    id: "cli_gateway_app",
    open_bot_id: "ou_gateway_bot",
  });
  assert.equal(polledMessageSenderId(ownMessage), "ou_gateway_bot");
  assert.equal(isPollableMessage(ownMessage, { botOpenId: "ou_gateway_bot" }), false);
});

test("filters deleted, system, and malformed messages", () => {
  assert.equal(isPollableMessage(message({ sender_type: "app", id: "cli_app" }, { deleted: true })), false);
  assert.equal(isPollableMessage(message({ sender_type: "system", id: "system" })), false);
  assert.equal(isPollableMessage(message({ sender_type: "user", id: "ou_user" }, { message_id: "" })), false);
  assert.equal(isPollableMessage(message({ sender_type: "user", id: "" })), false);
});

test("regular chats require an explicit polling-route opt-in", () => {
  assert.equal(pollingRouteAcceptsChatMode("topic"), true);
  assert.equal(pollingRouteAcceptsChatMode("group"), false);
  assert.equal(pollingRouteAcceptsChatMode("group", true), true);
  assert.equal(pollingRouteAcceptsChatMode("p2p", true), false);
});
