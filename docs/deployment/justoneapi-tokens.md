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

Quotas are keyed by token and exact canonical API path, including version. Parameters or concrete ids do not create new quota buckets. PostgreSQL serializes selection by endpoint across processes and randomly selects among eligible tokens. A known zero or unknown allowance is never selected.

1. Existing Commerce governance performs live authorization, approval and budget admission, then the warehouse persists the Token-free request identity.
2. The unified client claims the raw call once. Duplicate processes, repeated requests and restarts cannot claim it again.
3. Token selection atomically reserves one unit: available decreases and reserved increases. A verified proxy tunnel is prepared before any provider HTTP request exists.
4. Before sending, a compare-and-set moves each attempt from reserved to dispatched: reserved decreases, used and in-flight increase. Only documented, confirmed non-billable `301`/`302` rejections, `100` invalid-token and `303`/`601`/`602` quota failover, or a proxy failure before any provider bytes may lead to another bounded attempt under the same immutable governed call. A success, resource/configuration failure, unrecognized quota-like message or uncertain result cannot be replayed.
5. The complete response is persisted in the scoped attempt archive before returning to the existing raw/normalization pipeline; in-flight decreases. A second settlement does not change counters.
6. Proxy/setup failure before dispatch returns the reservation. A timeout, disconnect, 5xx response or uncertain persistence keeps the consumed unit, becomes unknown and is never replayed automatically. The small commit-before-network crash window is conservatively held for operator reconciliation, not silently refunded.

Provider code 100 invalidates the credential globally and permits another eligible key within the original call. Codes 303/601/602 stop only the current token/interface combination; code 600 records an interface permission failure. Code 302 applies cooldown to both that combination and the shared endpoint admission bucket. Other interfaces remain eligible. `301`/`302` permit bounded retries, while confirmed `100`/`303`/`601`/`602` responses permit another eligible key within the same admitted call; the prior full rejection is archived before reserving/debiting another attempt. Every network attempt consumes one conservative token unit, including a rejected attempt, and no unit is refunded without authoritative quota reconciliation. Permission refusal blocks selection without overwriting the remaining-call counter with zero. Generic errors and transport failures are not fuzzy-matched as quota exhaustion. Provider monetary limits and account-shared balances remain distinct from these local call budgets.

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

## Bounded retries and shared admission

Migration `034` adds SQL-backed provider/endpoint admission buckets, expiring operational leases and scoped execution progress. Buckets contain no credentials or tenant content; they are internal service-wide operating state, like the existing shared token quota ledger. Attempts and execution ownership retain forced tenant/workspace RLS and immutable terminal records. Live executions may update only progress; ownership, deadline and final receipts remain fenced. The existing sorted migration runner automatically registers this append-only migration.

These defaults are application operating limits, not claimed official provider entitlements:

| Variable | Default | Meaning |
|---|---:|---|
| `JUSTONEAPI_MAX_ATTEMPTS` | 3 | Total attempts, including safe proxy setup attempts |
| `JUSTONEAPI_TOTAL_TIMEOUT_MS` | 180000 | Total admission/backoff/provider window |
| `JUSTONEAPI_MAX_CONCURRENT` | 4 | Shared provider concurrency across processes and tokens |
| `JUSTONEAPI_ENDPOINT_MAX_CONCURRENT` | 1 | Shared concurrency for each exact endpoint version |
| `JUSTONEAPI_MIN_INTERVAL_MS` | 1000 | Minimum provider start spacing |
| `JUSTONEAPI_ENDPOINT_MIN_INTERVAL_MS` | 2000 | Minimum endpoint start spacing |
| `JUSTONEAPI_THROTTLE_BASE_MS` | 15000 | First endpoint cooldown; doubles to 120 seconds on repeated throttles |

A valid `Retry-After` overrides any shorter backoff/cooldown. The client stops when the wait cannot fit a fresh minimum 60-second attempt window; it never shortens that provider wait. No SQL transaction or proxy tunnel is held while waiting, and no token quota is reserved until admission succeeds. Shared leases expire after the absolute call deadline plus a margin so a crashed process cannot permanently consume admission capacity. Expiry releases only operational capacity, never a provider quota debit or billing reservation, and does not replay the crashed call.

`coverage.execution` reports phase, attempt count, next attempt time and polling action. Workflow receipts include per-step execution progress and `coverage.polling`. Clients poll the same id only for `poll_same_request`, stop for `stop`, and retain the original id for operator reconciliation on `reconcile`. A dispatched execution past its durable deadline is surfaced for reconciliation without mutating its raw receipt or silently restarting work. This change does not introduce an automatic cross-process workflow replay worker.

Public MCP repeated execution of a consumed, owned plan reads the original result instead of starting another collection. Normal research input schemas and plan scope remain unchanged. Deploy warehouse and public MCP after applying `034`, draining active provider calls first. Do not use real provider execution as a release smoke test: use the disposable PostgreSQL retry/concurrency suite, public readback and a consumed plan whose original provider dispatch is already terminal.

Policy references: [official retry guidance](https://justoneapi.com/zh/blog/api-failure-retry-guide) and [official response-code table](https://justoneapi.apifox.cn/api%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97-%E4%B8%AD%E6%96%87-7571933m0). The project retains its stricter no-replay rule for uncertain transport/5xx outcomes.

## Confirmed quota failover

The official [business-code reference](https://docs.justoneapi.com/en/usage#business-code-reference)
identifies 303 (daily quota), 601 (shared account balance) and 602 (token budget) as
non-billable refusals. Classification requires a business-failed response, a numeric
matching top-level response-body code, and a successful HTTP envelope or HTTP 429.
Arbitrary text containing “quota”, message text inside successful business data,
unknown codes, 403 permission errors and 5xx/network uncertainty never authorize
quota zeroing or failover. No model performs this classification.

The existing asynchronous SQL transaction archives the complete failed response
and sets only the selected token/canonical-interface allowance to zero before the
next selection. This is deliberately awaited rather than a detached fire-and-forget
job: a delayed/lost update could select the exhausted key again across workers.
The current call also excludes exhausted keys from its remaining candidates. Other
interfaces keep their counters, and used-call history is retained. Account balance
and token budget refusals are conservative evidence that this particular pair is
unavailable, not proof that every other free-trial interface has zero remaining
calls; sibling interfaces are not overwritten.

Failover uses the original raw-call, governance and billing identity. It adds no
transient-error backoff for quota refusal but preserves shared admission spacing,
any explicit Retry-After, the existing maximum of three total attempts and the
absolute deadline. All exhausted/no eligible keys returns the original definite
refusal. Failed archive/zeroing stops before dispatching another key. No automatic
allowance refill or uncertain-result replay is introduced.

Deploy the warehouse from the tested release after draining active provider work;
no schema migration or quota import is required. Verify the real PostgreSQL suite
with fabricated supplier responses, both endpoint counters, archived attempts,
concurrent selection, permanent errors and timeout non-replay. Production acceptance
uses health and stored counter/receipt reads, never deliberate paid exhaustion.

## Invalid-key failover and cleanup labels

A matching numeric business code 100 in a business-failed HTTP 401, 2xx or 429
response is a documented non-billable token rejection. Archive the full response
and mark the token globally `invalid` in the same transaction before selecting
another key in the original call. Do not zero its interface counters: this is a
credential failure, not authoritative evidence that every allowance is exhausted.
A bare 401, mismatched body, unknown code, or 5xx/network uncertainty cannot
activate this retry. The existing three-total-attempt limit and deadline still apply.

Selection now uses PostgreSQL `random()` over eligible rows under the existing
endpoint lock. It is independent of file order, import time and selection history;
an individual key can be selected again on a later call, while keys rejected in
the current call are excluded. Eligibility and dispatch fencing still reject
invalid/disabled tokens and exhausted/denied/cooling-down interface pairs.

`external-data:tokens:status` includes an operator-only `tokens` list with opaque
id, four-character suffix, state, cleanup-candidate flag, reason label and marking
time. Globally invalid/disabled keys are cleanup candidates; interface exhaustion
alone is not. The response archive retains the exact provider code and message.
Markers survive restarts and imports, and no automatic deletion or reactivation
is performed. This status command never prints full keys and is not a public API.
