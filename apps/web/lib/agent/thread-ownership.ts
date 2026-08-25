import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";
import type { TaskCategory } from "@/lib/agent/task-category";

export type AgentThreadRecord = {
  threadId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "completed" | "interrupted" | "failed";
  activeTurnId: string | null;
  turnStartedAt: string | null;
  durationMs: number | null;
  titleModel: string | null;
  titleGeneratedAt: string | null;
  recipeId: "copywriting" | null;
  category: TaskCategory;
};

type AgentThreadRow = {
  thread_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  status: AgentThreadRecord["status"];
  active_turn_id: string | null;
  turn_started_at: Date | null;
  duration_ms: number | null;
  title_model: string | null;
  title_generated_at: Date | null;
  recipe_id: "copywriting" | null;
  category: TaskCategory;
};

export async function registerAgentThreadOwner(
  threadId: string,
  scope: EnterpriseScope,
  title: string,
  recipeId: "copywriting" | null = null,
  category: TaskCategory = recipeId === "copywriting" ? "creative" : "general",
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{ created_by_user_id: string }>(
      `
        INSERT INTO commerce_agent_thread
          (thread_id, user_id, created_by_user_id, tenant_id, workspace_id, title, recipe_id, category, updated_at, status)
        VALUES ($1, $2, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, 'idle')
        ON CONFLICT (thread_id) DO UPDATE
        SET title = CASE
              WHEN commerce_agent_thread.tenant_id = EXCLUDED.tenant_id
               AND commerce_agent_thread.workspace_id = EXCLUDED.workspace_id
               AND commerce_agent_thread.created_by_user_id = EXCLUDED.created_by_user_id
              THEN EXCLUDED.title ELSE commerce_agent_thread.title END,
            updated_at = CASE
              WHEN commerce_agent_thread.tenant_id = EXCLUDED.tenant_id
               AND commerce_agent_thread.workspace_id = EXCLUDED.workspace_id
               AND commerce_agent_thread.created_by_user_id = EXCLUDED.created_by_user_id
              THEN CURRENT_TIMESTAMP ELSE commerce_agent_thread.updated_at END,
            recipe_id = CASE
              WHEN commerce_agent_thread.tenant_id = EXCLUDED.tenant_id
               AND commerce_agent_thread.workspace_id = EXCLUDED.workspace_id
               AND commerce_agent_thread.created_by_user_id = EXCLUDED.created_by_user_id
              THEN COALESCE(EXCLUDED.recipe_id, commerce_agent_thread.recipe_id)
              ELSE commerce_agent_thread.recipe_id END,
            category = CASE
              WHEN commerce_agent_thread.tenant_id = EXCLUDED.tenant_id
               AND commerce_agent_thread.workspace_id = EXCLUDED.workspace_id
               AND commerce_agent_thread.created_by_user_id = EXCLUDED.created_by_user_id
              THEN EXCLUDED.category ELSE commerce_agent_thread.category END
        RETURNING created_by_user_id
      `,
      [threadId, scope.userId, scope.tenantId, scope.workspaceId, title, recipeId, category],
    );
    if (result.rows[0]?.created_by_user_id !== scope.userId) {
      throw new Error("Agent thread is already bound to another enterprise principal.");
    }
  });
}

export async function listAgentThreadsForUser(scope: EnterpriseScope, limit = 50): Promise<AgentThreadRecord[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<AgentThreadRow>(
      `
        SELECT thread_id, title, created_at, updated_at, status,
               active_turn_id, turn_started_at, duration_ms,
               title_model, title_generated_at, recipe_id, category
        FROM commerce_agent_thread
        WHERE tenant_id = $1 AND workspace_id = $2 AND created_by_user_id = $3
        ORDER BY COALESCE(turn_started_at, created_at) DESC, created_at DESC
        LIMIT $4
      `,
      [scope.tenantId, scope.workspaceId, scope.userId, limit],
    );
    return result.rows.map(toAgentThreadRecord);
  });
}

export async function getAgentThreadForUser(
  threadId: string,
  scope: EnterpriseScope,
): Promise<AgentThreadRecord | null> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<AgentThreadRow>(
      `
        SELECT thread_id, title, created_at, updated_at, status,
               active_turn_id, turn_started_at, duration_ms,
               title_model, title_generated_at, recipe_id, category
        FROM commerce_agent_thread
        WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4
        LIMIT 1
      `,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    return result.rows[0] ? toAgentThreadRecord(result.rows[0]) : null;
  });
}

export async function touchAgentThread(threadId: string, scope: EnterpriseScope): Promise<void> {
  await updateOwnedThread(
    threadId,
    scope,
    "UPDATE commerce_agent_thread SET updated_at = CURRENT_TIMESTAMP",
    [],
  );
}

export async function updateAgentThreadTitle(
  threadId: string,
  scope: EnterpriseScope,
  title: string,
): Promise<void> {
  await updateOwnedThread(
    threadId,
    scope,
    "UPDATE commerce_agent_thread SET title = $5, updated_at = CURRENT_TIMESTAMP",
    [title],
  );
}

export async function generateAgentThreadTitleOnce(
  threadId: string,
  scope: EnterpriseScope,
  generator: (record: AgentThreadRecord) => Promise<{
    title: string;
    model: string;
    category: TaskCategory;
  }>,
): Promise<{ title: string; model: string; category: TaskCategory; generated: boolean }> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `commerce-thread-title:${scope.tenantId}:${scope.workspaceId}:${threadId}`,
    ]);
    const result = await client.query<AgentThreadRow>(
      `
        SELECT thread_id, title, created_at, updated_at, status,
               active_turn_id, turn_started_at, duration_ms,
               title_model, title_generated_at, recipe_id, category
        FROM commerce_agent_thread
        WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4
        LIMIT 1
      `,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Agent thread is unavailable for title generation.");
    const record = toAgentThreadRecord(row);
    if (record.titleGeneratedAt && record.titleModel) {
      return {
        title: record.title,
        model: record.titleModel,
        category: record.category,
        generated: false,
      };
    }
    const generated = await generator(record);
    const update = await client.query(
      `
        UPDATE commerce_agent_thread
        SET title = $5, title_model = $6, category = $7,
            title_generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4
      `,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId, generated.title, generated.model, generated.category],
    );
    if (update.rowCount !== 1) throw new Error("Agent thread ownership changed during title generation.");
    return { ...generated, generated: true };
  });
}

export async function markAgentThreadRunning(
  threadId: string,
  scope: EnterpriseScope,
  turnId: string,
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `
        UPDATE commerce_agent_thread thread
        SET status = COALESCE(
              (SELECT completion.status
               FROM commerce_agent_turn_completion completion
               WHERE completion.tenant_id = $2 AND completion.workspace_id = $3
                 AND completion.root_thread_id = $1 AND completion.turn_id = $5),
              'running'
            ),
            active_turn_id = CASE
              WHEN EXISTS (
                SELECT 1 FROM commerce_agent_turn_completion completion
                WHERE completion.tenant_id = $2 AND completion.workspace_id = $3
                  AND completion.root_thread_id = $1 AND completion.turn_id = $5
              ) THEN NULL ELSE $5
            END,
            turn_started_at = CURRENT_TIMESTAMP,
            duration_ms = (
              SELECT completion.duration_ms
              FROM commerce_agent_turn_completion completion
              WHERE completion.tenant_id = $2 AND completion.workspace_id = $3
                AND completion.root_thread_id = $1 AND completion.turn_id = $5
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE thread.thread_id = $1 AND thread.tenant_id = $2
          AND thread.workspace_id = $3 AND thread.created_by_user_id = $4
      `,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId, turnId],
    );
    if (result.rowCount !== 1) {
      throw new Error("Agent thread ownership changed before the update completed.");
    }
  });
}

export async function updateAgentThreadStatus(
  threadId: string,
  scope: EnterpriseScope,
  status: AgentThreadRecord["status"],
  durationMs: number | null,
): Promise<void> {
  await updateOwnedThread(
    threadId,
    scope,
    `UPDATE commerce_agent_thread
     SET status = $5, active_turn_id = CASE WHEN $5 = 'running' THEN active_turn_id ELSE NULL END,
         duration_ms = $6`,
    [status, durationMs],
  );
}

export async function deleteAgentThreadRecord(threadId: string, scope: EnterpriseScope): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query(
      `DELETE FROM commerce_agent_turn_lease
       WHERE tenant_id = $2 AND workspace_id = $3 AND user_id = $4 AND thread_id = $1`,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    await client.query(
      `DELETE FROM commerce_agent_turn_completion
       WHERE tenant_id = $2 AND workspace_id = $3 AND root_thread_id = $1`,
      [threadId, scope.tenantId, scope.workspaceId],
    );
    await client.query(
      `DELETE FROM commerce_agent_thread
       WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4`,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId],
    );
  });
}

export async function isAgentThreadOwner(threadId: string, scope: EnterpriseScope): Promise<boolean> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `SELECT 1 FROM commerce_agent_thread
       WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4
       LIMIT 1`,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId],
    );
    return result.rowCount === 1;
  });
}

async function updateOwnedThread(
  threadId: string,
  scope: EnterpriseScope,
  updatePrefix: string,
  values: unknown[],
): Promise<void> {
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `${updatePrefix}
       WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4`,
      [threadId, scope.tenantId, scope.workspaceId, scope.userId, ...values],
    );
    if (result.rowCount !== 1) {
      throw new Error("Agent thread ownership changed before the update completed.");
    }
  });
}

function toAgentThreadRecord(row: AgentThreadRow): AgentThreadRecord {
  return {
    threadId: row.thread_id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    status: row.status,
    activeTurnId: row.active_turn_id,
    turnStartedAt: row.turn_started_at?.toISOString() ?? null,
    durationMs: row.duration_ms,
    titleModel: row.title_model,
    titleGeneratedAt: row.title_generated_at?.toISOString() ?? null,
    recipeId: row.recipe_id,
    category: row.category,
  };
}
