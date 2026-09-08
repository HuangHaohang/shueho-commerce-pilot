import assert from "node:assert/strict";
import { test } from "node:test";
import { repeatedPlanResult } from "./repeated-plan-result.js";

test("a repeated consumed plan reads its existing status without restarting work", async () => {
  let reads = 0;
  const result = await repeatedPlanResult("PLAN_NOT_READY", "plan", async () => {
    reads += 1;
    return { isError: false, payload: { success: false, processing_state: "unknown", products: [], research_request_id: "workflow" } };
  });
  assert.equal(reads, 1);
  assert.deepEqual(result, { success: false, processing_state: "unknown", products: [], research_request_id: "workflow", plan_id: "plan", reused: true });
});
test("authorization/identity failures do not trigger result reads", async () => {
  for (const code of ["PLAN_NOT_FOUND", "PLAN_SUBJECT_MISMATCH", "INVALID_MARKETPLACE_PLAN_RECEIPT"]) {
    assert.equal(await repeatedPlanResult(code, "plan", async () => { throw new Error("must not read"); }), null);
  }
});
test("an expired unexecuted plan or a read outage never fabricates a receipt", async () => {
  assert.equal(await repeatedPlanResult("PLAN_NOT_READY", "plan", async () => ({ isError: true, payload: {} })), null);
  assert.equal(await repeatedPlanResult("PLAN_NOT_READY", "plan", async () => { throw new Error("unavailable"); }), null);
});
