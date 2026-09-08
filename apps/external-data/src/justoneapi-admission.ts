import type { Pool } from "pg";
import type { JustOneApiResilienceOptions } from "./justoneapi-retry-policy.js";

export interface JustOneApiAdmission {
  acquire(apiPath: string, leaseId: string, expiresAt: number): Promise<{ acquired: boolean; waitMs: number; reason: string | null }>;
  feedback(apiPath: string, throttled: boolean, retryAfterMs: number | null): Promise<number>;
  release(leaseId: string): Promise<void>;
}

/** Short SQL transactions coordinate all warehouse replicas; no connection is held while waiting. */
export class PostgresJustOneApiAdmission implements JustOneApiAdmission {
  constructor(private readonly database: Pool, private readonly options: JustOneApiResilienceOptions) {}

  async acquire(apiPath: string, leaseId: string, expiresAt: number) {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('justoneapi:admission',0))");
      await client.query("DELETE FROM justoneapi_admission_lease WHERE expires_at<=clock_timestamp()");
      await client.query(`INSERT INTO justoneapi_admission_bucket(bucket_key) VALUES ('provider'),($1) ON CONFLICT DO NOTHING`, [apiPath]);
      const state = await client.query<{ wait_ms: number; cooling: boolean }>(`
        SELECT GREATEST(0,CEIL(EXTRACT(EPOCH FROM (MAX(GREATEST(next_start_at,cooldown_until,clock_timestamp()))-clock_timestamp()))*1000))::float8 AS wait_ms,
          bool_or(cooldown_until>clock_timestamp()) AS cooling
        FROM justoneapi_admission_bucket WHERE bucket_key IN ('provider',$1)`, [apiPath]);
      const capacity = await client.query<{ total: number; endpoint: number }>(`
        SELECT count(*)::int AS total,count(*) FILTER (WHERE api_path=$1)::int AS endpoint FROM justoneapi_admission_lease`, [apiPath]);
      let waitMs = state.rows[0]!.wait_ms;
      let reason = state.rows[0]!.cooling ? "rate_limited" : waitMs > 0 ? "paced" : null;
      if (capacity.rows[0]!.total >= this.options.maxConcurrent || capacity.rows[0]!.endpoint >= this.options.endpointMaxConcurrent) {
        waitMs = Math.max(waitMs, 1_000); reason ??= "capacity";
      }
      if (waitMs > 0) {
        await client.query("COMMIT");
        return { acquired: false, waitMs, reason };
      }
      await client.query("INSERT INTO justoneapi_admission_lease(id,api_path,expires_at) VALUES ($1,$2,$3)", [leaseId,apiPath,new Date(expiresAt)]);
      await client.query(`UPDATE justoneapi_admission_bucket SET next_start_at=clock_timestamp()+
        (CASE WHEN bucket_key='provider' THEN $2::double precision ELSE $3::double precision END)*INTERVAL '1 millisecond'
        WHERE bucket_key IN ('provider',$1)`, [apiPath,this.options.minIntervalMs,this.options.endpointMinIntervalMs]);
      await client.query("COMMIT");
      return { acquired: true, waitMs: 0, reason: null };
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async feedback(apiPath: string, throttled: boolean, retryAfterMs: number | null): Promise<number> {
    if (!throttled) {
      await this.database.query(`UPDATE justoneapi_admission_bucket SET consecutive_throttles=0 WHERE bucket_key=$1`, [apiPath]);
      return 0;
    }
    const result = await this.database.query<{ wait_ms: number }>(`
      UPDATE justoneapi_admission_bucket SET
        consecutive_throttles=LEAST(consecutive_throttles+1,20),
        cooldown_until=GREATEST(cooldown_until,clock_timestamp()+
          GREATEST(COALESCE($2::double precision,0),LEAST($4::double precision,$3::double precision*power(2,LEAST(consecutive_throttles,10))))*INTERVAL '1 millisecond')
      WHERE bucket_key=$1
      RETURNING GREATEST(0,CEIL(EXTRACT(EPOCH FROM (cooldown_until-clock_timestamp()))*1000))::float8 AS wait_ms`,
    [apiPath,retryAfterMs,this.options.throttleBaseMs,this.options.maxCooldownMs]);
    if (!result.rows[0]) throw new Error("Provider admission bucket is missing.");
    return result.rows[0].wait_ms;
  }

  async release(leaseId: string): Promise<void> {
    await this.database.query("DELETE FROM justoneapi_admission_lease WHERE id=$1", [leaseId]);
  }
}
