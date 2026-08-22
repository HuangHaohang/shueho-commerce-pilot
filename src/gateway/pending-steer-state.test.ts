import assert from "node:assert/strict";
import test from "node:test";

import { PendingSteerRegistry, ThreadOperationQueue } from "./pending-steer-state.js";

test("pending steers acknowledge only the FIFO front for a thread", () => {
  const registry = new PendingSteerRegistry();
  const first = registry.add({
    threadId: "thread-a",
    turnId: "turn-a",
    queuedSubmissionId: "queue-a",
    clientUserMessageId: "client-a",
    content: "A",
  });
  const second = registry.add({
    threadId: "thread-a",
    turnId: "turn-a",
    queuedSubmissionId: "queue-b",
    clientUserMessageId: "client-b",
    content: "B",
  });

  assert.equal(registry.acknowledgeFront("thread-a", second.clientUserMessageId), null);
  assert.deepEqual(registry.list("thread-a"), [first, second]);
  assert.deepEqual(registry.acknowledgeFront("thread-a", first.clientUserMessageId), first);
  assert.deepEqual(registry.acknowledgeFront("thread-a", second.clientUserMessageId), second);
  assert.deepEqual(registry.list("thread-a"), []);
});

test("pending steer snapshots hydrate with stable ordering and sequence", () => {
  const original = new PendingSteerRegistry();
  original.add({
    threadId: "thread-a",
    turnId: "turn-a",
    queuedSubmissionId: "queue-a",
    clientUserMessageId: "client-a",
    content: "A",
  });
  original.add({
    threadId: "thread-a",
    turnId: "turn-a",
    queuedSubmissionId: "queue-b",
    clientUserMessageId: "client-b",
    content: "B",
  });

  const restored = new PendingSteerRegistry();
  restored.hydrate(original.snapshot().reverse());
  const third = restored.add({
    threadId: "thread-a",
    turnId: "turn-a",
    queuedSubmissionId: "queue-c",
    clientUserMessageId: "client-c",
    content: "C",
  });

  expectPendingContent(restored, ["A", "B", "C"]);
  assert.equal(third.sequence, 3);
});

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

function expectPendingContent(registry: PendingSteerRegistry, expected: string[]): void {
  assert.deepEqual(
    registry.list("thread-a").map((state) => state.content),
    expected,
  );
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for the test condition.");
}
