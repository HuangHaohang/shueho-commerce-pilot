import { config } from "./config.js";
import { database } from "./database.js";
import { loadJustOneApiCredentials } from "./justoneapi-credentials.js";
import { PostgresJustOneApiTokenStore } from "./justoneapi-token-store.js";

try {
  const credentials = await loadJustOneApiCredentials(config.justOneApi);
  const ids = credentials.map((credential) => credential.id);
  const rows = await database.query(`SELECT token.token_id,token.state AS token_state,token.updated_at AS token_updated_at,quota.api_path,
    quota.remaining_calls,quota.reserved_calls,quota.used_calls,quota.inflight_calls,quota.state,
    quota.cooldown_until,quota.source_import_id
    FROM justoneapi_token token LEFT JOIN justoneapi_token_endpoint_quota quota ON quota.token_id=token.token_id
    WHERE token.token_id=ANY($1::text[]) ORDER BY array_position($1::text[],token.token_id),quota.api_path`, [ids]);
  const tokens = credentials.map(credential => {
    const row = rows.rows.find(row => row.token_id === credential.id);
    const state = row?.token_state ?? 'unregistered';
    return { tokenId: credential.id, suffix: credential.token.slice(-4), state,
      cleanupCandidate: state === 'invalid' || state === 'disabled',
      reason: state === 'invalid' ? 'PROVIDER_TOKEN_INVALID_OR_UNACTIVATED' : state === 'disabled' ? 'OPERATOR_DISABLED' : null,
      markedAt: state === 'invalid' || state === 'disabled' ? row.token_updated_at : null };
  });
  console.log(JSON.stringify({ summary: await new PostgresJustOneApiTokenStore(database).status(ids), tokens, quotas: rows.rows }, null, 2));
} catch {
  console.error("Unable to read JustOneAPI token quota status."); process.exitCode = 1;
} finally { await database.end(); }
