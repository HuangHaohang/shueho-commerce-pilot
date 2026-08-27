import assert from "node:assert/strict";
import test from "node:test";

import { classifyExternalDataServiceOutcome } from "./external-data-outcome.js";

test("bills a completed provider call even when warehouse enrichment fails", () => {
  assert.deepEqual(classifyExternalDataServiceOutcome({
    success: false,
    provider_completed: true,
    processing_state: "failed",
    code: 0,
  }, true), {
    upstreamCode: 0,
    providerCompleted: true,
    businessUsable: false,
    settlementState: "succeeded",
  });
});

test("does not bill a provider business failure", () => {
  assert.deepEqual(classifyExternalDataServiceOutcome({
    success: false,
    provider_completed: false,
    code: 503,
  }, true), {
    upstreamCode: 503,
    providerCompleted: false,
    businessUsable: false,
    settlementState: "business_failed",
  });
});
