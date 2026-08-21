import { getAuthDatabase } from "@/lib/auth/database";

export type AgentThreadRecord = {
  threadId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "idle" | "running" | "completed" | "interrupted" | "failed";
  activeTurnId: string | null;
  turnStartedAt: string | null;
  durationMs: number | null;
};

export async function registerAgentThreadOwner(threadId: string, userId: string, title: string): Promise<void> {
  const result = await getAuthDatabase().query<{ user_id: string }>(
    `
      INSERT INTO commerce_agent_thread (thread_id, user_id, title, updated_at, status)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'idle')
      ON CONFLICT (thread_id) DO UPDATE
      SET user_id = commerce_agent_thread.user_id,
          title = CASE WHEN commerce_agent_thread.user_id = EXCLUDED.user_id THEN EXCLUDED.title ELSE commerce_agent_thread.title END,
          updated_at = CASE WHEN commerce_agent_thread.user_id = EXCLUDED.user_id THEN CURRENT_TIMESTAMP ELSE commerce_agent_thread.updated_at END
      RETURNING user_id
    `,
    [threadId, userId, title],
  );
  if (result.rows[0]?.user_id !== userId) {
    throw new Error("Agent thread is already owned by another user.");
  }
}

export async function listAgentThreadsForUser(userId: string, limit = 50): Promise<AgentThreadRecord[]> {
  const result = await getAuthDatabase().query<{
    thread_id: string;
    title: string;
    created_at: Date;
    updated_at: Date;
    status: AgentThreadRecord["status"];
    active_turn_id: string | null;
    turn_started_at: Date | null;
    duration_ms: number | null;
  }>(
    `
      SELECT thread_id, title, created_at, updated_at, status, active_turn_id, turn_started_at, duration_ms
      FROM commerce_agent_thread
      WHERE user_id = $1
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [userId, limit],
  );
  return result.rows.map((row) => ({
    threadId: row.thread_id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    status: row.status,
    activeTurnId: row.active_turn_id,
    turnStartedAt: row.turn_started_at?.toISOString() ?? null,
    durationMs: row.duration_ms,
  }));
}

export async function getAgentThreadForUser(threadId: string, userId: string): Promise<AgentThreadRecord | null> {
  const result = await getAuthDatabase().query<{
    thread_id: string;
    title: string;
    created_at: Date;
    updated_at: Date;
    status: AgentThreadRecord["status"];
    active_turn_id: string | null;
    turn_started_at: Date | null;
    duration_ms: number | null;
  }>(
    `
      SELECT thread_id, title, created_at, updated_at, status, active_turn_id, turn_started_at, duration_ms
      FROM commerce_agent_thread
      WHERE thread_id = $1 AND user_id = $2
      LIMIT 1
    `,
    [threadId, userId],
  );
  const row = result.rows[0];
  return row
    ? {
        threadId: row.thread_id,
        title: row.title,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        status: row.status,
        activeTurnId: row.active_turn_id,
        turnStartedAt: row.turn_started_at?.toISOString() ?? null,
        durationMs: row.duration_ms,
      }
    : null;
}

export async function touchAgentThread(threadId: string, userId: string): Promise<void> {
  await getAuthDatabase().query(
    `UPDATE commerce_agent_thread SET updated_at = CURRENT_TIMESTAMP WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId],
  );
}

export async function updateAgentThreadTitle(threadId: string, userId: string, title: string): Promise<void> {
  await getAuthDatabase().query(
    `UPDATE commerce_agent_thread SET title = $3, updated_at = CURRENT_TIMESTAMP WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId, title],
  );
}

export async function markAgentThreadRunning(threadId: string, userId: string, turnId: string): Promise<void> {
  await getAuthDatabase().query(
    `
      UPDATE commerce_agent_thread
      SET status = 'running', active_turn_id = $3, turn_started_at = CURRENT_TIMESTAMP,
          duration_ms = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = $1 AND user_id = $2
    `,
    [threadId, userId, turnId],
  );
}

export async function updateAgentThreadStatus(
  threadId: string,
  userId: string,
  status: AgentThreadRecord["status"],
  durationMs: number | null,
): Promise<void> {
  await getAuthDatabase().query(
    `
      UPDATE commerce_agent_thread
      SET status = $3, active_turn_id = CASE WHEN $3 = 'running' THEN active_turn_id ELSE NULL END,
          duration_ms = $4, updated_at = CURRENT_TIMESTAMP
      WHERE thread_id = $1 AND user_id = $2
    `,
    [threadId, userId, status, durationMs],
  );
}

export async function deleteAgentThreadRecord(threadId: string, userId: string): Promise<void> {
  await getAuthDatabase().query(
    `DELETE FROM commerce_agent_thread WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId],
  );
}

export async function isAgentThreadOwner(threadId: string, userId: string): Promise<boolean> {
  const result = await getAuthDatabase().query(
    `SELECT 1 FROM commerce_agent_thread WHERE thread_id = $1 AND user_id = $2 LIMIT 1`,
    [threadId, userId],
  );
  return result.rowCount === 1;
}
