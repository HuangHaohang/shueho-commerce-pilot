# Public MCP on server244 with a Mac retrieval worker

Commerce Pilot is built on the open-source Codex Harness. This deployment is the separate external-client MCP service, not the complete browser Agent/Gateway deployment described in [Runtime Deployment](runtime.md). No Codex host-development capabilities, provider endpoint controls or raw warehouse API are exposed.

## Topology

```text
External MCP client --HTTPS + workspace Bearer token--> Cloudflare
  -> existing server244-production Tunnel
  -> server244 127.0.0.1:18087 (restricted Nginx ingress)
  -> public-mcp (stateless Streamable HTTP/SSE)
     -> private Next.js control BFF -> Enterprise PostgreSQL with forced RLS
     -> internal TLS -> independent external-data service
        -> JustOneAPI REST, with the service-owned provider credential
        -> separate PostgreSQL/pgvector and Elasticsearch
        -> model-client -> private Unix socket -> model-relay
           -> server244 127.0.0.1:18792
           -> SSH reverse forwarding -> Mac 127.0.0.1:8792
           -> real Qwen3 Embedding 4B / Reranker 4B on Metal
```

The public URL is `https://commerce-mcp.shueho.com/mcp`. `/health` provides a bounded readiness response; every other public path is rejected. Browser workbench and BFF `/api/internal/*` paths are not routed. Cloudflare authentication challenges or an interactive SSO redirect must not replace the MCP Bearer contract.

The existing Tunnel retains its other application routes. The Mac needs no Cloudflare Tunnel for inference. A legacy local connector belonging to a different account was retired with protected backups; local cloudflared operator authentication was changed to the account owning `shueho.com`.

## Runtime and storage

- Server release root: `/home/shueho/services/shueho-commerce-pilot/releases/`.
- Protected service configuration: `/home/shueho/services/shueho-commerce-pilot/config/`.
- Application-owned model socket: `/home/shueho/services/shueho-commerce-pilot/run/model/relay.sock`.
- Compose project: `commerce-pilot-mcp`; independent PostgreSQL, warehouse and Elasticsearch volumes.
- Mac worker root: `~/Library/Application Support/SHUEHO External Data/`.
- Mac user launch services: `com.shueho.commerce-qwen` and `com.shueho.commerce-qwen-tunnel`.

Application and proxy containers run as UID 1000 with read-only root filesystems, dropped capabilities, `no-new-privileges`, bounded memory/process limits and bounded logs. Only the small model-relay proxy shares the host network so it can reach SSH's loopback listener; it exposes only the dedicated Unix socket. The model-client sees that directory read-only. No host firewall changes or application ports on the LAN are required.

PostgreSQL certificates validate the internal database names against a dedicated private CA. Runtime roles are neither superusers nor `BYPASSRLS`. Only job containers receive migration URLs. Node trusts the private CA through a read-only certificate mount, without disabling certificate validation.

Nginx, PostgreSQL, pgvector and Elasticsearch images are digest-pinned. App and job artifacts are tagged with the full source commit and include `org.opencontainers.image.revision`. Release archives contain reviewed Git files only; environment files, runtime directories, database snapshots, model weights and client credentials are excluded.

`COMMERCE_PROXY_IMAGE` selects the release-tagged proxy image built from the pinned Nginx base. `Dockerfile.proxy` removes unused ACME, GeoIP, image-filter, NJS and XSLT modules and verifies that their unused `libuuid` dependency is absent. The service configurations use core HTTP/TLS proxying only. Use the same source commit for the app, jobs and proxy artifacts.

## Protected configuration contract

The [unified JustOneAPI client](justoneapi-tokens.md) additionally requires the protected token-file overlay, migrations `030`–`032` and a validated quota import. Token/endpoint budgets are independent of provider prices, Commerce policy and MCP client credentials. Startup and readback must confirm the intended pool and initialized allowances before admitting new provider calls.

The optional [JustOneAPI proxy overlay](justoneapi-proxy.md) adds protected subscription egress exclusively to the warehouse REST adapter. It does not alter public MCP, the Mac retrieval tunnel or other service routing; activate it only after importing and verifying the same immutable listener revision for warehouse and Mihomo.

`COMMERCE_CONFIG_DIR` contains these operator-provisioned files; the repository does not contain their values:

| File | Contents and audience |
|---|---|
| `database.env`, `warehouse-database.env` | Independent database owner bootstrap credentials |
| `control.env` | Least-privilege app database URL, Enterprise tenant pin, Better Auth secret/origin, internal control token and public MCP URL |
| `public-mcp.env` | Explicit Host allowlist, private BFF callback URLs/token, internal data-service TLS URL and its distinct MCP token |
| `warehouse.env` | Least-privilege warehouse URL, private Elasticsearch URL, JustOneAPI credential, model URL/token and pinned model identities |
| `web-jobs.env`, `warehouse-jobs.env` | Corresponding runtime values plus job-only migration URLs; never mount in application services |
| `ca.crt`, `database-tls/`, `warehouse-database-tls/`, `internal-tls/` | Private trust root and service certificates; retain the CA signing key on the operator machine |

The model URL is `http://model-client:8081`. Both Unix-socket proxies allow only `/health`, `/v1/embeddings` and `/v1/rerank`; inference endpoints retain the Mac service's Bearer validation. A two-MiB private proxy limit accommodates the model contract's maximum bounded UTF-8 batch plus its JSON envelope. The Mac `.env` supplies pinned weight paths/revisions, `LOCAL_MODEL_FAKE_MODE=false` and `LOCAL_MODEL_ALLOW_CPU=false`. Verify every model weight shard against the downloader's SHA-256 manifest before activation.

The Mac launch service runs Uvicorn under `caffeinate -i`, and uses an independent runtime environment. Both LaunchAgents use `RunAtLoad`, `KeepAlive` and throttled restart. The SSH identity has no shell/PTY/agent/X11 access and restricts TCP forwarding to the designated reverse listener. Host-key checking is strict and pinned; keepalive detects a lost link. These user LaunchAgents start after login, not before login. The Mac must remain powered, connected and logged in; explicit sleep or shutdown makes model-dependent operations unavailable.

## Provisioning and activation

Create a clean deployment from the reviewed source commit and protected configuration. Use a filtered, consistent source snapshot or explicit Enterprise provisioning; do not copy developer browser sessions, MCP tokens, unrelated tenants or Codex conversation state. Preserve original raw responses, immutable source receipts, revisions and request identities when migrating existing research evidence. Verify table counts and file hashes before enabling the data service. Rebuild Elasticsearch through fresh index-outbox entries, never by replaying paid provider calls.

After an explicit-ID restore, verify sequence positions as well as row counts. Warehouse migration `033` advances the index-outbox and service-audit sequences to their existing maximum IDs under writer locks without moving an already-ahead sequence backwards. An `index_outbox_pkey` collision can roll back enrichment despite a successful archived provider response; fix the sequence and reprocess that stored response rather than recollecting.

Start databases and model proxies first, restore/apply registered migrations once, then start application services:

```sh
docker compose --env-file /path/to/release.env -f deploy/production-mcp/compose.yaml \
  up -d --wait database warehouse-database elasticsearch model-relay model-client
docker compose --env-file /path/to/release.env -f deploy/production-mcp/compose.yaml \
  up -d --wait
```

The Mac inference service and forwarding channel must already be healthy. The independent data service warms both real models before listening. After a model outage, process restart must resume stored data processing only; uncertain paid provider dispatches remain blocked for reconciliation.

Run the repository validation matrix. Operator verification additionally includes `auth:migrate`, `enterprise:verify-isolation`, `enterprise:verify-external-data`, `external-data:migrate`, `external-data:verify:catalog`, `external-data:evaluate` and `external-data:verify`. The latter mounts the legacy source migration configuration into that one job only and reuses an existing confirmed archive; it does not purchase new data. Validate the current immutable catalog/profile/workflow receipts instead of silently reseeding master-data defaults.

Only publish the Cloudflare hostname after the local ingress is healthy, unauthenticated MCP returns `401`, private callback paths return `404`, and an authenticated SDK client can discover tools, retrieve evidence and obtain a free quote. Verify these again through the public HTTPS hostname and after a service/forwarding restart. Do not call `execute_marketplace_research` as a deployment smoke test.

Deploy the public MCP and warehouse together for the asynchronous foreground receipt contract: marketplace executions may return a pending receipt after 15 seconds, and `get_research_result` resolves the original plan UUID without changing running state. Their background work remains process-owned and is never restarted automatically. Before replacing a warehouse process with an outstanding provider call, retain its raw-call and ledger identities; afterward reconcile interrupted calls as unknown without refund/replay unless confirmed provider evidence exists. Snapshot status queries and complete structured error receipts are part of release readback.

Enterprise approval policy is preserved on migration. With `always_ask`, paid MCP execution returns `APPROVAL_REQUIRED`; a token does not grant automatic spending. Human approval requires the separately deployed Commerce Pilot Harness web flow, or an authorized operator can later configure a priced enterprise policy ceiling through normal governance. The MCP deployment must not weaken this policy for a smoke test.

An authorized operator can enable monthly-budget-only automation by selecting `approval_mode=policy`, setting a finite `monthly_spend_limit_micros`, and leaving `per_call_auto_approval_micros` null. Deploy the monthly-budget-aware control service before activating that configuration; older control versions treat a null per-call ceiling as requiring approval. Keep the existing workspace identity, endpoint allowlists and other quotas, retain the policy audit receipt, and verify that pending and uncertain calls still occupy budget. Policy rows are read live, so changing the approved configuration itself requires no further service restart.

## Rollback and maintenance

Retain the previous image, release directory, protected configuration and a restorable database snapshot. To roll back application code, select the previous release's `COMMERCE_MCP_IMAGE` and run `docker compose up -d --wait`; keep the same project name and volumes. Do not run `docker compose down -v`, replay paid calls, downgrade append-only schemas, rotate the shared existing Cloudflare Tunnel token or alter other application routes.

Monitor the model/SSH launch services, container health, raw-call `unknown` states, index outbox failures, TLS certificate expiry, token expiry, disk capacity and backup restoration. Renewal of a client token does not authorize changing its workspace or scopes. Renew private service certificates before their expiry and read back TLS verification after replacement.

The [2026-09-05 image reachability review](public-mcp-security-review-20260905.md) records the exact limited system-package exceptions and their 2026-09-19 expiry. Application dependency advisories and bundled package-manager findings must be fixed, not hidden by that review.

### Enrichment revision v4

Deploy the warehouse image containing `commerce-relevance-v4`; no database migration or MCP input-schema change is needed. The new append-only decision receipt lives in `ai_enrichment_result.model_metadata`. New collections use v4 automatically. For an already archived incident request, run `external-data:repair:research -- --research-request-id=<uuid> --force-enrichment` from the new image with the protected warehouse jobs environment. This invokes only local models and existing source rows, never the provider. Verify the latest completed job revision, `evidence_assessment`, `coverage.analysisReadiness`, current-job retrieval and raw hashes after repair. Preserve uncertain workflow steps and their reservations; never replay them. Older decisions remain for audit and are labeled as legacy when they lack the assessment receipt.

### Complete capability catalog (contract 6)

Apply warehouse migration `035` before starting the new warehouse/public-MCP images. Import an unfiltered official pricing workbook with `enterprise:import-justoneapi-pricing`, then import the current official sitemap/OpenAPI catalog with `external-data:import-catalog`; both immutable receipts must be retained. Catalog synchronization never changes token quotas or creates supplier credit. Interfaces missing pricing, permissions, protected-input support or local allowance remain visible with explicit blockers.

New Harness threads use tool contract 6; old App Server threads cannot acquire dynamic tools through resume. The public MCP additionally registers the four capability tools without changing its URL, Bearer audience or existing tool names. Refresh the external client's tool list and skill instructions after rollout. Verify discovery, schema fidelity, free plans, blocked zero-allowance plans, state readback, RLS and duplicate execution using isolated fixtures; do not purchase real supplier requests as smoke tests. Read back raw/attempt/quota counts to prove deployment did not collect data.

### Durable task rollout (contract 7)

Apply warehouse migration 036 before replacing services. Deploy warehouse, public MCP and the new `research-worker` Compose service with the same release image. The worker receives the existing public-MCP service environment and private CA only, never provider tokens or warehouse owner credentials; it persists all state through the authenticated warehouse RPC. `COMMERCE_RESEARCH_WORKER=1` enables consumption only in the worker container. Stop accepting new worker claims during shutdown; outstanding leases expire and replacements recover checkpointed work. Old provider requests remain untouched and are never re-enqueued for deployment testing.

Refresh Comate's direct tool list, bridge and Skill. New model-facing tools submit scope directly and return task IDs; free planning and separate execution tools are no longer registered. New browser Harness tasks require contract 7. Validate RLS, concurrent deduplication, lost leases, checkpoint recovery, uncertain-result non-replay and read-only transport retry against disposable fixtures. Production checks use only discovery, prior task/result reads and controlled invalid/pre-dispatch fixtures; no paid supplier smoke calls.

### Reliability rollout (contract 8)

Apply warehouse migration 037 with the migration role, drain active provider work, and deploy control, warehouse, public MCP and research-worker from the same tested release. Control now provides the authenticated read-only `revalidate` action and must be upgraded before new workers send provider traffic. Keep existing provider credentials, quotas, proxy overlays and monthly policy unchanged. Native tasks are negotiated only for MCP 2025-11-25, while ordinary clients retain immediate submit/get tools. Refresh installed client tool schemas/Skill and verify list, cancel, record reads, native tasks and zero-provider invalid-input jobs. Check both current task state and historical readback corrections, queue consumer age, raw hashes, attempts and quota counters. The existing full browser workbench deployment is separate; Gateway code uses contract 8 for newly created Harness threads.

Migration 037 does not rewrite failed task or supplier records: historical `DATA_EXECUTION_UNCERTAIN` tasks receive append-only readback corrections. Unknown billing remains pending reconciliation; never replay supplier requests to validate this deployment. Native result waits poll durable storage and stop on client disconnect. Queue readiness is false when pending tasks have no worker poll within 90 seconds. Operational metrics must not contain task inputs, credentials or raw customer data.

### Delivery completion rollout (contract 9)

Apply migration 038, then deploy warehouse, public MCP and research-worker from the same image after draining active calls. The worker consumes both research and settlement jobs; no new credentials or provider access are required. Verify settlement backlog/attention metrics, current MCP session identity binding, multi-request elicitation, task cancellation, original-result reads and snapshot pagination. The reverse proxy must forward MCP session/protocol headers and permit authenticated GET/DELETE as well as POST. GET is the MCP SSE stream, not a browser-facing raw-data route. On rolling replacement, clients may receive session-not-found and reinitialize while retaining task IDs. The shipped single public-MCP replica owns its transport sessions; horizontal replicas require session affinity.

The settlement outbox stores immutable intents and may continue after research reaches a terminal state. Automatic retries stop at 20 attempts and expose `attention_required`; reconciliation must inspect the existing reservation and exact payload, never dispatch the supplier again. Record indexes/snapshots are generated lazily from already-completed validated observations; first materialization performs a bounded indexed build, subsequent pagination reads the saved index. Refresh Comate's bridge and Skill and use `snapshot_id` for task-level offset pages. No raw archive, Token allowance, or historical provider call is reset during rollout.

### System hardening rollout (contract 10)

Run control migration 049 through `auth:migrate` and warehouse migration 039 through `external-data:migrate`. Drain and stop the old worker before starting the new internal claim schema, then deploy control, warehouse, public MCP and worker together. Existing token quotas, proxy manifests and pricing imports stay unchanged. Verify cancellation fences, settlement/release backlog and worker polling age; terminal-task release backfill must never change dispatched/unknown financial states. Keep historical pending approvals unless independently cancelled. V2 claim timestamps are server-worker generated, not browser input. Cleanup removes only expired operational claim receipts, never raw or business data.

Refresh the client bridge and Skill for elicitation forwarding and `next_cursor` result traversal. Ordinary bridge clients must not receive task-required tools they cannot execute. Validate actual bridge accept/decline and reinitialization in the integration test suite, and perform production record/session readback without supplier collection. The complete fault matrix is in `docs/architecture/research-failure-matrix.md`.

### Recovery patch rollout

Apply warehouse migration 040, drain old workers, then deploy control/warehouse/public MCP/worker from the same revision. Private task resume now requires the exact approval_reservation_id; deploy Gateway from this revision whenever enabling the workbench. Record projection v2 materializes on read while old supplied snapshot IDs retain their original content. Verify new and old snapshots, ordinary/native task contracts, worker readiness, raw hashes and quota/billing counters without paid collection. Refresh client Skill language: source-record totals are not guaranteed distinct cross-page entities.
