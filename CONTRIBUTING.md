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
- Browser -> Next.js BFF -> private Gateway -> App Server is mandatory.
- Browser input cannot control runtime policy, paths, provider identity, Tools, Hooks, Skills, or tenant scope.
- Commerce writes require authorization, approval, idempotency, audit, and downstream readback.
- Paid external reads require separate provider credentials, budget reservation, approval or priced policy evidence, exact-once dispatch, audit settlement, and no automatic retry after an uncertain result.
- JustOneAPI platforms, paths, permissions, and official prices come from `enterprise:import-justoneapi-pricing`; never add them as frontend or policy constants. Workspace rate cards are optional customer-pricing overrides.
- JustOneAPI methods, request schemas, parameter locations, pagination and documentation status come from `external-data:import-catalog`. The import must retain immutable sitemap/OpenAPI/normalized-contract hashes and intersect with the immutable pricing snapshot; do not hand-code endpoint branches.
- Marketplace country/site choices come from OpenAPI enums imported into `provider_market_option`. Agent instructions, Gateway code and frontend components must never own or copy those option lists.
- Model questions use only App Server `item/tool/requestUserInput`; application approvals hold the original `item/tool/call` and use `commerce/approval/*`. Never fabricate a Codex server request or duplicate its answer with `thread/inject_items`.
- New integrations use application Tools or managed MCP boundaries.
- Database migrations are append-only under `apps/web/migrations` and must be registered in `apps/web/scripts/migrate-auth.ts`.
- Per-message quality feedback is application data keyed to authoritative Harness thread, Turn, and `agentMessage` item ids. Do not use App Server `feedback/upload` for thumbs ratings, trust browser-supplied reply text/model metadata, or persist a second copy of the reply body in feedback tables.
- Harness receives only business-level external-data tools. Provider endpoint discovery, Schema inspection and raw parameter mapping stay in the private SHUEHO control plane. A business-contract or capability failure returns `success: false` with actionable `contentItems`; never relax dates or metrics, expose or synthesize an endpoint, substitute Web Search after a governed failure, or mark a failed tool call successful.
- Provider-ID dependency chains belong in the SQL `provider_business_workflow` catalog. Harness supplies keyword and business filters, never `itemId`, `ASIN`, `shopId`, or similar provider identifiers. A downstream step may use only an identifier resolved from quality-promoted source evidence and recorded in `research_workflow_binding_evidence`; every actual provider request still receives a separate reservation, approval decision, raw archive and settlement.
- Complete JustOneAPI REST requests/responses belong only in the independent external-data service's SQL raw layer. Commerce Pilot keeps a governance receipt and opaque warehouse ids. Do not expose either raw store through browser UI, BFF read/download routes, public MCP tools, logs, Hooks or ordinary audit events; thread deletion must never cascade into the warehouse.
- Frontend work follows `designs/` and uses the shared workbench components.

## Required Validation

Run the checks relevant to every code pull request:

```bash
npm run check
npm run external-data:check
npm run external-data:test
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
npm run external-data:verify:catalog
npm run external-data:verify
```

Web Search changes require `npm run smoke:web-search`. Provider changes require `npm run smoke:provider`. App Server lifecycle changes require `npm run smoke:codex` and focused restart/resume verification.

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
