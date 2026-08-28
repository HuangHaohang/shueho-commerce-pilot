import assert from "node:assert/strict";
import test from "node:test";

import { marketplacePlanFailureInstruction } from "./marketplace-plan-guidance.js";

test("forces one native Harness question after a free quote reduces representative coverage", () => {
  const instruction = marketplacePlanFailureInstruction("EXTERNAL_DATA_TURN_CALL_LIMIT", {
    maximumDetailSampleSize: 1,
  });
  assert.match(instruction ?? "", /MUST be the native request_user_input tool/);
  assert.match(instruction ?? "", /detail_sample_size=1/);
  assert.match(instruction ?? "", /Do not emit a normal assistant message, numbered list/);
});

test("does not replace unrelated planning guidance", () => {
  assert.equal(marketplacePlanFailureInstruction("MARKET_UNSUPPORTED", {}), null);
});
