import { describe, expect, it } from "vitest";

import { reconcilePendingInputState, type QueuedMessage } from "./pending-input-state";

const queueA: QueuedMessage = {
  id: "queue-a",
  clientUserMessageId: "client-a",
  content: "A",
  pendingSteer: false,
};
const queueB: QueuedMessage = {
  id: "queue-b",
  clientUserMessageId: "client-b",
  content: "B",
  pendingSteer: false,
};

describe("pending input reconciliation", () => {
  it("keeps a locally promoted steer out of a stale server queue snapshot", () => {
    const state = reconcilePendingInputState(
      [queueA, queueB],
      [],
      [{ ...queueA, pendingSteer: true }],
      new Set(),
    );

    expect(state.queue).toEqual([queueB]);
    expect(state.pendingSteers).toEqual([{ ...queueA, pendingSteer: true }]);
  });

  it("removes a committed steer from both pending and stale queue snapshots", () => {
    const state = reconcilePendingInputState(
      [queueA, queueB],
      [{ ...queueA, pendingSteer: true }],
      [{ ...queueA, pendingSteer: true }],
      new Set([queueA.clientUserMessageId]),
    );

    expect(state.queue).toEqual([queueB]);
    expect(state.pendingSteers).toEqual([]);
  });

  it("preserves server FIFO order before locally in-flight steers", () => {
    const queueC = {
      id: "queue-c",
      clientUserMessageId: "client-c",
      content: "C",
      pendingSteer: true,
    };
    const state = reconcilePendingInputState(
      [],
      [{ ...queueA, pendingSteer: true }, { ...queueB, pendingSteer: true }],
      [queueC],
      new Set(),
    );

    expect(state.pendingSteers.map((item) => item.content)).toEqual(["A", "B", "C"]);
  });
});
