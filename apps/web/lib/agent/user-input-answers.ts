import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

export type AgentUserInputAnswer = {
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  answerMessage: string;
  createdAt: string;
};

export async function recordAgentUserInputAnswer(
  scope: EnterpriseScope,
  input: {
    requestId: string;
    threadId: string;
    turnId: string;
    itemId: string;
    answerMessage: string;
  },
): Promise<void> {
  validateAnswerRecord(input);
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `
        INSERT INTO commerce_agent_user_input_answer
          (tenant_id, workspace_id, user_id, thread_id, turn_id, request_id, item_id, answer_message)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE EXISTS (
          SELECT 1 FROM commerce_agent_thread
          WHERE thread_id = $4 AND tenant_id = $1 AND workspace_id = $2 AND created_by_user_id = $3
        )
        ON CONFLICT (thread_id, request_id) DO UPDATE
        SET answer_message = EXCLUDED.answer_message
        WHERE commerce_agent_user_input_answer.tenant_id = EXCLUDED.tenant_id
          AND commerce_agent_user_input_answer.workspace_id = EXCLUDED.workspace_id
          AND commerce_agent_user_input_answer.user_id = EXCLUDED.user_id
          AND commerce_agent_user_input_answer.turn_id = EXCLUDED.turn_id
          AND commerce_agent_user_input_answer.item_id = EXCLUDED.item_id
      `,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        input.threadId,
        input.turnId,
        input.requestId,
        input.itemId,
        input.answerMessage,
      ],
    );
    if (result.rowCount !== 1) throw new Error("Agent user-input answer ownership is invalid.");
  });
}

export async function listAgentUserInputAnswers(
  scope: EnterpriseScope,
  threadId: string,
): Promise<AgentUserInputAnswer[]> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{
      request_id: string;
      thread_id: string;
      turn_id: string;
      item_id: string;
      answer_message: string;
      created_at: Date;
    }>(
      `
        SELECT request_id, thread_id, turn_id, item_id, answer_message, created_at
        FROM commerce_agent_user_input_answer
        WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3 AND thread_id = $4
        ORDER BY created_at, request_id
      `,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
    return result.rows.map((row) => ({
      requestId: row.request_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      itemId: row.item_id,
      answerMessage: row.answer_message,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

function validateAnswerRecord(input: {
  requestId: string;
  threadId: string;
  turnId: string;
  itemId: string;
  answerMessage: string;
}): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId)) throw new Error("Invalid answer request id.");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId)) throw new Error("Invalid answer thread id.");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.turnId)) throw new Error("Invalid answer turn id.");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.itemId)) throw new Error("Invalid answer item id.");
  if (!input.answerMessage.trim() || input.answerMessage.length > 8_000 || input.answerMessage.includes("\0")) {
    throw new Error("Invalid answer message.");
  }
}
