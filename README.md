# SHUEHO Commerce Pilot

Web application for a commerce agent, built on OpenAI's open-source Codex App Server harness.

The project invariants are recorded in [AGENTS.md](./AGENTS.md): the e-commerce agent runtime must be based on the Codex open-source harness, and the product surface is a browser-based web application, not a desktop app. Product UI, commerce tools, persistence, and integrations should sit around that runtime instead of replacing it.

## Start Here

This repository is designed for humans collaborating with coding agents. Before changing code, read:

1. [AGENTS.md](./AGENTS.md) - non-negotiable Harness, security, product, and UI rules;
2. [CONTRIBUTING.md](./CONTRIBUTING.md) - setup, branch, migration, test, commit, and PR workflow;
3. [Architecture Overview](./docs/architecture/overview.md) - technology stack and service boundaries;
4. [AI-Assisted Collaboration](./docs/development/ai-collaboration.md) - shared vibe-coding and handoff rules;
5. [Coding Agent Bootstrap Prompt](./docs/development/agent-bootstrap-prompt.md) - a copyable prompt for a teammate's coding agent;
6. [Documentation Map](./docs/README.md) - feature-specific architecture and deployment documents.

**Do not replace Codex App Server with a self-built agent loop or another orchestration framework.** Codex Harness owns threads, Turns, streaming items, tools, Skills, approvals, interruption, queueing, recovery, compaction, and multi-agent behavior.

## What Is Integrated

- Starts `codex app-server --listen stdio://` as the local agent runtime.
- Declares `@openai/codex` as an application dependency so deployments do not rely on a globally installed `codex` binary.
- Sends the required `initialize` request and `initialized` notification.
- Exposes a small HTTP/SSE gateway for the browser web application.
- Streams allowlisted Codex App Server notifications over SSE.
- Fixes the model provider, runtime directory, permissions, and tool registry on the server; browser requests cannot override them.
- Discovers text and image models from the application-owned CPA provider.
- Uses the Codex host-tool protocol to expose `gpt-image-2` image generation inside agent turns.
- Disables shell, unified exec, arbitrary local-path file tools, process network access, connectors, unmanaged MCP, plugins, and unmanaged Hooks.
- Exposes provider-backed Web Search through the application-owned `commerce_web.search` MCP server, with real Harness `mcpToolCall` lifecycle events and cited source URLs. This remains available when old threads are resumed because it is managed runtime configuration rather than a `thread/start` dynamic-tool snapshot.
- Reloads and validates `commerce_web.search` against the current App Server process before Gateway starts or accepts a thread. `/health` reports the real MCP catalog instead of a configured-only flag, and transient provider timeouts receive one bounded MCP-internal retry.
- Allows bounded multi-agent collaboration; subagents inherit the same restricted runtime policy.
- Keeps arbitrary local-path `view_image` disabled. Tenant-owned photos use the authenticated thread attachment pipeline and native App Server `localImage` inputs; browser events never receive host paths.
- Enables an application-generated managed Hook runner for prompt, tool, compaction, stop, session, and subagent lifecycle policy/audit events; users cannot provide Hook commands.
- Monitors App Server token-usage events and invokes native `thread/compact/start` at a configurable context threshold; no application-authored conversation summary loop is used.
- Uses the App Server thread queue for running-turn submissions, including native add/list/update/delete operations. “调整方向” atomically moves one queue item into an application-owned durable FIFO pending-steer state, submits it through `turn/steer`, immediately interrupts the superseded turn, and resubmits the uncommitted steer as the next Harness turn.
- Implements an Enterprise-only organization, one-to-one isolation tenant, and workspace foundation with invitation-only registration, members, workspace lifecycle, invitation revocation, tenant audit reads, direct/group roles, explicit-deny precedence, contracts, seats, quotas, and tenant-scoped thread ownership.
- Pins each production Gateway/App Server/`CODEX_HOME` to one Enterprise tenant; tenant, workspace, and user scope are resolved by the authenticated BFF and cannot be selected by the browser.
- Records exact Codex 0.149 Harness usage plus source-attributed MCP/Web Search/image usage, including explicit missing-usage status, through a durable outbox/dead-letter pipeline and idempotent PostgreSQL ledger.
- Reserves direct, queue-steer, and context-compaction root-job leases under tenant-wide concurrency and projected token/request budgets; Codex multi-agent fan-out is separately capped at four threads per session by default.
- Actively polls Enterprise authorization for running roots, reauthorizes host-tool calls, and interrupts active work plus clears queued input when access is revoked or the authorizer fails.
- Provides an authenticated, read-only Commerce Plugin inventory inside the existing workbench shell, with `/plugins` as a direct entry point. Manifests describe application-managed skills, MCP servers, tools, UI, and security scope, while enablement is derived from live Gateway/MCP/Provider evidence. List controls open same-shell details; arbitrary package installation and host execution remain disabled. See [Commerce Plugin Runtime](./docs/architecture/commerce-plugin-runtime.md).
- Provides a same-shell conversational copywriting Task Recipe: users state a goal, the Harness asks only high-impact missing questions through native `request_user_input`, and the same Turn returns the requested copy or a direct answer rather than a plan or parallel form wizard. See [Commerce Copywriting Workflow](./docs/architecture/commerce-copywriting-workflow.md).
- Provides the phase-one Creative Space shell with My Work, content-project browsing and mock creation, a free chapter index, Inspiration & Cases, and an AI Toolbox that preserves the existing copywriting Recipe. Phase-one project data is explicitly in-memory and not persisted. See [Creative Space Foundation](./docs/architecture/creative-space-foundation.md).
- Provides a separate authenticated Skills inventory backed directly by App Server `skills/list`, explicit `@` selection in the shared composer, and native `$skill-name` + `skill` Turn inputs. The global `skill-creator` can publish instruction-only Skills through application validation, Enterprise-owner approval, and App Server readback. See [Commerce Skill Runtime](./docs/architecture/commerce-skill-runtime.md).
- Supports tenant/thread/request-bound photos and bounded PDF, DOCX, XLSX, CSV, JSON, Markdown, and text attachments. Photos use native `localImage`; documents are safely extracted into bounded context. See [Thread Attachments](./docs/architecture/thread-attachments.md).
- Permanently deletes tasks through a durable PostgreSQL background queue. App Server thread-tree deletion completes before generated images, uploads, extracted text, and application indexes are removed. See [Thread Deletion](./docs/architecture/thread-deletion.md).
- Generates outcome-oriented titles with `gpt-5.3-codex-spark` and applies deterministic business-category correction before grouping recent tasks.

This is not a desktop app scaffold. The browser frontend should call this gateway; it should not embed Codex App Server directly.

Commerce Pilot is currently an Enterprise-only B2B product. One customer company is represented by a commercial organization record and a one-to-one security/runtime tenant; workspaces below the tenant separate teams, brands, stores, or business units. The public Enterprise page routes prospects to Sales rather than offering Free, Plus, or Pro self-service plans. See [docs/architecture/enterprise-tenancy.md](./docs/architecture/enterprise-tenancy.md) for the implemented boundaries and production-readiness limitations.

## Requirements

- Node.js 20.16+
- npm
- Docker with Compose for the provided local PostgreSQL environment, or an externally managed PostgreSQL database
- OpenAI/Codex credentials or a compatible custom provider configured for the deployed app runtime

The app uses the dependency-managed Codex binary by default:

```bash
./node_modules/.bin/codex --version
```

## Install

```bash
npm install
```

## Verify The App Server Integration

This starts Codex App Server over stdio, initializes it, reads diagnostics/config, and exits without starting a model turn:

```bash
npm run smoke:codex
```

## Run The Gateway

```bash
npm run dev
```

Default URL:

```text
http://127.0.0.1:8787
```

## Run The Web App

The browser frontend lives in `apps/web` and follows the design system in [designs/DESIGN.md](./designs/DESIGN.md). Authentication uses PostgreSQL-backed Better Auth sessions.

Configure the runtime credential from `apps/web/.env.example` and the job-only owner credential from `apps/web/.env.migration.example`, start PostgreSQL, apply all registered migrations, and verify forced RLS:

```bash
npm run db:up
npm run auth:migrate
npm run enterprise:verify-isolation
```

`DATABASE_URL` is the non-superuser, non-`BYPASSRLS` web role. `MIGRATION_DATABASE_URL` lives only in `.env.migration` or a migration/provisioning job secret; it must not exist in the long-running Web environment. Production fails closed when these boundaries are not satisfied.

An authenticated account does not automatically receive Enterprise access. After creating the intended local owner account, provision its organization, one-to-one tenant, and default workspace:

```bash
npm run enterprise:bootstrap -- \
  --owner-email=owner@example.com \
  --tenant-name="Example Company" \
  --tenant-slug=example-company
```

The command also creates the Enterprise contract, seeded roles, owner assignments, and a tenant-dedicated runtime record. It is an operator command and mutates existing records when re-run for the same slug.

For local first-owner setup only, set `COMMERCE_ALLOW_PUBLIC_REGISTRATION=true`, create the account, then return it to `false`. Production ignores this override and the initial owner must come from a controlled operator/identity provisioning flow.

Copy `apps/web/.env.example` to an ignored `apps/web/.env` and `apps/web/.env.migration.example` to an ignored `apps/web/.env.migration` for local development. Production must provide a least-privilege `DATABASE_URL`, keep the migration credential exclusively in one-shot jobs, and configure `BETTER_AUTH_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters, exact trusted browser origins, and invitation-only registration.

```bash
npm run web:dev
```

Run the durable deletion worker in a third terminal. A web-process callback is not a replacement for this worker:

```bash
npm run jobs:thread-deletion
```

Default URL:

```text
http://127.0.0.1:3000
```

The web app reads gateway health through its own Next.js route handler at `/api/gateway/health`. By default it expects the gateway at `http://127.0.0.1:8787`; override it for local or deployed environments with:

```bash
COMMERCE_GATEWAY_URL=http://127.0.0.1:8787 npm run web:dev
```

Frontend checks:

```bash
npm run web:check
npm run web:test
npm run web:build
```

Full pull-request validation:

```bash
npm run check
npm run web:check
npm run test:gateway
npm run web:test
npm run security:runtime
npm run web:build
git diff --check
```

Production registration is Enterprise invitation-only and requires the exact invited work email. Invite bearer tokens use `/invite#token=...`; the browser moves the fragment into memory and immediately removes it from the address bar. `COMMERCE_ALLOW_PUBLIC_REGISTRATION=true` works only outside production for bootstrap/E2E. Email/SMS delivery interfaces remain disabled until explicitly configured, and the application never logs verification codes. See [docs/architecture/authentication.md](./docs/architecture/authentication.md).

Authenticated conversations are indexed by tenant, workspace, and creator in PostgreSQL while Codex App Server remains the source of truth for turns and messages. Refresh restores the most recent owned thread, the sidebar opens older owned threads, and Gateway resumes persisted threads before a post-restart follow-up.

Users may run independent threads concurrently. Running history items show a spinner in the sidebar; switching conversations or starting a new task leaves background turns running, while each individual thread still permits only one active turn at a time.

Long conversations use Codex-native context compaction. Manual, automatic-threshold, and Harness-initiated compaction all pass Enterprise authorization/quota admission; denial fails or interrupts the compact turn. Compact progress is streamed as a `contextCompaction` item, and the same thread cannot accept another turn until it completes. Configure the threshold/timeout with `COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT` and `COMMERCE_AGENT_COMPACTION_TIMEOUT_MS`; configure Gateway callbacks with `COMMERCE_AGENT_ADMISSION_URL` and `COMMERCE_AGENT_AUTHORIZATION_URL`.

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Production readiness must also inspect `managedMcp`, `runtimePolicy.enterpriseRuntime.authorizationError`, pending events, dead letters, and event-sink timestamps/errors; HTTP `200` alone does not prove the Enterprise control paths are healthy.

Open a scoped event stream in loopback-only development:

```bash
curl -N 'http://127.0.0.1:8787/api/codex/events?threadId=THREAD_ID' \
  -H 'X-Commerce-Tenant-Id: TENANT_UUID' \
  -H 'X-Commerce-Workspace-Id: WORKSPACE_UUID' \
  -H 'X-Commerce-User-Id: USER_ID'
```

Start a thread:

```bash
curl -X POST http://127.0.0.1:8787/api/threads \
  -H 'Content-Type: application/json' \
  -H 'X-Commerce-Tenant-Id: TENANT_UUID' \
  -H 'X-Commerce-Workspace-Id: WORKSPACE_UUID' \
  -H 'X-Commerce-User-Id: USER_ID' \
  -d '{"model": "MODEL_ID"}'
```

Start a turn:

```bash
curl -X POST http://127.0.0.1:8787/api/threads/THREAD_ID/turns \
  -H 'Content-Type: application/json' \
  -H 'X-Commerce-Tenant-Id: TENANT_UUID' \
  -H 'X-Commerce-Workspace-Id: WORKSPACE_UUID' \
  -H 'X-Commerce-User-Id: USER_ID' \
  -d '{"message": "分析这个店铺的库存预警策略"}'
```

These direct Gateway examples are for loopback-only local development when the internal token is deliberately unset. They demonstrate protocol shape, not an authorization path. Production callers must use the Next.js BFF, which derives scope from session/membership and adds `COMMERCE_GATEWAY_INTERNAL_TOKEN`; do not expose port `8787` or accept browser-supplied scope headers.

## Custom Model Providers

Yes, custom providers can be used with App Server. This gateway configures `luusmosh_cpa` at `https://cpa.luusmosh.com/v1`, passes `modelProvider` to `thread/start`, and uses the Responses wire API required by current Codex.

Provider definitions are generated into the app-owned `$CODEX_HOME/config.toml`. The application does not rely on a human user's `~/.codex/config.toml`, and deployment machines do not need a globally installed `codex`.

Project `.codex/config.toml` is not the right place for production provider secrets. Treat provider definitions and credentials as deployment configuration.

Example user-level config:

```toml
model_provider = "luusmosh_cpa"
model = "gpt-5.6-sol"

[model_providers.luusmosh_cpa]
name = "Luusmosh CPA"
base_url = "https://cpa.luusmosh.com/v1"
env_key = "COMMERCE_PROVIDER_API_KEY"
wire_api = "responses"
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
```

The browser selects only the model. Provider identity and runtime policy remain server-owned:

```json
{
  "model": "gpt-5.6-sol"
}
```

Thread titles are generated after the first completed result by the dedicated `COMMERCE_TITLE_MODEL` (default `gpt-5.3-codex-spark`). The Gateway reads the authoritative App Server history, generates an outcome-oriented title through the configured provider, calls App Server `thread/name/set`, and updates the tenant-scoped thread index. The browser cannot submit a title or choose the title model. See [Commerce Thread Titles](./docs/architecture/commerce-thread-titles.md).

The gateway exposes `gpt-image-2` only as the Codex-hosted `commerce_image.generate` tool; no direct image-generation HTTP route exists. Authenticated artifact reads still verify thread ownership. Generated files are stored under the tenant-owned `$CODEX_HOME/generated_images`, provider keys remain server-side, and image-provider usage is recorded separately.

Generated-image artifact metadata is stored separately under `$CODEX_HOME/generated_image_metadata` and binds each immutable filename to its originating thread and turn. For installations that created images before this metadata existed, run `npm run backfill:image-artifacts` once before serving restored history.

Web Search is the application-owned `commerce_web.search` MCP tool. App Server launches the fixed stdio server from app-owned config, exposes only its read-only `search(query)` contract, and receives normal `mcpToolCall` events. The MCP server calls the configured provider's OpenAI-compatible `/v1/responses` Web Search capability and returns cited sources. Because MCP configuration is loaded by the runtime when a thread is resumed, conversations created before Web Search was added receive it without history migration. Native `web_search = "live"` remains enabled when the provider supports it, and the old dynamic-tool handler remains compatibility-only for threads that already persisted that definition.

Gateway calls App Server `config/mcpServer/reload` at startup, then requires `mcpServerStatus/list` to contain `commerce_web.search`; startup and thread operations fail closed otherwise. Configure provider retry bounds with `COMMERCE_WEB_SEARCH_TIMEOUT_MS` and `COMMERCE_WEB_SEARCH_MAX_ATTEMPTS`. `npm run smoke:web-search` verifies the complete Gateway → App Server → model → MCP → provider → cited-answer path.

See [docs/config/custom-model-provider.md](./docs/config/custom-model-provider.md) for details.

## Deployment Runtime

Deployment machines do not need to preinstall Codex. The app declares `@openai/codex` as a production dependency and resolves Codex App Server from the application dependency tree. Production requires `COMMERCE_RUNTIME_TENANT_ID`, tenant-dedicated `CODEX_HOME`, private event/authorization/admission callbacks, a least-privilege runtime database role, and a non-root container or equivalent isolation boundary. See [docs/deployment/runtime.md](./docs/deployment/runtime.md).
