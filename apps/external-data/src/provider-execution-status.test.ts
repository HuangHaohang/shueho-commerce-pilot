import { expect, it } from "vitest";
import { providerExecutionStatus, workflowPolling } from "./provider-execution-status.js";

const active = { rawState: "dispatched", processingState: "collecting", dispatchState: "active", deadlineAt: new Date(100_000),
  nextAttemptAt: new Date(60_000), waitReason: "rate_limited", attemptCount: 1, failureCode: null, providerCode: 302 };
it("tells clients when to poll the same request during backoff", () => {
  expect(providerExecutionStatus(active, 10_000)).toMatchObject({
    phase: "rate_limited", automaticRetry: true, attemptCount: 1,
    polling: { action: "poll_same_request", retryAfterSeconds: 50 },
  });
});
it("stops blind polling after an execution deadline and never authorizes replay", () => {
  expect(providerExecutionStatus(active, 101_000)).toMatchObject({
    phase: "reconciliation_required", automaticRetry: false, polling: { action: "reconcile", retryAfterSeconds: null },
  });
  expect(workflowPolling("running", [providerExecutionStatus(active, 101_000)]))
    .toEqual({ action: "reconcile", retryAfterSeconds: null });
});
it("does not call a completed response uncertain merely because local processing takes longer", () => {
  expect(providerExecutionStatus({ ...active, rawState: "succeeded", dispatchState: "completed", processingState: "enriching" }, 101_000))
    .toMatchObject({ phase: "processing", automaticRetry: false, polling: { action: "poll_same_request" } });
});

it("does not invent a zero attempt count for pre-ledger archived calls", () => {
  expect(providerExecutionStatus({ ...active, rawState: "succeeded", processingState: "completed", dispatchState: null, attemptCount: null }, 10_000))
    .toMatchObject({ phase: "completed", attemptCount: null, automaticRetry: false });
});
