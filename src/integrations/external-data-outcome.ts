export function classifyExternalDataServiceOutcome(
  payload: Record<string, unknown>,
  isError: boolean,
): {
  upstreamCode: number | null;
  providerCompleted: boolean;
  businessUsable: boolean;
  settlementState: "succeeded" | "business_failed";
} {
  const upstreamCode = typeof payload.code === "number" ? payload.code : null;
  const providerCompleted = payload.provider_completed === true;
  const businessUsable = providerCompleted && payload.success === true && !isError;
  return {
    upstreamCode,
    providerCompleted,
    businessUsable,
    settlementState: providerCompleted ? "succeeded" : "business_failed",
  };
}
