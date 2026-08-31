import { randomUUID } from "node:crypto";

import { assertApplicationDatabaseRoleSecurity, getAuthDatabase } from "@/lib/auth/database";
import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

export type ThreadDeletionJobStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type ThreadDeletionItemStatus = "queued" | "running" | "deleted" | "failed";

export type ThreadDeletionJob = {
  id: string;
  status: ThreadDeletionJobStatus;
  totalItems: number;
  completedItems: number;
  failedItems: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  items: Array<{
    threadId: string;
    status: ThreadDeletionItemStatus;
    error: string | null;
  }>;
};

export type ClaimedThreadDeletionJob = EnterpriseScope & { id: string };

const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export async function createThreadDeletionJob(
  scope: EnterpriseScope,
  threadIds: string[],
): Promise<ThreadDeletionJob> {
  const normalized = [...new Set(threadIds.map((value) => value.trim()))];
  if (normalized.length < 1 || normalized.length > 100 || normalized.some((id) => !THREAD_ID_PATTERN.test(id))) {
    throw new ThreadDeletionJobError("请选择 1 到 100 个有效任务。", 400);
  }
  const jobId = randomUUID();
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const owned = await client.query<{ thread_id: string }>(
      `SELECT thread_id FROM commerce_agent_thread
       WHERE tenant_id = $1 AND workspace_id = $2 AND created_by_user_id = $3
         AND thread_id = ANY($4::text[])`,
      [scope.tenantId, scope.workspaceId, scope.userId, normalized],
    );
    if (owned.rowCount !== normalized.length) {
      throw new ThreadDeletionJobError("部分任务不存在或不属于当前用户。", 404);
    }
    const inProgress = await client.query(
      `SELECT 1 FROM commerce_thread_deletion_item item
       JOIN commerce_thread_deletion_job job ON job.id = item.job_id
       WHERE item.tenant_id = $1 AND item.workspace_id = $2 AND item.user_id = $3
         AND item.thread_id = ANY($4::text[])
         AND job.status IN ('queued', 'running')
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, normalized],
    );
    if (inProgress.rowCount) {
      throw new ThreadDeletionJobError("选中的任务已经在删除队列中。", 409);
    }
    await client.query(
      `INSERT INTO commerce_thread_deletion_job
        (id, tenant_id, workspace_id, user_id, total_items)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, scope.tenantId, scope.workspaceId, scope.userId, normalized.length],
    );
    for (const [ordinal, threadId] of normalized.entries()) {
      await client.query(
        `INSERT INTO commerce_thread_deletion_item
          (job_id, tenant_id, workspace_id, user_id, thread_id, ordinal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [jobId, scope.tenantId, scope.workspaceId, scope.userId, threadId, ordinal],
      );
    }
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
       VALUES ($1, $2, $3, 'agent.thread.delete.queued', 'deletion_job', $4, 'succeeded',
               jsonb_build_object('threadCount', $5::integer))`,
      [scope.tenantId, scope.workspaceId, scope.userId, jobId, normalized.length],
    );
  });
  const job = await getThreadDeletionJob(scope, jobId);
  if (!job) throw new Error("Thread deletion job was not persisted.");
  return job;
}

export async function getThreadDeletionJob(
  scope: EnterpriseScope,
  jobId: string,
): Promise<ThreadDeletionJob | null> {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{
      id: string;
      status: ThreadDeletionJobStatus;
      total_items: number;
      completed_items: number;
      failed_items: number;
      error: string | null;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `SELECT id, status, total_items, completed_items, failed_items, error,
              created_at, started_at, completed_at
       FROM commerce_thread_deletion_job
       WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND user_id = $4`,
      [jobId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const items = await client.query<{
      thread_id: string;
      status: ThreadDeletionItemStatus;
      error: string | null;
    }>(
      `SELECT thread_id, status, error
       FROM commerce_thread_deletion_item
       WHERE job_id = $1
       ORDER BY ordinal`,
      [jobId],
    );
    return {
      id: row.id,
      status: row.status,
      totalItems: row.total_items,
      completedItems: row.completed_items,
      failedItems: row.failed_items,
      error: row.error,
      createdAt: row.created_at.toISOString(),
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
      items: items.rows.map((item) => ({
        threadId: item.thread_id,
        status: item.status,
        error: item.error,
      })),
    };
  });
}

export async function listActiveThreadDeletionJobs(
  scope: EnterpriseScope,
): Promise<ThreadDeletionJob[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const jobs = await client.query<{
      id: string;
      status: ThreadDeletionJobStatus;
      total_items: number;
      completed_items: number;
      failed_items: number;
      error: string | null;
      created_at: Date;
      started_at: Date | null;
      completed_at: Date | null;
    }>(
      `SELECT id, status, total_items, completed_items, failed_items, error,
              created_at, started_at, completed_at
       FROM commerce_thread_deletion_job
       WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
         AND status IN ('queued', 'running')
       ORDER BY created_at`,
      [scope.tenantId, scope.workspaceId, scope.userId],
    );
    const result: ThreadDeletionJob[] = [];
    for (const row of jobs.rows) {
      const items = await client.query<{
        thread_id: string;
        status: ThreadDeletionItemStatus;
        error: string | null;
      }>(
        `SELECT thread_id, status, error FROM commerce_thread_deletion_item
         WHERE job_id = $1 ORDER BY ordinal`,
        [row.id],
      );
      result.push({
        id: row.id,
        status: row.status,
        totalItems: row.total_items,
        completedItems: row.completed_items,
        failedItems: row.failed_items,
        error: row.error,
        createdAt: row.created_at.toISOString(),
        startedAt: row.started_at?.toISOString() ?? null,
        completedAt: row.completed_at?.toISOString() ?? null,
        items: items.rows.map((item) => ({
          threadId: item.thread_id,
          status: item.status,
          error: item.error,
        })),
      });
    }
    return result;
  });
}

export async function claimNextThreadDeletionJob(
  tenantId: string,
): Promise<ClaimedThreadDeletionJob | null> {
  if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(tenantId)) {
    throw new Error("A valid tenant pin is required to claim a thread deletion job.");
  }
  await assertApplicationDatabaseRoleSecurity();
  const client = await getAuthDatabase().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('commerce.tenant_id', $1, true)", [tenantId]);
    await client.query("SELECT set_config('commerce.tenant_wide', 'on', true)");
    const result = await client.query<{
      id: string;
      tenant_id: string;
      workspace_id: string;
      user_id: string;
    }>(
      `SELECT * FROM commerce_claim_thread_deletion_job($1::uuid)`,
      [tenantId],
    );
    await client.query("COMMIT");
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          workspaceId: row.workspace_id,
          userId: row.user_id,
        }
      : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listQueuedThreadDeletionItems(
  scope: EnterpriseScope,
  jobId: string,
): Promise<string[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{ thread_id: string }>(
      `SELECT thread_id FROM commerce_thread_deletion_item
       WHERE job_id = $1 AND status IN ('queued', 'running')
       ORDER BY ordinal`,
      [jobId],
    );
    return result.rows.map((row) => row.thread_id);
  });
}

export async function markThreadDeletionItem(
  scope: EnterpriseScope,
  jobId: string,
  threadId: string,
  status: "running" | "deleted" | "failed",
  error: string | null = null,
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `UPDATE commerce_thread_deletion_item
       SET status = $3,
           started_at = CASE WHEN $3 = 'running' THEN COALESCE(started_at, CURRENT_TIMESTAMP) ELSE started_at END,
           completed_at = CASE WHEN $3 IN ('deleted', 'failed') THEN CURRENT_TIMESTAMP ELSE NULL END,
           error = $4
       WHERE job_id = $1 AND thread_id = $2
         AND tenant_id = $5 AND workspace_id = $6 AND user_id = $7`,
      [jobId, threadId, status, error?.slice(0, 500) ?? null, scope.tenantId, scope.workspaceId, scope.userId],
    );
    if (result.rowCount !== 1) throw new Error("Thread deletion item ownership changed.");
    await client.query(
      `UPDATE commerce_thread_deletion_job SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [jobId],
    );
  });
}

export async function finalizeThreadDeletionJob(
  scope: EnterpriseScope,
  jobId: string,
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const counts = await client.query<{ deleted: string; failed: string; total: string }>(
      `SELECT
         count(*) FILTER (WHERE status = 'deleted')::text AS deleted,
         count(*) FILTER (WHERE status = 'failed')::text AS failed,
         count(*)::text AS total
       FROM commerce_thread_deletion_item
       WHERE job_id = $1`,
      [jobId],
    );
    const deleted = Number(counts.rows[0]?.deleted ?? 0);
    const failed = Number(counts.rows[0]?.failed ?? 0);
    const total = Number(counts.rows[0]?.total ?? 0);
    const status: ThreadDeletionJobStatus = failed === 0 ? "completed" : deleted > 0 ? "partial" : "failed";
    await client.query(
      `UPDATE commerce_thread_deletion_job
       SET status = $2, completed_items = $3, failed_items = $4,
           completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP,
           error = CASE WHEN $4 > 0 THEN '部分任务未能删除，请查看任务明细。' ELSE NULL END
       WHERE id = $1`,
      [jobId, status, deleted, failed],
    );
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id, workspace_id, actor_user_id, action, target_type, target_id, outcome, metadata)
       VALUES ($1, $2, $3, 'agent.thread.delete.completed', 'deletion_job', $4, $5,
               jsonb_build_object('deleted', $6::integer, 'failed', $7::integer, 'total', $8::integer))`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        jobId,
        status === "completed" ? "succeeded" : "failed",
        deleted,
        failed,
        total,
      ],
    );
  });
}

export async function requeueThreadDeletionJob(
  scope: EnterpriseScope,
  jobId: string,
  error: string,
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query(
      `UPDATE commerce_thread_deletion_job
       SET status = 'queued', updated_at = CURRENT_TIMESTAMP, error = $2
       WHERE id = $1 AND status = 'running'`,
      [jobId, error.slice(0, 500)],
    );
  });
}

export class ThreadDeletionJobError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "ThreadDeletionJobError";
  }
}
