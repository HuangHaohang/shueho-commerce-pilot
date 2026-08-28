const QUOTA_CODES = new Set([
  "EXTERNAL_DATA_TURN_CALL_LIMIT",
  "EXTERNAL_DATA_CALL_LIMIT",
  "EXTERNAL_DATA_SPEND_LIMIT",
]);

export function marketplacePlanFailureInstruction(
  code: string,
  details: Record<string, unknown>,
): string | null {
  if (!QUOTA_CODES.has(code)) return null;
  const maximumSample = firstNonnegativeInteger(
    details.maximumDetailSampleSize,
    details.maximumDetailSampleSizeBySpend,
  );
  if (maximumSample !== null && maximumSample >= 1) {
    return [
      `The free quote allows at most ${maximumSample} representative product(s) under current policy.`,
      "Your next action MUST be the native request_user_input tool with exactly one question and two choices:",
      `reduce to ${maximumSample} representative product(s) and continue, or pause for an administrator policy change.`,
      "Do not emit a normal assistant message, numbered list, or ask any question before calling request_user_input.",
      `Only after the user accepts may you create one new free plan with detail_sample_size=${maximumSample}; never execute the rejected plan.`,
    ].join(" ");
  }
  return [
    "The free quote allows no paid marketplace workflow under current policy.",
    "Your next action MUST be native request_user_input with exactly one question asking whether to pause or wait for an administrator policy change.",
    "Do not emit a normal assistant message or numbered choices, and do not create or execute another paid plan without a policy change.",
  ].join(" ");
}

function firstNonnegativeInteger(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}
