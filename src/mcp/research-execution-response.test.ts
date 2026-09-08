import assert from "node:assert/strict";
import test from "node:test";
import { researchExecutionResponse } from "./research-execution-response.js";

test("short operations return their actual outcome", async () => {
  assert.equal(await researchExecutionResponse(Promise.resolve("completed"), () => "pending", 100), "completed");
});
test("long operations are invoked once and continue after the pending receipt", async () => {
  let completions = 0;
  let complete!: (value: string) => void;
  const operation = new Promise<string>((resolve) => { complete = resolve; }).then((value) => { completions += 1; return value; });
  assert.equal(await researchExecutionResponse(operation, () => "plan-id", 5), "plan-id");
  assert.equal(completions, 0);
  complete("completed");
  assert.equal(await operation, "completed");
  assert.equal(completions, 1);
});
test("late failures remain observed without replay or unhandled rejection", async () => {
  let fail!: (reason: Error) => void;
  const operation = new Promise<string>((_resolve, reject) => { fail = reject; });
  assert.equal(await researchExecutionResponse(operation, () => "pending", 5), "pending");
  fail(new Error("uncertain"));
  await assert.rejects(operation, /uncertain/);
});
