# Contributing

## Before You Start

Read [`AGENTS.md`](AGENTS.md), [`docs/architecture/overview.md`](docs/architecture/overview.md), and [`designs/DESIGN.md`](designs/DESIGN.md). Agent-runtime work must preserve the Codex Harness invariant.

Do not commit `.env` files, provider credentials, Better Auth secrets, database URLs, `CODEX_HOME`, `.runtime`, attachments, generated images, session rollouts, database volumes, logs, or browser artifacts.

## Local Setup

Requirements:

- Node.js `20.16+` (CI uses Node 20.18);
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
- Image generation uses native `image_gen` and `imageGeneration` Items. Gateway may persist and project an ownership-checked artifact, but may not make a duplicate provider image call or expose native base64/host paths to the browser.
- Custom Providers reach native `image_gen` only through the actor-authorized loopback Provider relay. The relay must validate its derived runtime credential, strip it before forwarding, inject the upstream secret server-side, allowlist Provider routes, and preserve the single Harness-owned request/Item lifecycle.
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
- Marketplace product collection is two-phase for new Harness contracts: free `plan_marketplace_research` persists a tenant/thread/Turn-bound plan and obtains a no-reservation quote; paid `execute_marketplace_research` accepts only that plan id. Do not merge plan and execution arguments or allow execution to change platform, market, localization, sample size, endpoint set, catalog revision or workflow definition.
- Model questions use only App Server `item/tool/requestUserInput`; application approvals hold the original `item/tool/call` and use `commerce/approval/*`. Never fabricate a Codex server request or duplicate its answer with `thread/inject_items`.
- New integrations use application Tools or managed MCP boundaries.
- Database migrations are append-only under `apps/web/migrations` and must be registered in `apps/web/scripts/migrate-auth.ts`.
- Per-message quality feedback is application data keyed to authoritative Harness thread, Turn, and `agentMessage` item ids. Do not use App Server `feedback/upload` for thumbs ratings, trust browser-supplied reply text/model metadata, or persist a second copy of the reply body in feedback tables.
- Harness receives only business-level external-data tools. Provider endpoint discovery, Schema inspection and raw parameter mapping stay in the private SHUEHO control plane. A business-contract or capability failure returns `success: false` with actionable `contentItems`; never relax dates or metrics, expose or synthesize an endpoint, substitute Web Search after a governed failure, or mark a failed tool call successful.
- Provider-ID dependency chains belong in the SQL `provider_business_workflow` catalog. Harness supplies keyword and business filters, never `itemId`, `ASIN`, `shopId`, or similar provider identifiers. A downstream step may use only an identifier resolved from quality-promoted source evidence and recorded in `research_workflow_binding_evidence`; every actual provider request still receives a separate reservation, approval decision, raw archive and settlement.
- Discovery-to-detail workflows use immutable `research_workflow_target` rows and target-specific step instances. Representative selection must deduplicate provider bindings and penalize near-duplicate titles/same-shop concentration; do not return to a single global binding or reuse one step execution row for multiple paid calls.
- Multilingual relevance evaluates original, localized and script-normalized query variants. Deterministically corrupt or cross-category records may be rejected; valid low-confidence records must be held rather than labeled irrelevant. AI decisions annotate source data and never mutate or delete it.
- Complete JustOneAPI REST requests/responses belong only in the independent external-data service's SQL raw layer. Commerce Pilot keeps a governance receipt and opaque warehouse ids. Do not expose either raw store through browser UI, BFF read/download routes, public MCP tools, logs, Hooks or ordinary audit events; thread deletion must never cascade into the warehouse.
- Frontend work follows `designs/` and uses the shared workbench components.

## Required Validation

Run the checks relevant to every code pull request:

```bash
npm run check
npm run external-data:check
npm run external-data:test
npm run external-data:evaluate
npm run web:check
npm run test:gateway
npm run web:test
npm run security:runtime
npm run web:build
git diff --check
```

Database/RLS or migration changes also require:

```bash
npm run auth:migrate
npm run enterprise:verify-isolation
npm run enterprise:verify-external-data
npm run external-data:migrate
npm run external-data:import-catalog
npm run external-data:import-market-profiles
npm run external-data:import-business-workflows
npm run external-data:verify:catalog
npm run external-data:verify
```

Web Search changes require `npm run smoke:web-search`. Provider changes require `npm run smoke:provider` and `npm run smoke:image-tool`. App Server lifecycle changes require `npm run smoke:codex`, `npm run smoke:steer-pivot`, and focused restart/resume verification.

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
