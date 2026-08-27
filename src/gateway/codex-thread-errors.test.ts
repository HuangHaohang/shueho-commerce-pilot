import assert from "node:assert/strict";
import test from "node:test";

import { isMissingCodexThreadError } from "./codex-thread-errors.js";

test("recognizes App Server missing-thread errors used by delete and read", () => {
  assert.equal(
    isMissingCodexThreadError(new Error("no rollout found for thread id thread_12345678")),
    true,
  );
  assert.equal(isMissingCodexThreadError(new Error("Thread thread_12345678 not found")), true);
  assert.equal(isMissingCodexThreadError(new Error("provider timeout")), false);
});
