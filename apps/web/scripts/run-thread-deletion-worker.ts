import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const {
  claimNextThreadDeletionJob,
  finalizeThreadDeletionJob,
  listQueuedThreadDeletionItems,
  markThreadDeletionItem,
  requeueThreadDeletionJob,
} = await import("../lib/agent/thread-deletion-jobs");
const { shouldRetryThreadDeletionGatewayStatus } = await import(
  "../lib/agent/thread-deletion-worker-policy"
);
const { deleteAgentThreadRecord } = await import("../lib/agent/thread-ownership");
const { getAuthDatabase } = await import("../lib/auth/database");

const gatewayBase = new URL(process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787");
const gatewayToken = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN?.trim() || null;
const tenantPin = process.env.COMMERCE_RUNTIME_TENANT_ID?.trim();
if (!tenantPin || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(tenantPin)) {
  throw new Error("COMMERCE_RUNTIME_TENANT_ID is required for the thread-deletion worker.");
}
const pollIntervalMs = 1_000;
let stopping = false;

class RetryableThreadDeletionInfrastructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableThreadDeletionInfrastructureError";
  }
}

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

console.log("Commerce thread-deletion worker started.");
try {
  while (!stopping) {
    const job = await claimNextThreadDeletionJob(tenantPin);
    if (!job) {
      await sleep(pollIntervalMs);
      continue;
    }
    const scope = {
      tenantId: job.tenantId,
      workspaceId: job.workspaceId,
      userId: job.userId,
    };
    try {
      const threadIds = await listQueuedThreadDeletionItems(scope, job.id);
      for (const threadId of threadIds) {
        await markThreadDeletionItem(scope, job.id, threadId, "running");
        try {
          let response: Response;
          try {
            response = await fetch(new URL(`/api/threads/${encodeURIComponent(threadId)}`, gatewayBase), {
              method: "DELETE",
              headers: gatewayHeaders(scope),
              signal: AbortSignal.timeout(90_000),
            });
          } catch (error) {
            throw new RetryableThreadDeletionInfrastructureError(
              error instanceof Error ? error.message : "Gateway request failed.",
            );
          }
          const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
          if (!response.ok) {
            const message = typeof payload?.error === "string"
              ? payload.error
              : `Gateway returned HTTP ${response.status}.`;
            if (shouldRetryThreadDeletionGatewayStatus(response.status)) {
              throw new RetryableThreadDeletionInfrastructureError(message);
            }
            throw new Error(message);
          }
          await deleteAgentThreadRecord(threadId, scope);
          await markThreadDeletionItem(scope, job.id, threadId, "deleted");
        } catch (error) {
          if (error instanceof RetryableThreadDeletionInfrastructureError) throw error;
          await markThreadDeletionItem(
            scope,
            job.id,
            threadId,
            "failed",
            error instanceof Error ? error.message : "Thread deletion failed.",
          );
        }
      }
      await finalizeThreadDeletionJob(scope, job.id);
    } catch (error) {
      await requeueThreadDeletionJob(
        scope,
        job.id,
        error instanceof Error ? error.message : "Deletion job execution failed.",
      ).catch(() => undefined);
      console.error(`Thread deletion job ${job.id} was requeued.`);
      await sleep(5_000);
    }
  }
} finally {
  await getAuthDatabase().end();
  console.log("Commerce thread-deletion worker stopped.");
}

function gatewayHeaders(scope: { tenantId: string; workspaceId: string; userId: string }): Headers {
  const headers = new Headers({
    "X-Commerce-Tenant-Id": scope.tenantId,
    "X-Commerce-Workspace-Id": scope.workspaceId,
    "X-Commerce-User-Id": scope.userId,
  });
  if (gatewayToken) headers.set("X-Commerce-Gateway-Token", gatewayToken);
  return headers;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
