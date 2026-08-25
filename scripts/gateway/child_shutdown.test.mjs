import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { terminateChildProcess } from "./child_shutdown.mjs";

class FakeChild extends EventEmitter {
  constructor({ exitOnTerm = true } = {}) {
    super();
    this.pid = 12345;
    this.exitCode = null;
    this.signalCode = null;
    this.signals = [];
    this.stdin = {
      destroyed: false,
      ended: false,
      end: () => {
        this.stdin.ended = true;
      },
    };
    this.exitOnTerm = exitOnTerm;
  }

  kill(signal) {
    this.signals.push(signal);
    if (signal === "SIGKILL" || this.exitOnTerm) {
      this.signalCode = signal;
      queueMicrotask(() => this.emit("exit", null, signal));
    }
    return true;
  }
}

test("shutdown waits for the subscription child to exit after TERM", async () => {
  const child = new FakeChild();
  const result = await terminateChildProcess(child, { graceMs: 5, killWaitMs: 5 });

  assert.deepEqual(result, { exited: true, forced: false });
  assert.equal(child.stdin.ended, true);
  assert.deepEqual(child.signals, ["SIGTERM"]);
});

test("shutdown escalates to KILL and still waits for child exit", async () => {
  const child = new FakeChild({ exitOnTerm: false });
  const result = await terminateChildProcess(child, { graceMs: 1, killWaitMs: 5 });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("shutdown waits for the whole subscription process group", async () => {
  const child = new FakeChild();
  let groupAlive = true;
  const result = await terminateChildProcess(child, {
    graceMs: 1,
    killWaitMs: 5,
    processGroupId: child.pid,
    groupExists: () => groupAlive,
    sendSignal: (target, signal) => {
      target.kill(signal);
      if (signal === "SIGKILL") {
        groupAlive = false;
      }
    },
  });

  assert.deepEqual(result, { exited: true, forced: true });
  assert.equal(groupAlive, false);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});
