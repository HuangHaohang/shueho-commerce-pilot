/** Readback is the only operation allowed when the plan has already been consumed. */
export async function repeatedPlanResult(
  code: string,
  planId: string,
  read: () => Promise<{ payload: Record<string, unknown>; isError: boolean }>,
): Promise<Record<string, unknown> | null> {
  if (code !== "PLAN_NOT_READY") return null;
  try {
    const existing = await read();
    if (existing.isError || !Array.isArray(existing.payload.products) || typeof existing.payload.processing_state !== "string") return null;
    return { ...existing.payload, plan_id: planId, reused: true };
  } catch { return null; }
}
