# Runtime Deployment

This is a web application. Deployment machines do not need a preinstalled global `codex` executable.

## Runtime Ownership

The application declares `@openai/codex` in `package.json`. During deployment, install dependencies from `package-lock.json`; the Codex App Server runtime is then resolved from the application dependency tree.

Resolution order:

1. `CODEX_BIN`, only when explicitly set.
2. `./node_modules/.bin/codex`.
3. `./node_modules/@openai/codex/bin/codex.js`.
4. `./node_modules/@openai/codex-<platform>/vendor/<target>/bin/codex`.
5. global `codex`, only outside `NODE_ENV=production` for local development fallback.

Production fails fast if no application-owned Codex runtime is runnable.

## Enterprise Deployment Unit

Production isolation is tenant-dedicated. One Gateway/App Server deployment serves exactly one `commerce_tenant.id` and owns its own:

- container or equivalent OS isolation boundary;
- non-root process identity;
- `CODEX_HOME` and runtime workspace volume;
- provider credentials and generated provider configuration;
- generated artifacts, managed Hook audit, pending-steer state, and Agent event outbox;
- internal service identity and health lifecycle.

Set `COMMERCE_RUNTIME_TENANT_ID` to the provisioned tenant UUID. Gateway rejects traffic for any other tenant. Do not place two companies in one production App Server or mount one tenant's `CODEX_HOME` into another tenant's worker.

The current Next.js BFF has one static `COMMERCE_GATEWAY_URL`; a general tenant-aware runtime manager is not implemented yet. Until it is, deploy an isolated customer-specific application/Gateway route (or an equivalent trusted infrastructure route) per tenant. Browser input must never select a runtime URL.

## Container Deployment

Build:

```bash
docker build -t shueho-commerce-pilot .
```

Run:

```bash
docker run --rm \
  --network commerce-internal \
  -e NODE_ENV="production" \
  -e COMMERCE_RUNTIME_TENANT_ID="00000000-0000-4000-8000-000000000001" \
  -e COMMERCE_PROVIDER_API_KEY="..." \
  -e COMMERCE_PROVIDER_BASE_URL="https://cpa.luusmosh.com/v1" \
  -e COMMERCE_IMAGE_MODEL="gpt-image-2" \
  -e COMMERCE_GATEWAY_INTERNAL_TOKEN="a-random-secret-of-at-least-32-characters" \
  -e COMMERCE_AGENT_EVENT_SINK_URL="http://commerce-web:3000/api/internal/agent-events" \
  -e COMMERCE_AGENT_AUTHORIZATION_URL="http://commerce-web:3000/api/internal/agent-authorization" \
  -e COMMERCE_AGENT_ADMISSION_URL="http://commerce-web:3000/api/internal/agent-admission" \
  -e COMMERCE_AGENT_AUTHORIZATION_POLL_MS="10000" \
  -e COMMERCE_AGENT_MAX_THREADS_PER_SESSION="4" \
  -e COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT="75" \
  -e COMMERCE_AGENT_COMPACTION_TIMEOUT_MS="180000" \
  -e CODEX_HOME="/var/lib/shueho-commerce-pilot/codex" \
  -v commerce-pilot-codex-tenant-0001:/var/lib/shueho-commerce-pilot/codex \
  shueho-commerce-pilot
```

Port `8787` is an internal service port. Connect the correct tenant's Next.js BFF route over the private container network and give it the same `COMMERCE_GATEWAY_INTERNAL_TOKEN`. The BFF callback at `COMMERCE_AGENT_EVENT_SINK_URL` is also internal infrastructure. Do not publish either endpoint to the internet. For local-only diagnostics, bind Gateway explicitly to loopback with `-p 127.0.0.1:8787:8787`.

The mounted `CODEX_HOME` directory should contain app-owned Codex configuration, including custom provider definitions when needed:

```text
/var/lib/shueho-commerce-pilot/codex/config.toml
```

The outbox and bounded dead-letter file are persisted at:

```text
/var/lib/shueho-commerce-pilot/codex/commerce-runtime/agent-event-outbox.json
/var/lib/shueho-commerce-pilot/codex/commerce-runtime/agent-event-dead-letter.json
```

They contain tenant-scoped identifiers and usage counts and must be encrypted, backed up consistently with runtime state, and unavailable to other tenants. Any dead letter is an operational incident requiring ownership/replay investigation; the file retains only the most recent 100 entries.

## Required Service Configuration

Gateway production requirements:

- `NODE_ENV=production`;
- `COMMERCE_RUNTIME_TENANT_ID`, a valid UUID matching the one provisioned tenant;
- `CODEX_HOME`, an absolute path on that tenant's persistent volume;
- `COMMERCE_GATEWAY_INTERNAL_TOKEN`, a random secret of at least 32 characters;
- `COMMERCE_AGENT_EVENT_SINK_URL`, a private HTTP(S) BFF callback;
- `COMMERCE_AGENT_AUTHORIZATION_URL`, the private active-authorization callback;
- `COMMERCE_AGENT_ADMISSION_URL`, the private compaction-admission/release callback;
- `COMMERCE_AGENT_AUTHORIZATION_POLL_MS`, `5000-60000`, default `10000`;
- `COMMERCE_AGENT_MAX_THREADS_PER_SESSION`, `1-16`, default `4`, aligned at or below the tenant contract;
- `COMMERCE_PROVIDER_API_KEY` and the intended provider identity/configuration;
- bounded turn, compaction, Web Search, and provider timeouts appropriate to infrastructure limits.

BFF production requirements:

- `DATABASE_URL` using TLS and a least-privilege PostgreSQL role that is neither superuser nor `BYPASSRLS`; production refuses a dangerous role;
- `BETTER_AUTH_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters, and exact `AUTH_TRUSTED_ORIGINS`;
- `COMMERCE_GATEWAY_URL` pointing to the correct tenant-dedicated internal Gateway;
- the matching `COMMERCE_GATEWAY_INTERNAL_TOKEN`;
- `COMMERCE_ALLOW_PUBLIC_REGISTRATION=false`; production ignores a true override and requires an email-matching invitation;
- an approved secure channel for delivering one-time invitation fragments; add enterprise SSO/SCIM and account recovery before broad external rollout.

Migration/provisioning jobs additionally load `MIGRATION_DATABASE_URL` from a job secret (or local `.env.migration`), distinct from `DATABASE_URL`. Do not mount that file or variable into the long-running web process. Production `auth:migrate` fails if it is absent. `enterprise:verify-isolation` intentionally requires both URLs so it can create temporary fixtures as owner and prove that the runtime role cannot escape forced RLS.

Secrets must come from a secret manager or protected runtime injection. Do not put them in images, repositories, shell history, browser variables, logs, health payloads, or generated Codex TOML.

## Background Workers

Run one `npm run jobs:thread-deletion` worker beside each tenant-dedicated Gateway. The worker uses the least-privilege application `DATABASE_URL`, the internal `COMMERCE_GATEWAY_URL` and token, and the same optional `COMMERCE_RUNTIME_TENANT_ID` pin. It must not receive `MIGRATION_DATABASE_URL`.

The worker claims durable deletion jobs with `FOR UPDATE SKIP LOCKED`, invokes Gateway `thread/delete`, waits for application artifact cleanup, and only then removes the Commerce Pilot thread index and marks the item deleted. Monitor queued/running age, partial/failed jobs, worker liveness, and `$CODEX_HOME/thread_artifacts` storage. A web process is not a replacement for this worker; deleting in a detached Next.js callback is not durable.

Uploaded photos and documents are stored below `$CODEX_HOME/thread_artifacts/<threadId>/<artifactId>`. The Gateway image/document parsers are application dependencies and must be installed from the production lockfile. App Server and Gateway need the same dedicated tenant artifact volume; the web process does not need direct filesystem access. Enforce the 5 MB total-per-Turn limit at the edge/BFF and Gateway, and keep the multipart overhead allowance restricted to the authenticated attachment route. Backups and retention must include the artifact volume, while permanent thread deletion removes its complete thread directory.

## Provider Configuration

Do not assume a developer's `~/.codex/config.toml` exists on the server. For deployment, render or mount provider config into:

```text
$CODEX_HOME/config.toml
```

The runtime creates an isolated working directory at:

```text
$CODEX_HOME/workspaces/default
```

Do not mount the source repository, `/`, `/home`, `/root`, a Docker socket, SSH agent sockets, cloud metadata sockets, another tenant's data, or arbitrary host directories into the App Server container. Run as a non-root user and mount only dedicated application runtime volumes.

Provider API keys should be injected as environment variables or secret manager files. Do not commit real provider keys. The gateway resolves `CODEX_HOME` to an absolute application-owned path before starting App Server and generates the provider definition without embedding the key.

## Defense In Depth

The generated Codex config disables shell, unified exec, raw local-path view-image, apps/connectors, unmanaged Hooks, plugins, automatic dependency installation, and inherited shell environment. Threads are fixed to read-only sandbox mode and cannot override `cwd` or permissions through HTTP.

Provider-backed Web Search uses the application-owned `commerce_web.search` stdio MCP tool, and multi-agent collaboration is enabled. The generated MCP config exposes only that read-only tool, forwards provider configuration by environment-variable name, and runs the bundled MCP server artifact from the application image. The MCP process executes `/v1/responses` Web Search calls; it does not expose generic process or host-network tools to users. Gateway also keeps native `web_search = "live"` enabled, and the managed Hook allowlist includes both MCP and native search names. Subagents inherit the same restricted runtime. Raw local-path image reading remains disabled until App Server is isolated with a tenant-only artifact mount; use an application-owned artifact id boundary instead.

There is no direct Gateway or public BFF image-generation endpoint. Image creation must pass through the already-admitted, immediately reauthorized `commerce_image.generate` host tool. Authenticated artifact reads remain ownership-checked and non-cacheable at the BFF boundary.

Gateway startup is successful only after the current App Server process reloads MCP config and reports `commerce_web.search` in `mcpServerStatus/list`. Production health checks must require HTTP 200 and `managedMcp.state=ready`; a configured-only flag is not acceptance. Set `COMMERCE_WEB_SEARCH_TIMEOUT_MS` and `COMMERCE_WEB_SEARCH_MAX_ATTEMPTS` so the generated MCP tool timeout exceeds the provider retry budget.

Gateway monitors App Server `thread/tokenUsage/updated` events and invokes native `thread/compact/start` after cumulative `tokenUsage.total.totalTokens` crosses the configured share of `modelContextWindow`. Manual compaction is admitted by the authenticated BFF; automatic and Harness-initiated compaction use `COMMERCE_AGENT_ADMISSION_URL`. Failure denies or interrupts compaction instead of performing unmetered work. Keep the percentage below the model's hard context limit and the timeout below infrastructure request limits. Compaction uses App Server's own `contextCompaction` item and managed `PreCompact`/`PostCompact` Hooks; deployment code must not replace it with an application-authored summary.

Gateway also persists Harness, managed MCP, host Web Search, host image, and terminal-turn usage/lifecycle events before delivering them to the authenticated BFF sink. Missing provider usage is recorded explicitly. Delivery uses exponential backoff, batched acknowledgement, permanent-failure quarantine, and signal-time final drain. Health monitoring must alert when `runtime.enterpriseRuntime.pendingEvents` grows, `deadLetterEvents` is non-zero, `eventSinkError` remains non-null, authorization is unconfigured/unhealthy, the dedicated-tenant pin is absent, or the sink/auth check is stale. Do not delete or recreate a tenant runtime volume while events are pending.

Production always requires the authenticated event sink and keeps the delivery pipeline fail-closed. In local development, when no sink and internal token are configured, event delivery is disabled rather than queued indefinitely: new runtime events are not appended to the outbox, historical pending events remain visible for diagnosis, and their age does not make the otherwise healthy local Gateway return `503`.

Active authorization is required in production. At each poll, the BFF rechecks organization/tenant/workspace/member/contract/thread/permission state. A denial or callback failure interrupts all active root/subagent work, clears queued root input, and broadcasts revocation. Host Web Search and image calls reauthorize again immediately before provider access.

Hooks run in managed-only mode from `$CODEX_HOME/managed-hooks/commerce-runtime-hook.mjs`. Mount the managed Hook directory read-only in hardened production deployments. Hook audit output belongs in the dedicated `$CODEX_HOME/hook-audit` volume and must not contain prompt bodies, tool inputs/results, provider secrets, or commerce PII.

The production image installs `/etc/codex/requirements.toml`, pins Hooks on, sets `allow_managed_hooks_only = true`, and repeats the shell/sandbox restrictions as administrator requirements. Non-container production deployments must install [runtime/commerce-requirements.toml](../../runtime/commerce-requirements.toml) at the same system path before starting Gateway.

These controls prevent the model from receiving host-development capabilities. Container or equivalent OS isolation remains mandatory because an application-layer allowlist cannot mitigate an App Server or runtime implementation vulnerability by itself.

## Database And Rollout Checks

Run `npm run auth:migrate` exactly once per rollout job with its job-only `MIGRATION_DATABASE_URL`; the migration runner serializes migrations `001` through `011` with a PostgreSQL advisory lock. Then run `npm run enterprise:verify-isolation` with distinct migration/runtime URLs. Provision the organization, its one-to-one tenant, and default workspace with `npm run enterprise:bootstrap` only after the intended owner identity exists; production also requires `--identity-verified=true`. Treat bootstrap as a mutating operator action: re-running it changes contract limits and seeded roles.

Before accepting customer traffic, verify:

1. the commercial organization is linked one-to-one to the intended tenant;
2. the tenant UUID in PostgreSQL matches `COMMERCE_RUNTIME_TENANT_ID` and its runtime/contract are in the intended lifecycle state;
3. `enterprise:verify-isolation` proves the BFF role is non-superuser/non-`BYPASSRLS`, unscoped reads see nothing, cross-tenant writes fail, and tenant-wide reads stay inside one tenant;
4. Gateway health reports the dedicated tenant, ready managed MCP, configured authorization/event endpoints, fresh successful checks, and zero pending/dead-letter/error backlog;
5. cross-tenant thread reads return `404` and cannot be distinguished from missing records;
6. invitation-only registration/acceptance, role-escalation denial, seat/workspace races, token reservations, manual/auto/Harness compaction admission, turn/steer idempotency, active revocation interrupt/queue clear, terminal lease release, restart/outbox replay/dead-letter, pending-steer restore-without-start, and backup restore paths pass;
7. load tests cover the customer's negotiated member count and concurrency.
8. `npm audit` and container/SBOM scans have no unresolved reachable production advisories, or a time-bounded security exception documents reachability and compensating controls. Next image optimization remains disabled because tenant media is served only by the ownership-checked artifact route.

The trusted reverse proxy must reject chunked or declared API bodies above 64 KiB before Next.js parses them. The BFF also applies database-backed mutation/reconnect buckets, at most five SSE streams per user and 300 per tenant, and a 30-minute stream lifetime; proxy connection and request-rate limits remain mandatory defense in depth.

Tenant-wide quota aggregation and queue-steer admission use explicit hardened paths; ordinary database work remains workspace-scoped, and restart recovery cannot start a restored steer without a fresh BFF lease. See [Enterprise Tenancy Foundation](../architecture/enterprise-tenancy.md) for those semantics and the remaining commercial-control limitations.
