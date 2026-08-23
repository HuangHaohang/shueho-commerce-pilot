export type NormalizedProviderUsage = {
  usageStatus: "reported" | "missing";
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export function normalizeProviderUsage(value: unknown): NormalizedProviderUsage {
  const usage = isRecord(value) ? value : {};
  const usageStatus = hasAnyUsageCount(usage) ? "reported" : "missing";
  const inputDetails = readRecord(usage.input_tokens_details, usage.inputTokensDetails);
  const outputDetails = readRecord(usage.output_tokens_details, usage.outputTokensDetails);
  const inputTokens = readCount(usage.input_tokens, usage.inputTokens);
  const outputTokens = readCount(usage.output_tokens, usage.outputTokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    readCount(
      usage.cached_input_tokens,
      usage.cachedInputTokens,
      inputDetails.cached_tokens,
      inputDetails.cachedTokens,
    ),
  );
  const cacheWriteInputTokens = Math.min(
    Math.max(0, inputTokens - cachedInputTokens),
    readCount(
      usage.cache_write_input_tokens,
      usage.cacheWriteInputTokens,
      usage.cache_creation_input_tokens,
      usage.cacheCreationInputTokens,
      inputDetails.cache_write_tokens,
      inputDetails.cacheWriteTokens,
    ),
  );
  const reasoningOutputTokens = Math.min(
    outputTokens,
    readCount(
      usage.reasoning_output_tokens,
      usage.reasoningOutputTokens,
      outputDetails.reasoning_tokens,
      outputDetails.reasoningTokens,
    ),
  );
  const reportedTotal = readCount(usage.total_tokens, usage.totalTokens);
  return {
    usageStatus,
    totalTokens: Math.max(reportedTotal, inputTokens + outputTokens),
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

function hasAnyUsageCount(usage: Record<string, unknown>): boolean {
  return [
    usage.total_tokens,
    usage.totalTokens,
    usage.input_tokens,
    usage.inputTokens,
    usage.output_tokens,
    usage.outputTokens,
  ].some((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function readRecord(...values: unknown[]): Record<string, unknown> {
  return values.find(isRecord) ?? {};
}

function readCount(...values: unknown[]): number {
  const value = values.find(
    (candidate) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0,
  );
  return typeof value === "number" ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
