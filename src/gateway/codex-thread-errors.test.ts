import assert from "node:assert/strict";
import test from "node:test";

import { isMissingCodexThreadError, isUnmaterializedCodexThreadError } from "./codex-thread-errors.js";

test("recognizes App Server missing-thread errors used by delete and read", () => {
  assert.equal(
    isMissingCodexThreadError(new Error("no rollout found for thread id thread_12345678")),
    true,
  );
  assert.equal(isMissingCodexThreadError(new Error("Thread thread_12345678 not found")), true);
  assert.equal(isMissingCodexThreadError(new Error("provider timeout")), false);
});

test("distinguishes native unmaterialized threads from lost history and generic failures", () => {
  assert.equal(isUnmaterializedCodexThreadError(new Error("thread thread_12345678 is not materialized yet; thread/turns/list is unavailable before first user message")), true);
  for (const message of ["Thread not found.", "provider timeout", "rollout file is empty", "thread thread_12345678 is not materialized yet"]) {
    assert.equal(isUnmaterializedCodexThreadError(new Error(message)), false);
  }
});
