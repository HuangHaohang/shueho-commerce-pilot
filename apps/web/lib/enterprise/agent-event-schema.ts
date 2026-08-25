import { z } from "zod";

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

export const skillPublishedEventSchema = scopeSchema.extend({
  kind: z.literal("skill.published"),
  eventId: z.string().min(1).max(512),
  model: z.string().min(1).max(128).nullable().optional(),
  skillName: z.string().min(3).max(64).regex(/^commerce-[a-z0-9]+(?:-[a-z0-9]+)*$/),
  operation: z.enum(["created", "updated", "unchanged"]),
  contentHash: z.string().length(64).regex(/^[a-f0-9]+$/),
});

export const internalAgentEventSchema = z.discriminatedUnion("kind", [
  usageEventSchema,
  turnCompletedEventSchema,
  skillPublishedEventSchema,
]);

export type UsageEvent = z.infer<typeof usageEventSchema>;
export type TurnCompletedEvent = z.infer<typeof turnCompletedEventSchema>;
export type SkillPublishedEvent = z.infer<typeof skillPublishedEventSchema>;
