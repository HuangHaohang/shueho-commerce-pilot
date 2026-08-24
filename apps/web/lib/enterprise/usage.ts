import { z } from "zod";

import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";

const idSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/);
const uuidSchema = z.string().uuid();
const tokenSchema = z.number().int().nonnegative().safe();

const scopeSchema = z.object({
  tenantId: uuidSchema,
  workspaceId: uuidSchema,
  userId: z.string().min(1).max(255),
  rootThreadId: idSchema,
  threadId: idSchema,
  parentThreadId: idSchema.nullable().optional(),
  turnId: idSchema,
  occurredAt: z.string().datetime(),
});

export const usageEventSchema = scopeSchema.extend({
  kind: z.literal("usage.response.completed"),
  source: z
    .enum(["codex_harness", "commerce_web_mcp", "commerce_web_tool", "commerce_image_tool", "title_generation"])
    .default("codex_harness"),
  eventId: z.string().min(1).max(512),
  responseId: z.string().min(1).max(255),
  providerId: z.string().min(1).max(128),
  requestedModel: z.string().min(1).max(128).nullable().optional(),
  usageStatus: z.enum(["reported", "missing"]).default("reported"),
  model: z.string().min(1).max(128).nullable().optional(),
  usage: z.object({
    totalTokens: tokenSchema,
    inputTokens: tokenSchema,
    cachedInputTokens: tokenSchema,
    cacheWriteInputTokens: tokenSchema,
    outputTokens: tokenSchema,
    reasoningOutputTokens: tokenSchema,
  }),
});

export const turnCompletedEventSchema = scopeSchema.extend({
  kind: z.literal("turn.completed"),
  eventId: z.string().min(1).max(512),
  status: z.enum(["completed", "interrupted", "failed"]),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  requestId: z.string().uuid().optional(),
});

export const internalAgentEventSchema = z.discriminatedUnion("kind", [
  usageEventSchema,
  turnCompletedEventSchema,
]);

export type UsageEvent = z.infer<typeof usageEventSchema>;
export type TurnCompletedEvent = z.infer<typeof turnCompletedEventSchema>;

export class EnterpriseAgentEventBindingError extends Error {
  constructor() {
    super("Usage event root thread binding was not found.");
    this.name = "EnterpriseAgentEventBindingError";
  }
}

export async function recordUsageEvent(event: UsageEvent): Promise<{ inserted: boolean }> {
  const scope = eventScope(event);
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await assertRootThreadBinding(client, event);
    const usage = event.usage;
    const result = await client.query(
      `
        INSERT INTO commerce_agent_usage_event (
          tenant_id, workspace_id, user_id, root_thread_id, thread_id, parent_thread_id,
          turn_id, response_id, provider_id, model, total_tokens, input_tokens,
          cached_input_tokens, cache_write_input_tokens, output_tokens,
          reasoning_output_tokens, occurred_at, source, requested_model, usage_status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
        )
        ON CONFLICT (tenant_id, provider_id, response_id) DO NOTHING
      `,
      [
        event.tenantId,
        event.workspaceId,
        event.userId,
        event.rootThreadId,
        event.threadId,
        event.parentThreadId ?? null,
        event.turnId,
        event.responseId,
        event.providerId,
        event.model ?? null,
        usage.totalTokens,
        usage.inputTokens,
        usage.cachedInputTokens,
        usage.cacheWriteInputTokens,
        usage.outputTokens,
        usage.reasoningOutputTokens,
        event.occurredAt,
        event.source,
        event.requestedModel ?? null,
        event.usageStatus,
      ],
    );
    return { inserted: result.rowCount === 1 };
  });
}

export async function recordTurnCompletedEvent(event: TurnCompletedEvent): Promise<void> {
  const scope = eventScope(event);
  await withEnterpriseDatabaseContext(scope, async (client) => {
    await assertRootThreadBinding(client, event);
    if (event.threadId !== event.rootThreadId) return;
    const inserted = await client.query(
      `
        INSERT INTO commerce_agent_turn_completion (
          tenant_id, workspace_id, root_thread_id, turn_id, event_id,
          status, duration_ms, occurred_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
      `,
      [
        event.tenantId,
        event.workspaceId,
        event.rootThreadId,
        event.turnId,
        event.eventId,
        event.status,
        event.durationMs ?? null,
        event.occurredAt,
      ],
    );
    if (inserted.rowCount !== 1) return;
    await client.query(
      `
        UPDATE commerce_agent_thread
        SET status = $5, active_turn_id = NULL, duration_ms = COALESCE($6, duration_ms),
            last_terminal_turn_id = $7, last_terminal_at = $8,
            updated_at = CURRENT_TIMESTAMP
        WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4
          AND (active_turn_id = $7 OR active_turn_id IS NULL)
          AND (last_terminal_at IS NULL OR last_terminal_at < $8)
      `,
      [
        event.rootThreadId,
        event.tenantId,
        event.workspaceId,
        event.userId,
        event.status,
        event.durationMs ?? null,
        event.turnId,
        event.occurredAt,
      ],
    );
    await client.query(
      `
        UPDATE commerce_agent_turn_lease
        SET state = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = $1 AND workspace_id = $2 AND thread_id = $3
          AND (turn_id = $4 OR ($5::uuid IS NOT NULL AND request_id = $5::uuid))
          AND state IN ('reserved', 'active')
      `,
      [event.tenantId, event.workspaceId, event.rootThreadId, event.turnId, event.requestId ?? null],
    );
  });
}

function eventScope(event: UsageEvent | TurnCompletedEvent): EnterpriseScope {
  return { tenantId: event.tenantId, workspaceId: event.workspaceId, userId: event.userId };
}

async function assertRootThreadBinding(
  client: import("pg").PoolClient,
  event: UsageEvent | TurnCompletedEvent,
): Promise<void> {
  const result = await client.query(
    `
      SELECT 1 FROM commerce_agent_thread
      WHERE thread_id = $1 AND tenant_id = $2 AND workspace_id = $3 AND created_by_user_id = $4
      LIMIT 1
    `,
    [event.rootThreadId, event.tenantId, event.workspaceId, event.userId],
  );
  if (result.rowCount !== 1) throw new EnterpriseAgentEventBindingError();
}
