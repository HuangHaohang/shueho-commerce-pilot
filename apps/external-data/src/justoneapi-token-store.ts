import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { JustOneApiError, type TokenFeedback } from "./justoneapi-errors.js";
import type { JustOneApiCredential } from "./justoneapi-credentials.js";
import type { ProviderCallResult } from "./types.js";

export type JustOneApiCallIdentity = {
  rawCallId: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  apiPath: string;
  requestSha256: string;
};
export type TokenReservation = { id: string; tokenId: string; ordinal: number };
export type TokenPoolStatus = { tokens: number; activeTokens: number; endpoints: number; availablePairs: number; reservedCalls: string; usedCalls: string; inflightCalls: string };
export interface JustOneApiTokenStore {
  status(tokenIds: string[]): Promise<TokenPoolStatus>;
  register(credentials: readonly JustOneApiCredential[]): Promise<void>;
  begin(identity: JustOneApiCallIdentity, executionId: string): Promise<void>;
  reserve(identity: JustOneApiCallIdentity, executionId: string, tokenIds: string[]): Promise<TokenReservation | null>;
  dispatch(identity: JustOneApiCallIdentity, executionId: string, reservation: TokenReservation, proxyNodeId: string | null): Promise<boolean>;
  cancel(identity: JustOneApiCallIdentity, reservation: TokenReservation): Promise<void>;
  complete(identity: JustOneApiCallIdentity, reservation: TokenReservation, result: ProviderCallResult, feedback: TokenFeedback, uncertain?: boolean): Promise<void>;
  unknown(identity: JustOneApiCallIdentity, reservation: TokenReservation): Promise<void>;
  finish(identity: JustOneApiCallIdentity, executionId: string, state: "completed" | "failed" | "unknown"): Promise<void>;
}

export class PostgresJustOneApiTokenStore implements JustOneApiTokenStore {
  constructor(private readonly database: Pool) {}

  async status(tokenIds: string[]): Promise<TokenPoolStatus> {
    const result = await this.database.query(`SELECT
      count(DISTINCT token.token_id)::int AS tokens,
      count(DISTINCT token.token_id) FILTER (WHERE token.state='active')::int AS active_tokens,
      count(DISTINCT quota.api_path)::int AS endpoints,
      count(*) FILTER (WHERE token.state='active' AND quota.state='active' AND quota.remaining_calls>0
        AND (quota.cooldown_until IS NULL OR quota.cooldown_until<=CURRENT_TIMESTAMP))::int AS available_pairs,
      COALESCE(sum(quota.reserved_calls),0)::text AS reserved_calls,
      COALESCE(sum(quota.used_calls),0)::text AS used_calls,
      COALESCE(sum(quota.inflight_calls),0)::text AS inflight_calls
      FROM justoneapi_token token LEFT JOIN justoneapi_token_endpoint_quota quota ON quota.token_id=token.token_id
      WHERE token.token_id=ANY($1::text[])`, [tokenIds]);
    const row = result.rows[0];
    return { tokens:row.tokens,activeTokens:row.active_tokens,endpoints:row.endpoints,availablePairs:row.available_pairs,
      reservedCalls:row.reserved_calls,usedCalls:row.used_calls,inflightCalls:row.inflight_calls };
  }

  async register(credentials: readonly JustOneApiCredential[]): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      for (const credential of [...credentials].sort((a,b) => a.id.localeCompare(b.id))) {
        await client.query(`INSERT INTO justoneapi_token(token_id,fingerprint) VALUES ($1,$2)
          ON CONFLICT (token_id) DO NOTHING`, [credential.id, credential.fingerprint]);
        const row = await client.query(`SELECT 1 FROM justoneapi_token WHERE token_id=$1 AND fingerprint=$2`, [credential.id, credential.fingerprint]);
        if (!row.rowCount) throw new Error("Credential identity mismatch.");
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }

  async begin(identity: JustOneApiCallIdentity, executionId: string): Promise<void> {
    await this.transaction(identity, async (client) => {
      const raw = await client.query(`SELECT 1 FROM external_api_call_raw
        WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND api_path=$4
          AND request_sha256=$5 AND user_id=$6 AND state='dispatched' FOR UPDATE`,
      [identity.rawCallId,identity.tenantId,identity.workspaceId,identity.apiPath,identity.requestSha256,identity.userId]);
      if (!raw.rowCount) throw new JustOneApiError("Provider call requires an owned immutable warehouse request.", "INVALID_PARAMETER", false);
      const inserted = await client.query(`INSERT INTO justoneapi_dispatch(raw_call_id,tenant_id,workspace_id,execution_id)
        VALUES ($1,$2,$3,$4) ON CONFLICT (raw_call_id) DO NOTHING RETURNING raw_call_id`,
      [identity.rawCallId,identity.tenantId,identity.workspaceId,executionId]);
      if (!inserted.rowCount) throw new JustOneApiError("Provider request already claimed; replay is prohibited.", "CALL_ALREADY_CLAIMED", true);
    });
  }

  async reserve(identity: JustOneApiCallIdentity, executionId: string, tokenIds: string[]): Promise<TokenReservation | null> {
    return this.transaction(identity, async (client) => {
      await this.lockExecution(client, identity, executionId);
      // Serializes only this endpoint's selection/debit across processes and tenants.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`justoneapi:${identity.apiPath}`]);
      const selected = await client.query<{ token_id: string }>(`
        SELECT quota.token_id FROM justoneapi_token_endpoint_quota quota
        JOIN justoneapi_token token ON token.token_id=quota.token_id
        WHERE quota.api_path=$1 AND quota.token_id=ANY($2::text[])
          AND quota.state='active' AND quota.remaining_calls>0 AND token.state='active'
          AND (quota.cooldown_until IS NULL OR quota.cooldown_until<=CURRENT_TIMESTAMP)
          AND NOT EXISTS (SELECT 1 FROM justoneapi_token_attempt previous
            WHERE previous.raw_call_id=$3 AND previous.token_id=quota.token_id)
        ORDER BY quota.last_selected_seq,array_position($2::text[],quota.token_id) LIMIT 1 FOR UPDATE OF quota,token`,
      [identity.apiPath,tokenIds,identity.rawCallId]);
      const tokenId = selected.rows[0]?.token_id;
      if (!tokenId) return null;
      await client.query(`UPDATE justoneapi_token_endpoint_quota SET remaining_calls=remaining_calls-1,
        reserved_calls=reserved_calls+1,last_selected_seq=nextval('justoneapi_token_selection_seq'),updated_at=CURRENT_TIMESTAMP
        WHERE token_id=$1 AND api_path=$2`, [tokenId,identity.apiPath]);
      const result = await client.query<{ id: string; ordinal: number }>(`
        INSERT INTO justoneapi_token_attempt(id,raw_call_id,tenant_id,workspace_id,token_id,api_path,ordinal,state)
        SELECT $1,$2,$3,$4,$5,$6,COALESCE(MAX(ordinal),0)+1,'reserved'
        FROM justoneapi_token_attempt WHERE raw_call_id=$2 RETURNING id,ordinal`,
      [randomUUID(),identity.rawCallId,identity.tenantId,identity.workspaceId,tokenId,identity.apiPath]);
      return { id: result.rows[0]!.id, ordinal: result.rows[0]!.ordinal, tokenId };
    });
  }

  async dispatch(identity: JustOneApiCallIdentity, executionId: string, reservation: TokenReservation, proxyNodeId: string | null): Promise<boolean> {
    return this.transaction(identity, async (client) => {
      await this.lockExecution(client, identity, executionId);
      await this.lockEndpoint(client, identity.apiPath);
      const allowed = await client.query(`SELECT 1 FROM justoneapi_token token
        JOIN justoneapi_token_endpoint_quota quota ON quota.token_id=token.token_id
        WHERE token.token_id=$1 AND token.state='active' AND quota.api_path=$2 AND quota.state='active'
        FOR UPDATE OF token,quota`, [reservation.tokenId,identity.apiPath]);
      if (!allowed.rowCount) return false;
      const changed = await client.query(`UPDATE justoneapi_token_attempt SET state='dispatched',
        dispatched_at=CURRENT_TIMESTAMP,proxy_node_id=$4
        WHERE id=$1 AND raw_call_id=$2 AND token_id=$3 AND state='reserved' RETURNING id`,
      [reservation.id,identity.rawCallId,reservation.tokenId,proxyNodeId]);
      if (!changed.rowCount) return false;
      await client.query(`UPDATE justoneapi_token_endpoint_quota SET reserved_calls=reserved_calls-1,
        used_calls=used_calls+1,inflight_calls=inflight_calls+1,last_dispatched_at=CURRENT_TIMESTAMP,
        updated_at=CURRENT_TIMESTAMP WHERE token_id=$1 AND api_path=$2`,
      [reservation.tokenId,identity.apiPath]);
      return true;
    });
  }

  async cancel(identity: JustOneApiCallIdentity, reservation: TokenReservation): Promise<void> {
    await this.transaction(identity, async (client) => {
      await this.lockEndpoint(client, identity.apiPath);
      const changed = await client.query(`UPDATE justoneapi_token_attempt SET state='cancelled',completed_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND raw_call_id=$2 AND token_id=$3 AND state='reserved' RETURNING id`,
      [reservation.id,identity.rawCallId,reservation.tokenId]);
      if (!changed.rowCount) return;
      await client.query(`UPDATE justoneapi_token_endpoint_quota SET reserved_calls=reserved_calls-1,
        remaining_calls=CASE WHEN state='active' THEN remaining_calls+1 ELSE remaining_calls END,
        updated_at=CURRENT_TIMESTAMP WHERE token_id=$1 AND api_path=$2`,
      [reservation.tokenId,identity.apiPath]);
    });
  }

  async complete(identity: JustOneApiCallIdentity, reservation: TokenReservation, result: ProviderCallResult, feedback: TokenFeedback, uncertain = false): Promise<void> {
    await this.transaction(identity, async (client) => {
      await this.lockEndpoint(client, identity.apiPath);
      const changed = await client.query(`UPDATE justoneapi_token_attempt SET state=$4,completed_at=CURRENT_TIMESTAMP,
        http_status=$5,provider_code=$6,response_payload=$7::jsonb,response_body_text=$8,
        response_raw_bytes=$9,response_sha256=$10,response_content_type=$11,response_bytes=$12
        WHERE id=$1 AND raw_call_id=$2 AND token_id=$3 AND state='dispatched' RETURNING id`,
      [reservation.id,identity.rawCallId,reservation.tokenId,uncertain ? "unknown" : result.state,result.httpStatus,result.providerCode,
        result.payload === null ? null : JSON.stringify(result.payload),result.rawBody,Buffer.from(result.rawBytes),
        result.responseSha256,result.contentType,result.responseBytes]);
      if (!changed.rowCount) throw new Error("Provider attempt is not awaiting a response.");
      await client.query(`UPDATE justoneapi_token_endpoint_quota SET inflight_calls=inflight_calls-1,
        updated_at=CURRENT_TIMESTAMP WHERE token_id=$1 AND api_path=$2`, [reservation.tokenId,identity.apiPath]);
      if (feedback === "invalid") {
        await client.query("UPDATE justoneapi_token SET state='invalid',updated_at=CURRENT_TIMESTAMP WHERE token_id=$1", [reservation.tokenId]);
      } else if (feedback === "endpoint_exhausted" || feedback === "endpoint_denied") {
        await client.query(`UPDATE justoneapi_token_endpoint_quota SET remaining_calls=0,state=$3,updated_at=CURRENT_TIMESTAMP
          WHERE token_id=$1 AND api_path=$2`, [reservation.tokenId,identity.apiPath,feedback === "endpoint_denied" ? "permission_denied" : "exhausted"]);
      } else if (feedback === "rate_limited") {
        await client.query(`UPDATE justoneapi_token_endpoint_quota SET cooldown_until=CURRENT_TIMESTAMP+INTERVAL '60 seconds',
          updated_at=CURRENT_TIMESTAMP WHERE token_id=$1 AND api_path=$2`, [reservation.tokenId,identity.apiPath]);
      }
    });
  }

  async unknown(identity: JustOneApiCallIdentity, reservation: TokenReservation): Promise<void> {
    await this.transaction(identity, async (client) => {
      await this.lockEndpoint(client, identity.apiPath);
      const changed = await client.query(`UPDATE justoneapi_token_attempt SET state='unknown',completed_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND raw_call_id=$2 AND token_id=$3 AND state='dispatched' RETURNING id`, [reservation.id,identity.rawCallId,reservation.tokenId]);
      if (changed.rowCount) await client.query(`UPDATE justoneapi_token_endpoint_quota SET inflight_calls=inflight_calls-1,
        updated_at=CURRENT_TIMESTAMP WHERE token_id=$1 AND api_path=$2`, [reservation.tokenId,identity.apiPath]);
    });
  }

  async finish(identity: JustOneApiCallIdentity, executionId: string, state: "completed" | "failed" | "unknown"): Promise<void> {
    await this.transaction(identity, async (client) => {
      const result = await client.query(`UPDATE justoneapi_dispatch SET state=$3,completed_at=CURRENT_TIMESTAMP
        WHERE raw_call_id=$1 AND execution_id=$2 AND state='active' RETURNING raw_call_id`, [identity.rawCallId,executionId,state]);
      if (!result.rowCount) throw new Error("Provider execution ownership is no longer active.");
    });
  }

  private async lockExecution(client: PoolClient, identity: JustOneApiCallIdentity, executionId: string): Promise<void> {
    const result = await client.query(`SELECT 1 FROM justoneapi_dispatch WHERE raw_call_id=$1 AND execution_id=$2 AND state='active' FOR UPDATE`, [identity.rawCallId,executionId]);
    if (!result.rowCount) throw new Error("Provider request is not owned by this execution.");
  }

  private async lockEndpoint(client: PoolClient, apiPath: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`justoneapi:${apiPath}`]);
  }

  private async transaction<T>(identity: Pick<JustOneApiCallIdentity,"tenantId"|"workspaceId">, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('external_data.tenant_id',$1,true),set_config('external_data.workspace_id',$2,true)", [identity.tenantId,identity.workspaceId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
    finally { client.release(); }
  }
}
