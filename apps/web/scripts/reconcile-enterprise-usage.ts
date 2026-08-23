import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { Pool } from "pg";

loadDotenv({ path: resolve(process.cwd(), ".env.migration"), override: false, quiet: true });
const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is required for usage reconciliation.");

const options = readOptions(process.argv.slice(2));
const tenantId = required(options, "tenant-id");
const providerId = required(options, "provider-id");
const responseId = required(options, "response-id");
const reasonCode = required(options, "reason-code");
const actorUserId = options["actor-user-id"] || null;
if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(tenantId)) throw new Error("tenant-id must be a UUID.");
if (!/^[A-Za-z0-9_-]{1,128}$/.test(providerId)) throw new Error("provider-id is invalid.");
if (responseId.length > 255) throw new Error("response-id is too long.");
if (!/^[A-Z0-9_.-]{3,64}$/.test(reasonCode)) throw new Error("reason-code must be a stable uppercase code.");

const totalTokens = token(options, "total-tokens");
const inputTokens = token(options, "input-tokens");
const cachedInputTokens = token(options, "cached-input-tokens");
const cacheWriteInputTokens = token(options, "cache-write-input-tokens");
const outputTokens = token(options, "output-tokens");
const reasoningOutputTokens = token(options, "reasoning-output-tokens");
if (cachedInputTokens + cacheWriteInputTokens > inputTokens) throw new Error("input token subsets exceed input-tokens.");
if (reasoningOutputTokens > outputTokens) throw new Error("reasoning-output-tokens exceeds output-tokens.");
if (totalTokens < inputTokens + outputTokens) throw new Error("total-tokens is smaller than input plus output.");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `usage-reconcile:${tenantId}:${providerId}:${responseId}`,
  ]);
  if (actorUserId) {
    const actor = await client.query(
      `SELECT 1 FROM commerce_tenant_membership
       WHERE tenant_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
      [tenantId, actorUserId],
    );
    if (actor.rowCount !== 1) throw new Error("actor-user-id is not an active tenant member.");
  }
  const existing = await client.query<{ id: string; usage_status: string }>(
    `SELECT id::text, usage_status FROM commerce_agent_usage_event
     WHERE tenant_id = $1 AND provider_id = $2 AND response_id = $3
     FOR UPDATE`,
    [tenantId, providerId, responseId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("The requested usage event does not exist.");
  if (row.usage_status !== "missing") throw new Error("Only a missing usage event can be reconciled.");
  await client.query(
    `
      UPDATE commerce_agent_usage_event
      SET total_tokens = $4, input_tokens = $5, cached_input_tokens = $6,
          cache_write_input_tokens = $7, output_tokens = $8, reasoning_output_tokens = $9,
          usage_status = 'reported', reconciled_at = CURRENT_TIMESTAMP,
          reconciled_by_user_id = $10, reconciliation_reason = $11
      WHERE tenant_id = $1 AND provider_id = $2 AND response_id = $3 AND usage_status = 'missing'
    `,
    [
      tenantId, providerId, responseId, totalTokens, inputTokens, cachedInputTokens,
      cacheWriteInputTokens, outputTokens, reasoningOutputTokens, actorUserId, reasonCode,
    ],
  );
  await client.query(
    `
      INSERT INTO commerce_enterprise_audit_event
        (tenant_id, actor_user_id, action, target_type, target_id, outcome, metadata)
      VALUES ($1, $2, 'usage.reconcile', 'provider_response', $3, 'succeeded',
              jsonb_build_object('providerId', $4::text, 'reasonCode', $5::text,
                                 'totalTokens', $6::bigint))
    `,
    [tenantId, actorUserId, responseId, providerId, reasonCode, totalTokens],
  );
  const readback = await client.query<{ usage_status: string; total_tokens: string; reconciled_at: Date }>(
    `SELECT usage_status, total_tokens::text, reconciled_at
     FROM commerce_agent_usage_event
     WHERE tenant_id = $1 AND provider_id = $2 AND response_id = $3`,
    [tenantId, providerId, responseId],
  );
  await client.query("COMMIT");
  const verified = readback.rows[0];
  console.log(JSON.stringify({
    ok: verified?.usage_status === "reported" && verified.total_tokens === String(totalTokens),
    usageStatus: verified?.usage_status,
    totalTokens: verified?.total_tokens,
    reconciledAt: verified?.reconciled_at.toISOString(),
  }));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

function readOptions(args: string[]): Record<string, string> {
  return Object.fromEntries(args.map((arg) => {
    const match = arg.match(/^--([a-z-]+)=(.*)$/);
    if (!match) throw new Error(`Invalid option: ${arg}`);
    return [match[1] as string, match[2] as string];
  }));
}

function required(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function token(options: Record<string, string>, name: string): number {
  const value = Number.parseInt(required(options, name), 10);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative safe integer.`);
  return value;
}
