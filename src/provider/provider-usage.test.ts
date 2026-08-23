import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProviderUsage } from "./provider-usage.js";

test("normalizes Responses usage including cache and reasoning subsets", () => {
  assert.deepEqual(
    normalizeProviderUsage({
      total_tokens: 150,
      input_tokens: 120,
      output_tokens: 30,
      input_tokens_details: { cached_tokens: 80 },
      output_tokens_details: { reasoning_tokens: 10 },
    }),
    {
      usageStatus: "reported",
      totalTokens: 150,
      inputTokens: 120,
      cachedInputTokens: 80,
      cacheWriteInputTokens: 0,
      outputTokens: 30,
      reasoningOutputTokens: 10,
    },
  );
});

test("marks absent image usage as missing without inventing token counts", () => {
  assert.deepEqual(normalizeProviderUsage(null), {
    usageStatus: "missing",
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  });
});
