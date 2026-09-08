import type { JsonObject } from "./types.js";

export function providerExecutionStatus(input: {
  rawState: string; processingState: string; dispatchState: string | null;
  deadlineAt: Date | null; nextAttemptAt: Date | null; waitReason: string | null;
  attemptCount: number | null; failureCode: string | null; providerCode: number | null;
}, now = Date.now()): JsonObject {
  const interrupted = input.rawState === "dispatched" && input.dispatchState === "active" &&
    input.deadlineAt !== null && input.deadlineAt.getTime() <= now;
  const unknown = input.rawState === "unknown" || input.dispatchState === "unknown" || interrupted;
  const terminal = ["business_failed", "unknown"].includes(input.rawState) || input.processingState === "completed" || unknown;
  const waiting = !terminal && input.dispatchState === "active" && input.waitReason !== null;
  const retryAfterSeconds = terminal ? null : waiting && input.nextAttemptAt
    ? Math.max(5, Math.ceil((input.nextAttemptAt.getTime() - now) / 1000)) : 15;
  return {
    phase: unknown ? "reconciliation_required" : input.processingState === "completed" ? "completed"
      : input.rawState === "business_failed" ? "failed" : waiting ? input.waitReason
      : input.rawState === "succeeded" ? "processing" : "collecting",
    attemptCount: input.attemptCount,
    automaticRetry: waiting && (input.attemptCount ?? 0) > 0 && ["retry_backoff", "rate_limited", "proxy_unavailable", "token_cooldown"].includes(input.waitReason!),
    nextAttemptAt: waiting ? input.nextAttemptAt?.toISOString() ?? null : null,
    lastProviderCode: input.providerCode,
    failureCode: interrupted ? "EXECUTION_DEADLINE_EXCEEDED_RECONCILIATION_REQUIRED" : input.failureCode,
    polling: { action: unknown ? "reconcile" : terminal ? "stop" : "poll_same_request", retryAfterSeconds },
  };
}

export function workflowPolling(status: string, children: JsonObject[]): JsonObject {
  if (status === "unknown" || children.some((child) => child.phase === "reconciliation_required")) {
    return { action: "reconcile", retryAfterSeconds: null };
  }
  if (!["planned", "running"].includes(status)) return { action: "stop", retryAfterSeconds: null };
  const intervals = children.flatMap((child) => {
    const polling = child.polling as JsonObject | undefined;
    return polling?.action === "poll_same_request" && typeof polling.retryAfterSeconds === "number"
      ? [polling.retryAfterSeconds] : [];
  });
  return { action: "poll_same_request", retryAfterSeconds: intervals.length ? Math.min(...intervals) : 15 };
}
