export const EXTERNAL_DATA_APPROVAL_MODES = ["always_ask", "task", "policy"] as const;
export type ExternalDataApprovalMode = (typeof EXTERNAL_DATA_APPROVAL_MODES)[number];

export function requiresExternalDataApproval(
  policy: {
    approvalMode: ExternalDataApprovalMode;
    perCallAutoApprovalMicros: number | null;
  },
  requested: ExternalDataApprovalMode,
  priceMicros: number | null,
): boolean {
  if (requested === "always_ask") return true;
  const rank: Record<ExternalDataApprovalMode, number> = {
    always_ask: 0,
    task: 1,
    policy: 2,
  };
  if (rank[policy.approvalMode] < rank[requested]) return true;
  if (requested === "task") return false;
  const ceiling = policy.perCallAutoApprovalMicros;
  return priceMicros === null || ceiling === null || priceMicros > ceiling;
}

export function approvalModeAfterTaskBoundary(
  current: ExternalDataApprovalMode,
): ExternalDataApprovalMode {
  return current === "task" ? "always_ask" : current;
}
