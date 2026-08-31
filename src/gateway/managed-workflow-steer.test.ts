import assert from "node:assert/strict";
import test from "node:test";

import { dispatchManagedWorkflowSteer } from "./managed-workflow-steer.js";

test("does not dispatch a managed steer whose client id is already committed", async () => {
  let activeChecks = 0;
  let dispatches = 0;
  const transition = await dispatchManagedWorkflowSteer({
    findCommittedTurnId: async () => "turn-existing",
    assertExpectedTurnActive: async () => {
      activeChecks += 1;
    },
    dispatch: async () => {
      dispatches += 1;
      return { turnId: "turn-duplicate" };
    },
    findCommittedTurnIdAfterFailure: async () => null,
  });

  assert.deepEqual(transition, {
    result: { turnId: "turn-existing" },
    alreadyCommitted: true,
  });
  assert.equal(activeChecks, 0);
  assert.equal(dispatches, 0);
});

test("returns alreadyCommitted when dispatch fails after Harness accepted the client id", async () => {
  const dispatchError = new Error("response connection lost");
  const transition = await dispatchManagedWorkflowSteer({
    findCommittedTurnId: async () => null,
    assertExpectedTurnActive: async () => undefined,
    dispatch: async () => {
      throw dispatchError;
    },
    findCommittedTurnIdAfterFailure: async () => "turn-active",
  });

  assert.deepEqual(transition, {
    result: { turnId: "turn-active" },
    alreadyCommitted: true,
  });
});

test("rethrows dispatch failure when Harness readback has no matching client id", async () => {
  const dispatchError = new Error("not accepted");
  await assert.rejects(
    dispatchManagedWorkflowSteer({
      findCommittedTurnId: async () => null,
      assertExpectedTurnActive: async () => undefined,
      dispatch: async () => {
        throw dispatchError;
      },
      findCommittedTurnIdAfterFailure: async () => null,
    }),
    dispatchError,
  );
});
