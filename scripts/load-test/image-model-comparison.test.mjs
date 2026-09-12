import assert from "node:assert/strict";
import test from "node:test";

import { readImageComparisonConfig } from "./image-model-comparison.mjs";

const valid = {
  IMAGE_COMPARISON_AUTHORIZATION: "server244-image-model-comparison-2026-09-12",
  IMAGE_COMPARISON_MODEL: "gpt-image-2.5-flare",
  IMAGE_COMPARISON_QUALITY: "high",
  IMAGE_COMPARISON_BASE_URL: "https://commerce.shueho.com",
  IMAGE_COMPARISON_USER_OFFSET: "10",
  IMAGE_COMPARISON_OUTPUT_DIR: "/tmp/production-load/results",
  IMAGE_COMPARISON_USERS_FILE: "/tmp/production-load/users.json",
};

test("accepts exactly the three requested comparison models and six provider qualities", () => {
  for (const model of ["gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]) {
    for (const quality of ["low", "medium", "high", "xhigh", "max", "auto"]) {
      assert.equal(readImageComparisonConfig({ ...valid, IMAGE_COMPARISON_MODEL: model, IMAGE_COMPARISON_QUALITY: quality }).model, model);
    }
  }
  assert.throws(() => readImageComparisonConfig({ ...valid, IMAGE_COMPARISON_MODEL: "gpt-image-2.5" }), /Compare only/);
});

test("rejects non-production targets, missing authorization and invalid fixture slices", () => {
  for (const changed of [
    { IMAGE_COMPARISON_AUTHORIZATION: "wrong" },
    { IMAGE_COMPARISON_BASE_URL: "http://commerce.shueho.com" },
    { IMAGE_COMPARISON_BASE_URL: "https://example.com" },
    { IMAGE_COMPARISON_USER_OFFSET: "95" },
    { IMAGE_COMPARISON_OUTPUT_DIR: "/tmp/results" },
  ]) assert.throws(() => readImageComparisonConfig({ ...valid, ...changed }));
});
