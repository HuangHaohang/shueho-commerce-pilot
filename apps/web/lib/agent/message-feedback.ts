import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";
import type { AgentMessageFeedbackRating } from "./message-feedback-contract";

export type { AgentMessageFeedbackRating } from "./message-feedback-contract";

export type AgentMessageFeedback = {
  messageItemId: string;
  rating: AgentMessageFeedbackRating;
};

export async function listAgentMessageFeedback(
  scope: EnterpriseScope,
  threadId: string,
): Promise<AgentMessageFeedback[]> {
  validateId(threadId, "thread", 8);
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{
      message_item_id: string;
      rating: AgentMessageFeedbackRating;
    }>(
      `SELECT message_item_id, rating
       FROM commerce_agent_message_feedback
       WHERE tenant_id = $1 AND workspace_id = $2
         AND user_id = $3 AND thread_id = $4
       ORDER BY updated_at, message_item_id`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
    return result.rows.map((row) => ({
      messageItemId: row.message_item_id,
      rating: row.rating,
    }));
  });
}

export async function setAgentMessageFeedback(
  scope: EnterpriseScope,
  input: {
    threadId: string;
    turnId: string;
    messageItemId: string;
    rating: AgentMessageFeedbackRating | null;
    messageContentHash: string;
  },
): Promise<AgentMessageFeedbackRating | null> {
  validateId(input.threadId, "thread", 8);
  validateId(input.turnId, "turn", 8);
  validateId(input.messageItemId, "message item", 1);
  if (!/^[a-f0-9]{64}$/.test(input.messageContentHash)) throw new Error("Invalid feedback content hash.");

  return withEnterpriseDatabaseContext(scope, async (client) => {
    const modelResult = await client.query<{ model: string | null }>(
      `SELECT COALESCE(requested_model, model) AS model
       FROM commerce_agent_usage_event
       WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
         AND root_thread_id = $4 AND turn_id = $5
         AND thread_id = root_thread_id AND source = 'codex_harness'
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.turnId],
    );
    const model = modelResult.rows[0]?.model ?? null;
    if (input.rating === null) {
      const deleted = await client.query(
        `DELETE FROM commerce_agent_message_feedback
         WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3
           AND thread_id = $4 AND turn_id = $5 AND message_item_id = $6`,
        [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.turnId, input.messageItemId],
      );
      if (deleted.rowCount === 0) return null;
    } else {
      const saved = await client.query(
        `INSERT INTO commerce_agent_message_feedback (
           tenant_id, workspace_id, user_id, thread_id, turn_id,
           message_item_id, rating, message_content_hash, model
         )
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9
         WHERE EXISTS (
           SELECT 1 FROM commerce_agent_thread
           WHERE thread_id = $4 AND tenant_id = $1
             AND workspace_id = $2 AND created_by_user_id = $3
         )
         ON CONFLICT (thread_id, user_id, message_item_id) DO UPDATE
         SET rating = EXCLUDED.rating,
             message_content_hash = EXCLUDED.message_content_hash,
             model = EXCLUDED.model,
             updated_at = CURRENT_TIMESTAMP
         WHERE commerce_agent_message_feedback.tenant_id = EXCLUDED.tenant_id
           AND commerce_agent_message_feedback.workspace_id = EXCLUDED.workspace_id
           AND commerce_agent_message_feedback.turn_id = EXCLUDED.turn_id`,
        [
          scope.tenantId,
          scope.workspaceId,
          scope.userId,
          input.threadId,
          input.turnId,
          input.messageItemId,
          input.rating,
          input.messageContentHash,
          model,
        ],
      );
      if (saved.rowCount !== 1) throw new Error("Agent message feedback ownership is invalid.");
    }

    await client.query(
      `INSERT INTO commerce_agent_message_feedback_event (
         tenant_id, workspace_id, user_id, thread_id, turn_id,
         message_item_id, action, rating, message_content_hash, model
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        input.threadId,
        input.turnId,
        input.messageItemId,
        input.rating === null ? "clear" : "set",
        input.rating,
        input.messageContentHash,
        model,
      ],
    );
    return input.rating;
  });
}

function validateId(value: string, label: string, minimum: number): void {
  if (!new RegExp(`^[A-Za-z0-9_-]{${minimum},128}$`).test(value)) {
    throw new Error(`Invalid feedback ${label} id.`);
  }
}
