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
- New integrations use application Tools or managed MCP boundaries.
- Database migrations are append-only under `apps/web/migrations` and must be registered in `apps/web/scripts/migrate-auth.ts`.
- Frontend work follows `designs/` and uses the shared workbench components.

## Required Validation

Run the checks relevant to every code pull request:

```bash
npm run check
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
