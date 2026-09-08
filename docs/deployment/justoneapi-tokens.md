# JustOneAPI unified client and token quotas

Commerce Pilot remains based on the open-source Codex Harness. Every business JustOneAPI HTTP request is owned by the independent SHUEHO External Data service's `JustOneApiClient`; callers provide the prepared endpoint/request and its tenant/workspace/user-bound immutable raw-call identity. The client composes the credential loader, PostgreSQL quota store and private HTTP/proxy transport. No Harness or browser request can choose a token, proxy, quota, raw-call id or network policy.

## Credential configuration

`JUSTONEAPI_TOKENS_FILE` points to a protected JSON file:

```json
{
  "schemaVersion": 1,
  "tokens": [
    { "token": "SERVICE_OWNED_TOKEN_1" },
    { "token": "SERVICE_OWNED_TOKEN_2" }
  ]
}
```

Provision this file outside Git with mode 0600, readable only by the warehouse service identity. Values are validated, deduplicated and assigned stable SHA-256-derived ids. Optional `id` fields must equal those derived ids; renaming a credential cannot reset counters. SQL stores only ids/fingerprints and status. The token file replaces `JUSTONEAPI_API_TOKEN`; when a file is configured but unreadable/invalid, the service fails closed without using the old single token. Without a file, the legacy token still goes through this same client and needs a quota import.

## Counter and request lifecycle

Quotas are keyed by token and exact canonical API path, including version. Parameters or concrete ids do not create new quota buckets. PostgreSQL serializes selection by endpoint across processes; least recently selected eligible tokens implement persistent round-robin order. A known zero or unknown allowance is never selected.

1. Existing Commerce governance performs live authorization, approval and budget admission, then the warehouse persists the Token-free request identity.
2. The unified client claims the raw call once. Duplicate processes, repeated requests and restarts cannot claim it again.
3. Token selection atomically reserves one unit: available decreases and reserved increases. A verified proxy tunnel is prepared before any provider HTTP request exists.
4. Before sending, a compare-and-set moves the attempt from reserved to dispatched: reserved decreases, used and in-flight increase. Each independently governed call sends at most one provider HTTP request.
5. The complete response is persisted in the scoped attempt archive before returning to the existing raw/normalization pipeline; in-flight decreases. A second settlement does not change counters.
6. Proxy/setup failure before dispatch returns the reservation. A timeout, disconnect, 5xx response or uncertain persistence keeps the consumed unit, becomes unknown and is never replayed automatically. The small commit-before-network crash window is conservatively held for operator reconciliation, not silently refunded.

Provider code 100 invalidates the credential globally. Codes 303/601/602 stop only the current token/interface combination; code 600 records an interface permission failure. Code 302 applies a bounded cooldown to that combination. Other interfaces remain eligible. Feedback changes selection for the **next independently governed call**, never starts a hidden second HTTP request after a dispatched call. Generic errors and transport failures are not fuzzy-matched as quota exhaustion. Provider monetary limits and account-shared balances remain distinct from these local call budgets.

Token rotation and proxy-node rotation are independent. Only the JustOneAPI client opts into the proxy pool. Document/catalog imports without provider credentials, database/model/MCP traffic and other services keep their existing network paths.

The transport enforces an absolute deadline across response headers and body consumption, in addition to the request abort signal. A prepared TLS tunnel that closes during the durable quota-commit gap must settle the promise even if ClientRequest has not attached listeners. Timeout or disconnect remains unknown with its quota debit retained; only bounded error categories are recorded, never credential-bearing network errors. Recovery uses the original research and workflow identities, not a replacement paid request.

## Immutable quota import

Apply external-data migrations `030`–`032` through the existing sorted, SHA-verified migration runner before starting the new service. They add provider credential metadata, per-interface counters, immutable import receipts, scoped dispatch ownership and scoped raw attempts; source/raw business tables and their lineage are retained.

Quota snapshot format:

```json
{
  "schemaVersion": 1,
  "mode": "initial",
  "basis": "operator_conservative_cap",
  "sourceReference": "https://dashboard.justoneapi.com/zh/dashboard/free-trial",
  "observedAt": "2026-09-07T00:00:00Z",
  "evidenceSha256": ["SHA256_OF_CAPTURED_SOURCE"],
  "quotas": { "/api/example/v1": 5 }
}
```

The example path/count is illustrative, not an executable provider default. Import actual provider data or an explicitly approved operator budget; never invent interface allowances or copy another account's remainder as an official initial entitlement. `operator_conservative_cap` records an approved local ceiling, while `provider_remaining` denotes an actual remaining-quota observation. The source evidence hashes, basis, mode, timestamp and token/interface values are preserved in the immutable receipt.

```sh
npm run external-data:migrate
npm run external-data:tokens:import-quotas -- \
  --tokens-file=/absolute/protected/justoneapi/tokens.json \
  --snapshot-file=/absolute/protected/justoneapi/quotas.json
npm run external-data:tokens:status
```

The importer uses the one-shot migration credential. Runtime SQL cannot insert import receipts. Identical imports replay without refilling consumption. Initial imports refuse previously initialized/used rows. `mode=observed` can reconcile a newer provider readback without resetting lifetime used counts; it rejects in-flight/reserved work, older observations and calls dispatched after the observation. Pause admission and drain before a reconciliation import. Never reset quota at restart or assume a daily free-trial reset.

An observed snapshot must target exactly one token; use `--token-id=token-OPAQUE_FINGERPRINT` with the protected pool file. A remaining-quota observation must never be copied across differently used tokens. Only the explicitly approved initial budget can be provisioned to a fresh batch together.

The 2026-09-07 provisioning uses the operator-approved conservative limits from the displayed free-trial table for six declared-unused tokens; it must not be represented as a verified official initial-entitlement table. Unknown/new endpoints remain blocked until another validated import.

`justoneapi_token_attempt` and `justoneapi_dispatch` use forced tenant/workspace RLS and compound raw-call foreign keys. User ownership is rechecked before claim. Terminal attempts/import receipts cannot be rewritten or deleted. Full responses are SQL-only; health and the status command never expose credentials or response content.

## Production activation

Add `compose.justoneapi-tokens.yaml` after the base and proxy overlays. Set `COMMERCE_JUSTONEAPI_TOKENS_FILE` to the protected host file, and supply the same file read-only to the bounded quota import job. Only warehouse receives it; public MCP, BFF, Gateway and browser do not.

```sh
docker compose --env-file /path/to/release.env \
  -f deploy/production-mcp/compose.yaml \
  -f deploy/production-mcp/compose.justoneapi-proxy.yaml \
  -f deploy/production-mcp/compose.justoneapi-tokens.yaml up -d
```

Read back `/health`: `justOneApiTokens` shows configured/active counts, ready interface combinations and reserved/used/in-flight totals; `providerCallsReady` also requires healthy proxy egress when enabled. Read-only stored evidence can remain available when new provider calls are blocked. Inspect SQL/status under operator access for per-token details.

Validation uses a dedicated disposable PostgreSQL database with `JUSTONEAPI_TEST_DATABASE_URL` for the non-superuser, non-BYPASSRLS runtime role and `JUSTONEAPI_TEST_MIGRATION_DATABASE_URL` for fixture setup. Tests cover concurrent debit, restart persistence, duplicate claim, raw retention, cancellation, uncertain outcomes, scoped failure handling, RLS and immutable imports. Ordinary unit-test runs do not silently connect to a developer or production database for these cases. Only GitHub Actions with `NODE_ENV=test` may reuse the disposable database already declared by the existing workflow; no additional workflow permissions are needed.
