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
| Creative canvas | `@xyflow/react` custom React nodes | Infinite viewport, node selection, resize, MiniMap and accessible spatial navigation; content remains application React UI |
| Client server-state | TanStack Query | Models, threads, plugins, Skills, Enterprise state, cache invalidation |
| Agent gateway | Node.js 20.16+, TypeScript, native HTTP/SSE | App Server ownership, policy, scope binding, event sanitization, host tools |
| Agent runtime | `@openai/codex` App Server | Threads, Turns, streaming, tools, Skills, approvals, queue, compaction, multi-agent |
| Agent protocol | Generated Codex 0.150.1 TypeScript schema + JSON-RPC over application-owned stdio | Typed Gateway-to-App Server communication only |
| Authentication | Better Auth | Browser sessions and invitation-only identity |
| Business database | PostgreSQL 16 | Enterprise identity, RBAC, RLS, thread index, quotas, usage, deletion jobs |
| External data warehouse | PostgreSQL 16 + pgvector 0.8.6 | Independent request lineage, complete raw responses, normalized source data, vectors and curated business evidence |
| External search index | Elasticsearch 9.5.2 | Rebuildable BM25 search and aggregations populated through a PostgreSQL Outbox |
| Local retrieval models | Qwen3 Embedding 4B + Qwen3 Reranker 4B | Local 1024-dimensional semantic retrieval and cross-encoder relevance judgment |
| External tools | Native Harness tools, application-managed MCP and governed host tools | Native image generation, Web Search, governed JustOneAPI market data, future commerce systems |
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
Codex Harness business-level commerce_data plan/execute tools or external Commerce Pilot MCP client
  -> application authorization / approval / quota / audit / billing
  -> SHUEHO External Data MCP
  -> service-owned JustOneAPI REST client
  -> JustOneAPI REST API
  -> independent raw, normalized and business warehouse
```

Keyword product research is a bounded workflow inside that service, not an Agent loop. Harness first creates a free immutable plan using database market-language metadata; Commerce Pilot quotes the full call graph without reserving quota. Paid execution accepts only the plan id. The service runs discovery, selects a diversified quality-promoted representative set, materializes target-specific detail/price/review steps from SQL, and the Gateway applies authorization, approval and settlement separately to every actual paid request.

Inbound Commerce Pilot identities are never passed through as JustOneAPI credentials. See [External Data MCP And Governance](./external-data-mcp.md).

The browser never connects directly to App Server and never supplies `cwd`, provider identity, tool definitions, sandbox policy, developer instructions, Skill paths, host paths, Hook commands, or Enterprise scope headers.

## Sources Of Truth

| Concern | Authoritative source |
|---|---|
| Conversation messages and Turn state | Codex App Server paginated Turn/Item history; `turn/completed` is terminal authority |
| Creative project and its conversation | One persisted Codex thread indexed as `recipe_id=creative_project`; no parallel project chat store |
| Creative method catalog | Closed application registry that maps one business method id to one versioned specialist Skill; the browser never supplies a Skill path or body |
| Thread product selection | Newest product context set successfully bound to a Turn for the authenticated tenant/workspace/user/thread; only bounded canonical summaries are restored |
| Creative canvas source | Completed Codex `agentMessage` and native `imageGeneration` Items, bound by real thread, Turn and Item ids |
| Creative canvas editing state | Application-owned RLS tables for nodes, append-only revisions, layout, viewport and message references; native image bytes remain immutable Harness artifacts |
| Active Turn and queue | App Server read/queue APIs |
| Browser identity and Enterprise access | Better Auth + PostgreSQL RLS context |
| Cross-company/workspace isolation | Server-derived tenant/workspace principal + forced RLS + validated compound foreign keys + live RBAC |
| Thread ownership index | PostgreSQL `commerce_agent_thread`, including the immutable-at-start dynamic-tool contract version |
| Skill catalog | App Server `skills/list` for the application runtime root |
| Plugin availability | Application manifests + live Gateway/MCP/provider evidence |
| Company product master | Workspace-scoped Product/SPU and Variant/SKU revisions in the business PostgreSQL database |
| Product source truth and mapping evidence | Immutable product import/source rows, mapping revisions, field lineage, and review records |
| Tool permissions | Application runtime registry and server-owned policy |
| Usage | Exact provider/App Server usage events + idempotent PostgreSQL ledger |
| Audit, billing, and reply feedback | Transactional append-only PostgreSQL records under Enterprise RLS |
| Complete JustOneAPI request/response authority | Independent SQL-only `external_api_call_raw`; `commerce_external_data_archive` retains the governance receipt and warehouse ids |
| Marketplace market/language capability | Official `provider_market_option` enum intersected with immutable `provider_market_profile` revisions |
| Marketplace paid execution identity | Tenant/thread/Turn-bound `marketplace_research_plan` plus target-specific workflow step instances |
| Product-grounded research subject | Server-created context-set UUID plus the exact Product revision references and immutable snapshot SHA-256 fixed before `turn/start` |
| Product-insight method | Persisted Recipe id: `market_research`, `new_product_development`, or `product_retrospective`; the BFF and Gateway reject a mismatched method |
| Product-insight claims and receipts | One method-fixed Harness structured output backed by Product fact refs and safe `research_request_id` / `evidence_id` projections; raw provider records remain in the independent warehouse |
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

History selection loads the most recent 30 Turns through `thread/turns/list` and uses an opaque cursor for earlier pages. While work is active, the browser polls only thread metadata and one summary Turn; it never converts a local timeout or transport error into a Harness terminal state.

### Side-Effecting Commerce Tool

1. Agent proposes a structured action against a named external system and record.
2. Application authorization checks tenant, workspace, user, tool, and object scope.
3. Human approval is requested when required.
4. The application executes an idempotent write.
5. The same integration reads the changed object back.
6. UI distinguishes proposed, approved, written, and verified states.

No external write is complete merely because the model said it succeeded.

### Creative Space Project

1. Browser opens Creative Space and lists tenant-owned creative thread indexes.
2. Selecting a project reads the stored Codex thread and paginated Turns without resuming it.
3. The user chooses a business method such as listing copy, promotion copy, main image, gallery images, detail page, shooting script, or short-video storyboard. The browser submits only its closed method id.
4. A new or revised creative request starts a native Turn with the application-owned `commerce-creative-project` Skill plus the mapped specialist Skill Item. Product context and tenant-owned image attachments are separate server-validated native inputs.
5. App Server streams questions, commentary, tool calls, native image generation and final Items through the existing Gateway SSE path.
6. The center canvas reconciles completed delivery Items into document, image-layer, and table nodes. Harness history remains authoritative for the Agent result; application-owned RLS tables persist spatial layout, editable overlays and append-only user revisions.
7. Selecting an existing project reads its newest successfully bound product context through an authenticated `product_catalog.read` route. PostgreSQL RLS and explicit tenant/workspace/user/thread predicates restrict the response to at most twenty product summaries; raw imports, mappings, attributes, credentials, and connector configuration are not returned.
8. Later feedback starts another Turn in the same project thread. New completed Items add new nodes; manual edits create application revisions, and reply-to-node references preserve bidirectional navigation without rewriting Harness history.

Product visual identity is not inferred from a catalog URL. A main-image, gallery, or storyboard request needs a tenant-owned reference image or user attachment before the native `image_gen` flow may claim visual fidelity. Text-only product facts can still produce copy, scripts, page structure, or a clearly labelled conceptual image direction. Rendered video is unavailable: future video generation must be an application-owned asynchronous commerce tool with quote/approval, live RBAC, idempotency, audit, tenant artifact storage, and authoritative status/content readback rather than a fabricated Harness Item.

See [Creative Space Workbench](./creative-space-workbench.md).

### Product Catalog Context

1. A workspace operator starts the fixed Product Onboarding Harness workflow or uploads a bounded CSV/JSON file in the Product Library; connector/secret administration remains separately permissioned.
2. The application stores immutable source records first. A product-onboarding CSV/JSON attachment contributes only tenant/workspace/user/thread-bound metadata to model context, and its artifact import is held for Commerce approval.
3. The current Codex Harness Turn reads a deterministic schema profile and may propose only a closed-schema mapping. Mapping proposal and validation are persisted state writes, so both retain the original `item/tool/call` for Commerce approval, live review authorization, UUID idempotency, audit, and import readback.
4. Commerce Pilot validates and dry-runs the mapping; canonical publication is a separate approved, idempotent application write requiring review permission and Product/SKU readback.
5. The composer lists only canonical products the current workspace may read. The browser submits a context mode and canonical ids, never raw product JSON.
6. The BFF creates a server-owned context set before the native Turn. It pins exact Product revision references; the Gateway resolves only that owned snapshot and never accepts a browser-supplied context-set id.
7. Harness retrieves the bounded immutable revision facts through `commerce_product` only when product evidence materially improves the task. Mutable catalog status, source configuration and freshness fields are not part of the research snapshot projection.

See [Commerce Product Catalog](./product-catalog.md).

### Product Insight Skills

1. The user starts one fixed Recipe: market research, new-product development, or Product retrospective. The BFF derives its closed `insightMethod` from the persisted Recipe; a different method starts a different task.
2. Gateway starts one native Codex Turn with the `commerce-product-insight` orchestrator plus exactly one application-managed specialist Skill. The user's text remains unmodified, and the browser supplies no Skill path, instructions, schema, tools, or runtime policy.
3. When a selected Product is part of the decision, the specialist first calls `commerce_product.get_selected_product_context`. The Gateway will not create or execute a marketplace plan until the current Turn has read the exact server-fixed Product facts. Product retrospective is rejected at Turn admission unless at least one canonical Product is selected.
4. Harness forms a private baseline of confirmed facts, missing facts, candidate selling-point hypotheses and risk hypotheses. Provider-facing queries contain only the minimum public category, use-case, market and metric concepts; Product ids, revision ids, snapshot hashes, SKU/SPU, costs, inventory, supplier and connector data are never provider arguments.
5. Existing curated evidence is checked first. New marketplace collection uses the free immutable plan and then the paid `execute_marketplace_research(plan_id)` path. The plan and execution must carry the same first-party subject or fail closed before dispatch.
6. The external-data service reports product/content evidence and accepted review evidence separately. Product detail, price, sales and social content cannot be relabelled as buyer reviews; zero accepted review evidence requires an explicit limitation and forbids a confirmed pain-point claim.
7. The final Harness response uses one shared report schema whose `insightType` enum is fixed to the selected method. Every important claim is labelled `product_fact`, `market_signal`, `derived_comparison` or `hypothesis`, with the evidence lineage it actually uses. Recommendations include validation metrics and remain proposed work, never external-write receipts.
8. `companyEvidenceRefs` remains present but empty, and the current schema rejects `company_metric`, because no governed company operating-data tool is registered. Product retrospective therefore cannot claim sales, conversion, ROI, returns, profit, or operating root causes from public market evidence.
9. Existing `commerce-market-research` threads retain their workflow id, but future Turns receive the new orchestrator, market specialist, and shared schema. Historical message shapes remain a browser read-compatibility concern. No dynamic tool changed, so persisted tool-contract version `5` remains valid.

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
