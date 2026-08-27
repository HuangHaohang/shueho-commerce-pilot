# Architecture Overview

## Product

SHUEHO Commerce Pilot is an Enterprise, browser-based e-commerce Agent for research, content, catalog, order, inventory, support, reporting, and operational workflows. It is not a generic chat demo and not a local coding-agent UI.

## Non-Negotiable Agent Foundation

The Agent runtime is OpenAI's open-source Codex Harness through Codex App Server. This is an architectural invariant, not an interchangeable provider choice.

Codex App Server owns:

- thread and Turn lifecycle;
- persisted multi-turn history;
- streamed item and Turn events;
- tool-call lifecycle;
- model-originated `request_user_input`, Harness permission approvals, and their server-request lifecycle;
- interruption, steering, queueing, continuation, recovery, and compaction;
- Skill invocation and multi-agent collaboration.

Commerce Pilot must not replace these concerns with a custom agent loop, prompt chain, LangChain/LangGraph-style orchestrator, another generic agent framework, or browser-owned state machine. Product code may adapt App Server protocol details behind narrow modules, but the Harness remains authoritative. Application authorization for a paid or side-effecting dynamic tool may hold the original `item/tool/call`; it must use a Commerce event and must not fabricate a Codex server request.

## Technology Stack

| Layer | Technology | Responsibility |
|---|---|---|
| Browser application | Next.js 15 App Router, React 19, TypeScript | Workbench, conversation UI, BFF route handlers, authenticated artifact delivery |
| UI system | Tailwind CSS v4, shadcn/ui, Radix primitives, lucide-react | Accessible controls and the project design system |
| Client server-state | TanStack Query | Models, threads, plugins, Skills, Enterprise state, cache invalidation |
| Agent gateway | Node.js 20.16+, TypeScript, native HTTP/SSE | App Server ownership, policy, scope binding, event sanitization, host tools |
| Agent runtime | `@openai/codex` App Server | Threads, Turns, streaming, tools, Skills, approvals, queue, compaction, multi-agent |
| Agent protocol | JSON-RPC over application-owned stdio | Gateway-to-App Server communication only |
| Authentication | Better Auth | Browser sessions and invitation-only identity |
| Business database | PostgreSQL 16 | Enterprise identity, RBAC, RLS, thread index, quotas, usage, deletion jobs |
| External data warehouse | PostgreSQL 16 + pgvector 0.8.6 | Independent request lineage, complete raw responses, normalized source data, vectors and curated business evidence |
| External search index | Elasticsearch 9.5.2 | Rebuildable BM25 search and aggregations populated through a PostgreSQL Outbox |
| Local retrieval models | Qwen3 Embedding 4B + Qwen3 Reranker 4B | Local 1024-dimensional semantic retrieval and cross-encoder relevance judgment |
| External tools | Application-managed MCP and host tools | Web Search, image generation, governed JustOneAPI market data, future commerce systems |
| Artifact storage | Tenant-dedicated `CODEX_HOME` volumes | Codex state, generated images, uploads, extracted documents, outbox |
| Document parsing | PDF.js, Mammoth, ExcelJS, file-type | Bounded tenant attachment extraction; never arbitrary host-file access |
| Tests | Node test runner, Vitest, Testing Library, Playwright/browser QA | Gateway contracts, web logic, UI and runtime verification |

## Process And Trust Boundaries

```text
Browser
  -> Next.js BFF (session, tenant, workspace, permission checks)
  -> private Gateway HTTP/SSE (service token + server-derived scope)
  -> Codex App Server over stdio
  -> Codex Harness
  -> allowlisted MCP / application host tools
  -> commerce systems or provider APIs
```

External market data has an additional mediated boundary:

```text
Codex Harness business-level commerce_data tool or external Commerce Pilot MCP client
  -> application authorization / approval / quota / audit / billing
  -> SHUEHO External Data MCP
  -> service-owned JustOneAPI REST client
  -> JustOneAPI REST API
  -> independent raw, normalized and business warehouse
```

Keyword product research is a bounded business workflow inside that service, not an Agent loop. Harness invokes one business tool; the service plans search and dependent detail/price/review steps from SQL, resolves provider identifiers only from quality-checked source records, and the Gateway applies authorization, approval and settlement separately to every actual paid request.

Inbound Commerce Pilot identities are never passed through as JustOneAPI credentials. See [External Data MCP And Governance](./external-data-mcp.md).

The browser never connects directly to App Server and never supplies `cwd`, provider identity, tool definitions, sandbox policy, developer instructions, Skill paths, host paths, Hook commands, or Enterprise scope headers.

## Sources Of Truth

| Concern | Authoritative source |
|---|---|
| Conversation messages and Turn state | Codex App Server thread history |
| Active Turn and queue | App Server read/queue APIs |
| Browser identity and Enterprise access | Better Auth + PostgreSQL RLS context |
| Thread ownership index | PostgreSQL `commerce_agent_thread` |
| Skill catalog | App Server `skills/list` for the application runtime root |
| Plugin availability | Application manifests + live Gateway/MCP/provider evidence |
| Tool permissions | Application runtime registry and server-owned policy |
| Usage | Exact provider/App Server usage events + idempotent PostgreSQL ledger |
| Audit, billing, and reply feedback | Transactional append-only PostgreSQL records under Enterprise RLS |
| Complete JustOneAPI request/response authority | Independent SQL-only `external_api_call_raw`; `commerce_external_data_archive` retains the governance receipt and warehouse ids |
| Runtime operational logs | Redacted structured JSON, exportable through OpenTelemetry to Elastic or another log backend; never the business source of truth |
| Uploaded/generated media | Tenant artifact metadata + ownership-checked BFF URL |
| External write completion | Downstream write receipt followed by readback evidence |

## Main Request Flows

### Start A Turn

1. Browser submits natural-language text, selected Skill name, and optional files to the BFF.
2. BFF authenticates the user, resolves tenant/workspace scope, checks thread ownership, quota, and rate limits.
3. Files upload first and bind to the same `clientRequestId` as the Turn.
4. Gateway reconciles active Harness state, resolves the Skill path through `skills/list`, and validates artifact ownership.
5. Gateway calls native `turn/start` with text, Skill, `localImage`, and bounded document-context inputs.
6. App Server streams item lifecycle events; Gateway sanitizes and fans out allowlisted events through SSE.
7. BFF records completion/usage and the browser reconciles optimistic messages with authoritative item ids.

### Side-Effecting Commerce Tool

1. Agent proposes a structured action against a named external system and record.
2. Application authorization checks tenant, workspace, user, tool, and object scope.
3. Human approval is requested when required.
4. The application executes an idempotent write.
5. The same integration reads the changed object back.
6. UI distinguishes proposed, approved, written, and verified states.

No external write is complete merely because the model said it succeeded.

## Repository Boundaries

```text
apps/web/                 Next.js browser application and BFF
src/codex/                narrow App Server protocol/runtime adapters
src/gateway/              private Gateway, policy, stores, event handling
src/provider/             Responses-compatible model/provider client
apps/web/migrations/      append-only PostgreSQL migrations
apps/external-data/       independent REST collector, warehouse, local-AI enrichment, search index and internal MCP
services/local-retrieval-models/ bounded local Qwen3 Embedding/Reranker HTTP process
scripts/                  smoke, security, reconciliation, backfill tools
designs/                  mandatory frontend design system
docs/                     architecture, development, deployment contracts
```

New commerce integrations belong in explicit application tools or managed MCP servers. They do not belong in shell commands, browser fetches to vendor APIs, arbitrary filesystem access, or generated Hooks.
