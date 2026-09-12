# Contributing

## Before You Start

Read [`AGENTS.md`](AGENTS.md) and follow its task context routing. Load architecture and design documents for the boundaries being changed; agent-runtime work must preserve the Codex Harness invariant.

Do not commit `.env` files, provider credentials, Better Auth secrets, database URLs, `CODEX_HOME`, `.runtime`, attachments, generated images, session rollouts, database volumes, logs, or browser artifacts.

## Local Setup

Requirements:

- Node.js `22.23.2+` on the Node 22 LTS line, or Node 24 LTS (CI and production use Node 22.23.2);
- npm;
- Docker with Compose;
- an OpenAI/Codex credential or configured Responses-compatible provider.

```bash
npm install
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/web/.env.migration.example apps/web/.env.migration
npm run db:up
npm run auth:migrate
npm run enterprise:verify-isolation
```

Use local placeholder secrets only in ignored files. Never commit a real secret into an example file.

Run the services in separate terminals:

```bash
npm run dev
npm run web:dev
npm run jobs:thread-deletion
```

The deletion worker is a required separate process for the local delete UI. Set `COMMERCE_RUNTIME_TENANT_ID` in ignored `apps/web/.env` to the provisioned local tenant UUID before starting it. Without this worker, confirmed deletion jobs remain queued and the sidebar continues showing deletion spinners.

- Web: `http://127.0.0.1:3000`
- Private Gateway: `http://127.0.0.1:8787`

## Branches And Commits

- Create a branch from updated `main` for each task.
- Codex-created branches use `codex/<short-topic>`.
- Human branches may use `feature/`, `fix/`, `docs/`, or `chore/`.
- Do not force-push shared `main`.
- Prefer Conventional Commit subjects: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- One commit may include implementation, its tests, migration, and documentation when they form one coherent feature.

## Architecture Rules

- Codex App Server is the Agent runtime. Do not build a custom Agent loop.
- Generate protocol bindings from the pinned runtime with `npm run codex:protocol:generate`; do not add unsupported App Server fields to handwritten request objects.
- `turn/completed` is authoritative for an accepted Turn's terminal state. Browser timeouts, health changes, stale approval responses and generic `error` notifications may trigger reconciliation but may not fabricate completion or failure.
- Ordinary running-task direction changes keep input in `thread/queue/*`, interrupt the old Turn and start that same queue id after `turn/completed`; do not persist a second pending-steer registry or combine `turn/steer` with immediate interruption. A schema-constrained managed workflow must instead use native `turn/steer` on its active Turn, because the App Server queue contract cannot preserve `outputSchema`; confirm it by the same `clientUserMessageId` before allowing a retry.
- App Server fixes dynamic tools at `thread/start`. Register configured business tools deterministically, validate connectivity at call time, and increment the persisted task tool-contract version when the schema changes; never pretend `thread/resume` updated tools.
- Image generation uses Harness `imageGeneration` Items. The application-owned Codex patch may project a Provider-hosted Responses `image_generation_call` into that native Item inside Harness, but Gateway may only persist the resulting Item; it may not parse rollouts, fabricate an Item, make a duplicate Provider call, or expose base64/host paths to the browser.
- Custom Providers reach image generation only through the actor-authorized loopback Provider relay. The relay must validate its derived runtime credential, strip it before forwarding, inject the upstream secret server-side, allowlist Provider routes, and preserve one Harness-owned request/Item lifecycle. A disconnected or idle image-capable Responses stream is uncertain and must not be retried automatically.
- Conversation history uses `thread/turns/list` and `thread/items/list` pagination. Poll metadata/latest status for running tasks rather than re-reading all Turns.
- Reply retry and historical message editing use the Harness-native history operation supported by the thread: `thread/revert(beforeTurnId)` for paginated history or compatibility `thread/rollback(numTurns)` for legacy history, followed by `turn/start` from the authoritative Harness `userMessage`. Do not append a browser-reconstructed duplicate Turn, fabricate history with `thread/inject_items`, or accept retry text, Skill paths, attachment paths, output schemas, or history boundaries from the browser.
- Read-only task opening must use persisted `thread/read`/`thread/turns/list` without `thread/resume` or per-thread MCP readiness. Resume and enforce tools synchronously only before a model-executing Turn.
- Browser -> Next.js BFF -> private Gateway -> App Server is mandatory.
- Browser input cannot control runtime policy, paths, provider identity, Tools, Hooks, Skills, or tenant scope.
- Commerce writes require authorization, approval, idempotency, audit, and downstream readback.
- Paid external reads require separate provider credentials, budget reservation, approval or priced policy evidence, exact-once dispatch, audit settlement, and no automatic retry after an uncertain result.
- JustOneAPI platforms, paths, permissions, and official prices come from `enterprise:import-justoneapi-pricing`; never add them as frontend or policy constants. Workspace rate cards are optional customer-pricing overrides.
- JustOneAPI methods, request schemas, parameter locations, pagination and documentation status come from `external-data:import-catalog`. The import must retain immutable sitemap/OpenAPI/normalized-contract hashes and intersect with the immutable pricing snapshot; do not hand-code endpoint branches.
- Marketplace country/site choices come from OpenAPI enums imported into `provider_market_option`. Agent instructions, Gateway code and frontend components must never own or copy those option lists.
- Marketplace query language, script, currency, timezone and quality/sample policy come from immutable `provider_market_profile_import_receipt` revisions. A provider enum is selectable only when it intersects an enabled market profile; country labels are never language inference.
- Historical marketplace product collection used two phases: free `plan_marketplace_research` persists a tenant/thread/Turn-bound plan and obtains a no-reservation quote; paid `execute_marketplace_research` accepts only that plan id. Do not merge plan and execution arguments or allow execution to change platform, market, localization, sample size, endpoint set, catalog revision or workflow definition.
- Model questions use only App Server `item/tool/requestUserInput`; application approvals hold the original `item/tool/call` and use `commerce/approval/*`. Never fabricate a Codex server request or duplicate its answer with `thread/inject_items`.
- New integrations use application Tools or managed MCP boundaries.
- Database migrations are append-only in the owning service. Register web migrations in `apps/web/scripts/migrate-auth.ts`; external-data migrations follow that service's migration runner and ordering contract.
- Per-message quality feedback is application data keyed to authoritative Harness thread, Turn, and `agentMessage` item ids. Do not use App Server `feedback/upload` for thumbs ratings, trust browser-supplied reply text/model metadata, or persist a second copy of the reply body in feedback tables.
- Harness receives application-owned business tools. The complete capability registry may expose validated credential-free business input schemas through opaque capability IDs; provider transport paths, credentials and raw archives remain private. Generic data plans must retain immutable scope, approved market profiles, live governance and separate source-observation semantics. Capability failures return explicit blocking reasons and must never cause invented endpoints, changed constraints, fabricated evidence or false success.
- Provider-ID dependency chains belong in the SQL `provider_business_workflow` catalog. Harness supplies keyword and business filters, never `itemId`, `ASIN`, `shopId`, or similar provider identifiers. A downstream step may use only an identifier resolved from quality-promoted source evidence and recorded in `research_workflow_binding_evidence`; every actual provider request still receives a separate reservation, approval decision, raw archive and settlement.
- Discovery-to-detail workflows use immutable `research_workflow_target` rows and target-specific step instances. Representative selection must deduplicate provider bindings and penalize near-duplicate titles/same-shop concentration; do not return to a single global binding or reuse one step execution row for multiple paid calls.
- Multilingual relevance evaluates original, localized and script-normalized query variants. Deterministically corrupt or cross-category records may be rejected; valid low-confidence records must be held rather than labeled irrelevant. AI decisions annotate source data and never mutate or delete it.
- Complete JustOneAPI REST requests/responses belong only in the independent external-data service's SQL raw layer. Commerce Pilot keeps a governance receipt and opaque warehouse ids. Do not expose either raw store through browser UI, BFF read/download routes, public MCP tools, logs, Hooks or ordinary audit events; thread deletion must never cascade into the warehouse.
- Frontend work follows `designs/` and uses the shared workbench components.

## Required Validation

Research changes must also satisfy the cross-component [research failure matrix](docs/architecture/research-failure-matrix.md), including cancellation before/after dispatch, actual compatibility-bridge approvals, connection isolation and complete large-result traversal. Isolated PostgreSQL budget tests use `BUDGET_TEST_DATABASE_URL` pointing to an explicitly disposable owner database; CI supplies its external-data test database. Never use production data for destructive fixture tests or paid supplier smoke calls.

Select all rows affected by the change. Shared contracts require checks on both sides; a documentation-only change does not require application builds or paid calls. Reuse results only for unchanged tested code and the same relevant environment; new failures or changes require the affected checks again. Report missing prerequisites and skipped required checks explicitly.

| Changed layer | Required verification |
| --- | --- |
| Documentation / instruction text | `git diff --check`, relative links, instruction consistency; Skill frontmatter, references and representative routing scenarios |
| Gateway / Harness adapters / generated business Skills | `npm run check`, `npm run test:gateway`; focused behavioral coverage for changed tool and workflow contracts |
| Runtime artifact / patches | `npm run codex:runtime:test`, exact upstream tests, manifest verification and application-owned binary build |
| External-data service | `npm run external-data:check`, `npm run external-data:test`; `npm run external-data:evaluate` for retrieval/quality changes |
| Web / BFF | `npm run web:check`, `npm run web:test`, `npm run web:build`; real browser inspection when UI changes |
| Runtime permissions / isolation / tenant ownership | `npm run security:runtime` plus affected tenant/RLS verifiers |
| Database contracts | Apply owning-service migrations and run relevant isolation/catalog/service verifiers in an explicitly disposable database |
| Load validation / browser edge | `npm run test:load-validation`; `nginx -t` for edge config changes; preserve actual failed and passed load results |

Research changes also require the failure, lifecycle, recovery and relevance checks below when those contracts are affected. Every change requires `git diff --check`.

### Database Verification Versus Operational Imports

`auth:migrate` and `external-data:migrate` mutate the target database. Run them against disposable test databases for validation; a production migration belongs to the requested release and its runbook. Depending on the changed contract, use `enterprise:verify-isolation`, `enterprise:verify-external-data`, `external-data:verify:catalog`, and `external-data:verify` against the appropriate configured test environment. Inspect a verifier's fixtures before choosing its target: a verifier name does not guarantee read-only behavior.

`external-data:import-catalog`, `external-data:import-market-profiles`, `external-data:import-business-workflows`, and `enterprise:import-justoneapi-pricing` are master-data mutations, not universal PR checks. Exercise changed importers with validated fixtures in a disposable database. Run production imports only within an authorized operation, using immutable receipts and readback; do not reimport master data merely because an unrelated migration changed.

Web Search changes require `npm run smoke:web-search`. Model-provider transport changes require `npm run smoke:provider`; native image transport/Item changes also require `npm run smoke:image-tool`. JustOneAPI transport changes use external-data tests and governance verification, not model-provider smoke tests. Live paid smokes require authorization for their calls and must preserve uncertain-result no-replay rules. Patched-runtime changes additionally require exact upstream Rust tests, `npm run codex:runtime:test`, manifest verification, and an application-owned binary build. App Server lifecycle changes require `npm run smoke:codex`, `npm run smoke:steer-pivot`, and focused restart/resume verification.

For frontend changes, inspect the running UI with browser automation or Playwright at desktop and mobile widths. Verify no overlap, clipping, blank canvas, horizontal overflow, unexpected native scrollbar, or inaccessible control.

## Pull Requests

The PR description must include:

- business outcome and user-visible behavior;
- Harness/App Server API used;
- security and tenant implications;
- database migration or artifact lifecycle changes;
- tests and visual verification;
- deployment status and required operator steps;
- known limitations or follow-up work.

Do not merge a PR with unresolved high-risk review findings, missing migrations, failing CI, undocumented architecture changes, or unverified external writes.

- Current research contracts submit immutable durable tasks directly. Do not expose free planning/separate execution tools. Preserve internal scope receipts, live authorization/budget checks, fenced operation checkpoints, no uncertain replay and legacy readback.

Recovery changes must execute the real createResearchService entrypoint with taskAwareClient and a durable journal model: financial reply loss followed by provider checkpoint loss must finish the original scope with one provider call, no plan cancellation and one settlement intent. Also exercise failed structured RPC receipts, native cancellation during financial outage, cross-session approval races and chronological cursor traversal. Adapter-only tests are insufficient acceptance evidence.

Lifecycle changes must test the adapter state contract against the applied research_request.status SQL constraint (LIFECYCLE_TEST_DATABASE_URL on a disposable local database; existing CI database otherwise), every intermediate state through the real research entrypoint, original-result refresh without supplier replay, immutable terminal checkpoints, zero early settlement and transient admission recovery. Include more than five processing waits and the server-side wait deadline.

Nullable monthly call-count policy changes require the real PostgreSQL governance verifier: admit more than 100 reservations with only a money cap and still reject spending beyond that cap. Verify the actual UI preserves null on save, and deterministic quota failures finish without retries.

Relevance changes must run evaluateProductionRelevance (production query construction, real local models, paired admission and date checks), retain DB evaluation and test per-request instructions. Optional semantic_scope comes from Harness/user constraints, never a backend intent classifier. Verify source-field coverage independently of delivered evidence with research-quality-summary.integration.test.ts against a disposable database. The hardcoding audit must distinguish remaining policies from verified fixes.

### Local load validation

Use the isolated drivers in [`scripts/load-test/`](scripts/load-test/README.md) for authenticated 20/30-user reads and an explicitly authorized batch of 10 native image Turns. Keep credentials/fixtures under ignored runtime storage, use disposable databases and a separate `CODEX_HOME`, and never restart the daily development/production Gateway to run these tests. Keep failed baseline results, actual image and native terminal timings, and the test environment in the report. Local production Web builds do not certify production transport, OS isolation, upstream quotas, or long-duration capacity.
