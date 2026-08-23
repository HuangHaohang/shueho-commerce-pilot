export type ThreadContextUsage = {
  threadId: string;
  turnId: string;
  inputTokens: number;
  totalTokens: number;
  modelContextWindow: number;
  utilization: number;
};

export function readThreadContextUsage(params: unknown): ThreadContextUsage | null {
  if (!isRecord(params)) {
    return null;
  }
  const threadId = typeof params.threadId === "string" ? params.threadId : "";
  const turnId = typeof params.turnId === "string" ? params.turnId : "";
  const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null;
  const last = tokenUsage && isRecord(tokenUsage.last) ? tokenUsage.last : null;
  const inputTokens = last ? readFiniteNumber(last.inputTokens) : null;
  const totalTokens = last ? readFiniteNumber(last.totalTokens) : null;
  const modelContextWindow = tokenUsage ? readFiniteNumber(tokenUsage.modelContextWindow) : null;
  if (
    !threadId ||
    !turnId ||
    inputTokens === null ||
    totalTokens === null ||
    modelContextWindow === null ||
    modelContextWindow <= 0
  ) {
    return null;
  }
  return {
    threadId,
    turnId,
    inputTokens,
    totalTokens,
    modelContextWindow,
    utilization: totalTokens / modelContextWindow,
  };
}

export function shouldAutoCompact(usage: ThreadContextUsage | undefined, thresholdPercent: number): boolean {
  return Boolean(usage && usage.utilization >= thresholdPercent / 100);
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
