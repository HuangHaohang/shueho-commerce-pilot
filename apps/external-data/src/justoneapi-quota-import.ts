import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { canonicalJson } from "./canonical.js";
import type { JustOneApiCredential } from "./justoneapi-credentials.js";
import { PostgresJustOneApiTokenStore } from "./justoneapi-token-store.js";

const snapshotSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(["initial", "observed"]),
  basis: z.enum(["provider_remaining", "operator_conservative_cap"]).default("provider_remaining"),
  sourceReference: z.string().url().max(500).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  }),
  observedAt: z.string().datetime({ offset: true }),
  evidenceSha256: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(10),
  quotas: z.record(z.string().regex(/^\/api\/[A-Za-z0-9_./{}-]+$/).max(500), z.number().int().min(0).max(1_000_000)),
}).strict();
export type JustOneApiQuotaSnapshot = z.infer<typeof snapshotSchema>;

export function parseQuotaSnapshot(value: unknown): JustOneApiQuotaSnapshot {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success || Object.keys(parsed.data.quotas).length === 0 || Object.keys(parsed.data.quotas).length > 2048 ||
      Date.parse(parsed.data.observedAt) > Date.now() + 60_000) throw new Error("Invalid provider quota snapshot.");
  return parsed.data;
}

/** Operator-only import. The runtime role cannot insert the immutable receipt. */
export async function importJustOneApiQuotaSnapshot(database: Pool, credentials: JustOneApiCredential[], input: unknown) {
  const snapshot = parseQuotaSnapshot(input);
  if (snapshot.mode === "observed" && credentials.length !== 1) {
    throw new Error("Observed remaining quotas require exactly one explicitly selected token.");
  }
  await new PostgresJustOneApiTokenStore(database).register(credentials);
  const tokenIds = credentials.map((credential) => credential.id).sort();
  const entries = tokenIds.flatMap((tokenId) => Object.entries(snapshot.quotas).sort(([a],[b]) => a.localeCompare(b))
    .map(([apiPath,remainingCalls]) => ({ tokenId,apiPath,remainingCalls })));
  const sourceHash = createHash("sha256").update(canonicalJson({ snapshot,tokenIds })).digest("hex");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`justoneapi-import:${sourceHash}`]);
    const existing = await client.query<{ id: string }>("SELECT id FROM justoneapi_quota_import WHERE source_sha256=$1", [sourceHash]);
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { importId: existing.rows[0].id, sourceSha256: sourceHash, replayed: true, tokens: tokenIds.length, endpoints: Object.keys(snapshot.quotas).length };
    }
    // Lock endpoints in a stable order shared with reservation/settlement. Never reset active work.
    for (const apiPath of Object.keys(snapshot.quotas).sort()) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`justoneapi:${apiPath}`]);
    }
    const receipt = await client.query<{ id: string }>(`INSERT INTO justoneapi_quota_import(source_sha256,source_reference,observed_at,entries,metadata)
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb) RETURNING id`, [sourceHash,snapshot.sourceReference,snapshot.observedAt,JSON.stringify(entries),
      JSON.stringify({ mode:snapshot.mode,basis:snapshot.basis,evidenceSha256:snapshot.evidenceSha256 })]);
    const importId = receipt.rows[0]!.id;
    for (const entry of entries) {
      const current = await client.query<{ remaining_calls: string | null; reserved_calls: string; used_calls: string; inflight_calls: string; observed_at: Date | null; last_dispatched_at: Date | null }>(`
        SELECT remaining_calls,reserved_calls,used_calls,inflight_calls,observed_at,last_dispatched_at
        FROM justoneapi_token_endpoint_quota WHERE token_id=$1 AND api_path=$2 FOR UPDATE`, [entry.tokenId,entry.apiPath]);
      const row = current.rows[0];
      if (row && (Number(row.reserved_calls) > 0 || Number(row.inflight_calls) > 0 ||
          (snapshot.mode === "initial" && (row.remaining_calls !== null || Number(row.used_calls) > 0)) ||
          (row.observed_at && row.observed_at.getTime() >= Date.parse(snapshot.observedAt)) ||
          (row.last_dispatched_at && row.last_dispatched_at.getTime() > Date.parse(snapshot.observedAt)))) {
        throw new Error("Quota import is stale, already initialized, or conflicts with in-flight calls.");
      }
      await client.query(`INSERT INTO justoneapi_token_endpoint_quota(token_id,api_path,remaining_calls,state,source_import_id,observed_at)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token_id,api_path) DO UPDATE
        SET remaining_calls=EXCLUDED.remaining_calls,state=EXCLUDED.state,source_import_id=EXCLUDED.source_import_id,
          observed_at=EXCLUDED.observed_at,cooldown_until=NULL,updated_at=CURRENT_TIMESTAMP`,
      [entry.tokenId,entry.apiPath,entry.remainingCalls,entry.remainingCalls > 0 ? "active" : "exhausted",importId,snapshot.observedAt]);
    }
    await client.query("COMMIT");
    return { importId, sourceSha256: sourceHash, replayed: false, tokens: tokenIds.length, endpoints: Object.keys(snapshot.quotas).length };
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
