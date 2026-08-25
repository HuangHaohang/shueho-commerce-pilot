import nextEnv from "@next/env";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

nextEnv.loadEnvConfig(process.cwd());
loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });

const {
  claimNextThreadDeletionJob,
  finalizeThreadDeletionJob,
  listQueuedThreadDeletionItems,
  markThreadDeletionItem,
  requeueThreadDeletionJob,
} = await import("../lib/agent/thread-deletion-jobs");
const { deleteAgentThreadRecord } = await import("../lib/agent/thread-ownership");
const { getAuthDatabase } = await import("../lib/auth/database");

const gatewayBase = new URL(process.env.COMMERCE_GATEWAY_URL ?? "http://127.0.0.1:8787");
const gatewayToken = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN?.trim() || null;
const tenantPin = process.env.COMMERCE_RUNTIME_TENANT_ID?.trim() || null;
const pollIntervalMs = 1_000;
let stopping = false;

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
          const response = await fetch(new URL(`/api/threads/${encodeURIComponent(threadId)}`, gatewayBase), {
            method: "DELETE",
            headers: gatewayHeaders(scope),
            signal: AbortSignal.timeout(90_000),
          });
          const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
          if (!response.ok) {
            throw new Error(typeof payload?.error === "string" ? payload.error : `Gateway returned HTTP ${response.status}.`);
          }
          await deleteAgentThreadRecord(threadId, scope);
          await markThreadDeletionItem(scope, job.id, threadId, "deleted");
        } catch (error) {
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
