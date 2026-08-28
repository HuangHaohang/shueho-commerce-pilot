import assert from "node:assert/strict";
import test from "node:test";

import { ThreadOperationQueue } from "./thread-operation-queue.js";

test("thread operations stay FIFO and one failure does not block the next operation", async () => {
  const queue = new ThreadOperationQueue();
  const observed: string[] = [];
  const firstGate = createDeferred();

  const first = queue.run("thread-a", async () => {
    observed.push("A:start");
    await firstGate.promise;
    observed.push("A:end");
  });
  const second = queue.run("thread-a", async () => {
    observed.push("B:start");
    throw new Error("expected failure");
  });
  void second.catch(() => undefined);
  const third = queue.run("thread-a", async () => {
    observed.push("C:start");
    observed.push("C:end");
  });

  await waitFor(() => observed.length === 1);
  assert.deepEqual(observed, ["A:start"]);
  firstGate.resolve();
  await first;
  await assert.rejects(second, /expected failure/);
  await third;
  assert.deepEqual(observed, ["A:start", "A:end", "B:start", "C:start", "C:end"]);
});

test("different threads do not block each other", async () => {
  const queue = new ThreadOperationQueue();
  const observed: string[] = [];
  const gateA = createDeferred();

  const threadA = queue.run("thread-a", async () => {
    observed.push("A:start");
    await gateA.promise;
    observed.push("A:end");
  });
  const threadB = queue.run("thread-b", async () => {
    observed.push("B:start");
    observed.push("B:end");
  });

  await threadB;
  assert.deepEqual(observed, ["A:start", "B:start", "B:end"]);
  gateA.resolve();
  await threadA;
});

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for the test condition.");
}
