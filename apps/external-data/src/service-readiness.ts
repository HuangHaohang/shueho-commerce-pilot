/** Infrastructure readiness is not a prediction of a paid provider call. */
export function serviceIsReady(input: {
  databaseConnected: boolean;
  models: { ok?: boolean };
  search: { status?: unknown };
}): boolean {
  return input.databaseConnected && input.models.ok !== false &&
    typeof input.search.status === "string" && input.search.status !== "unavailable";
}
