import assert from "node:assert/strict";
import test from "node:test";

import { createKeyedBatchQueue } from "./keyed_batch_queue.mjs";

test("coalesces items that arrive while the current batch is running", async () => {
  const queue = createKeyedBatchQueue();
  const batches = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const worker = async (items) => {
    batches.push(items);
    if (batches.length === 1) {
      await firstBlocked;
    }
  };

  const first = queue.enqueue("chat", 1, worker);
  const second = queue.enqueue("chat", 2, worker);
  const third = queue.enqueue("chat", 3, worker);
  assert.deepEqual(batches, [[1]]);

  releaseFirst();
  await Promise.all([first, second, third]);
  assert.deepEqual(batches, [[1], [2, 3]]);
  assert.equal(queue.keyCount, 0);
});

test("runs different keys independently", async () => {
  const queue = createKeyedBatchQueue();
  const started = [];
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const worker = async (items) => {
    started.push(items[0]);
    await blocked;
  };

  const left = queue.enqueue("left", "left", worker);
  const right = queue.enqueue("right", "right", worker);
  assert.deepEqual(started.sort(), ["left", "right"]);
  release();
  await Promise.all([left, right]);
});

test("splits waiting items at configured size and weight limits", async () => {
  const queue = createKeyedBatchQueue({
    maxBatchSize: 3,
    maxBatchWeight: 5,
    itemWeight: (item) => item.weight,
  });
  const batches = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const worker = async (items) => {
    batches.push(items.map((item) => item.id));
    if (batches.length === 1) {
      await firstBlocked;
    }
  };

  const promises = [
    queue.enqueue("chat", { id: 1, weight: 1 }, worker),
    queue.enqueue("chat", { id: 2, weight: 3 }, worker),
    queue.enqueue("chat", { id: 3, weight: 3 }, worker),
    queue.enqueue("chat", { id: 4, weight: 1 }, worker),
  ];
  releaseFirst();
  await Promise.all(promises);
  assert.deepEqual(batches, [[1], [2], [3, 4]]);
});
