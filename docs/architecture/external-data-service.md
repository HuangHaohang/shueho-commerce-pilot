# SHUEHO External Data Service

## Boundary

SHUEHO External Data Service is an independent, internal data product. Commerce Pilot is its MCP client through Codex Harness. The service is the only component that owns the JustOneAPI REST credential, provider HTTP contracts, complete raw responses, endpoint normalizers, local retrieval models, curated business data, pgvector, and Elasticsearch synchronization.

```text
Commerce Pilot browser
  -> Next.js BFF
  -> private Gateway
  -> Codex App Server / Harness
  -> commerce_data dynamic tool
  -> Commerce Pilot approval, quota, audit and billing control plane
  -> SHUEHO External Data MCP
  -> JustOneAPI REST API
  -> PostgreSQL raw/source/business warehouse
  -> local Qwen3 embedding and reranking
  -> pgvector + Elasticsearch
  -> bounded curated MCP result
```

There is no second Agent loop. Codex Harness still owns the user-facing thread, Turn, tool call, approval pause, interruption and recovery lifecycle. The external-data service performs bounded collection, normalization, deterministic validation, model inference and retrieval jobs only.

## Storage Roles

PostgreSQL 16 plus pgvector 0.8.6 is the only source of truth. Elasticsearch 9.5.2 is a rebuildable BM25 index populated through a transactional Outbox. A failed Elasticsearch write never deletes or rewrites PostgreSQL data.

The database is divided into four persistent layers:

- request lineage: `research_request`, `external_query` and stable intent/query/page keys;
- raw authority: `external_api_call_raw`, including sanitized business parameters, exact response bytes, decoded text, parsed JSONB when valid, hashes, byte counts, provider identifiers and timestamps;
- source-normalized data: complete endpoint-specific snapshots, pages, items, brands, properties, property values, traces and generic social records;
- curated business data: products, brands, properties and social content promoted only after quality and relevance evaluation.

## Provider Catalog And Adapter

The provider catalog is database-driven. A one-shot importer reads the official Chinese sitemap, fetches every endpoint OpenAPI document, hashes the sitemap, each OpenAPI file and the normalized request contract, then joins that documentation snapshot to the latest immutable official pricing import. Each receipt stores the complete manifest, while immutable source-blob rows retain the exact Sitemap and OpenAPI text used by that receipt; neither can be updated or deleted, and the runtime role cannot read source blobs.

`provider_endpoint` stores the method, exact API path, request JSON Schema, query/form/path/header codec, pagination keys, response family, documentation URL, OpenAPI URL and hash, pricing/permission state, normalizer version and callable state. An endpoint is callable only when its current documentation is active and the current official price snapshot marks it allowed and priced. Documentation-only, unavailable and deprecated endpoints remain discoverable to operators but disabled.

`provider_market_option` is rebuilt from imported OpenAPI `site`, `country`, `region` and `market` enums and linked to the same immutable catalog receipt. `provider_market_profile_import_receipt` independently hashes the reviewed search-language artifact; each immutable `provider_market_profile` revision stores BCP-47 query locales, accepted languages/scripts, timezone, currency, localization policy, representative-sample bounds and quality thresholds. Runtime availability is the intersection of an official endpoint enum, active business workflow and enabled profile. A profile for a future market does not make that site callable until the official schema includes its code; an official enum without a profile is not operationally ready.

Harness first reads active keyword-product workflows through `list_marketplace_research_platforms`, then reads ready site choices and exact language metadata through `get_marketplace_options`. Skill text, Gateway code and frontend components contain no marketplace, site or country-to-language table. Separate idempotent operator jobs can update reviewed market profiles and workflow definitions from the latest already-imported official catalog without fetching or calling a provider endpoint.

`provider_business_workflow` and `provider_business_workflow_step` are the runtime source of truth for endpoint dependency chains. Each workflow import is hashed and linked to the immutable provider-catalog receipt. A workflow is active only when every referenced step endpoint is callable and its request bindings still match the imported OpenAPI schema. The current catalog contains bounded keyword-product workflows for JD, Taobao/Tmall, 1688, Amazon, Douyin E-commerce, TikTok Shop, Shopee and Xianyu; runtime code does not branch on REST paths.

For JD, the business workflow is keyword search -> quality-checked representative identifiers -> product detail -> price. Similar platform workflows use ASIN, product id, item id and shop id only as private target bindings. Discovery greedily selects a bounded representative sample by relevance plus title/shop diversity after deduplicating complete binding sets. `research_workflow_target` stores the immutable source row, target ordinal, selection score and binding snapshot; `research_workflow_binding_evidence` stores each exact source field and identifier hash. Every target-specific downstream step has its own approval, call id, archive and settlement.

New marketplace research is explicitly two-phase. Free planning validates business input, market profile, localization scripts, sample size, endpoint policy and workflow schemas, then persists a 30-minute `marketplace_research_plan` bound to tenant, user, thread, Turn, catalog receipt, workflow definition and market-profile SHA. The Commerce Pilot control plane quotes all planned step counts without reserving quota. Paid execution accepts only the plan UUID, rejects stale, expired, foreign or already-used plans, and cannot alter any pinned field.

Both planning and execution receipts return the persisted `market_context` JSON object. Workflows without a market profile store and return `{}`; the planner's internal `null` must never replace that object in the execution response. This keeps the immutable receipt valid for the Commerce Pilot client without weakening its validation or inventing market metadata.

When a Harness Turn explicitly selects first-party catalog products, the control plane also supplies a minimal `first_party_subject` receipt: contract version `1`, an opaque subject UUID, a snapshot SHA-256 and one to twenty `product_id + product_revision_id` pairs. The service does not receive product descriptions, SKUs, costs, inventory or connector data through this receipt. Free planning pins the subject receipt into `business_intent`, coverage and plan-key version 4; paid execution must present the same subject hash and product revisions under the same tenant, workspace, user, thread and Turn or fail closed before dispatch.

Harness never searches this endpoint directory. `preflight_social_content_research` and `preflight_marketplace_product_research` receive business constraints plus the current workspace allowlist, then deterministically select only endpoints whose database request schemas satisfy the hard capability. Exact-window social discovery requires keyword/source/start/end fields; interaction-ranked discovery requires a platform endpoint with a declared high-interaction sort; marketplace research requires keyword, seller type, price filters and a database-declared default sort. A missing capability fails before reservation, approval or provider dispatch.

`JustOneApiClient` has no endpoint-specific URL branches. It receives one prepared transport request from the database contract, always injects the service-owned Token into the URL, supports GET query and POST query/form requests, preserves the Token-free request query/body/content type in the immutable raw row, and applies the common `code=0` billing result semantics. Provider date parameters declared as `yyyy-MM-dd HH:mm:ss` are deterministically normalized in `Asia/Shanghai` before validation.

The unified provider client applies SQL-backed global/per-endpoint admission before reserving token quota. Explicit documented `301`/`302` rejections can be retried under the same immutable call, at most three attempts by default, with complete attempt archives, jittered backoff and shared endpoint cooldown honoring `Retry-After`. Each actual attempt consumes one conservative token unit. Uncertain transport/5xx outcomes, successes and permanent failures are never replayed. Expiring capacity leases and durable polling progress keep failures visible without weakening raw-call fencing; see [deployment controls](../deployment/justoneapi-tokens.md#bounded-retries-and-shared-admission).

`business_product` holds stable `platform + item_id` identity and first/last-seen state. `business_product_observation` retains query-specific price, sales bucket, shop and relevance at each observation time, so later searches never overwrite market history.

Every known provider field is normalized when a stable meaning exists. Every source row also retains its complete `raw_data` or `extra_map`; new or unknown provider fields therefore remain queryable without waiting for a migration. Non-JSON HTTP responses are still archived byte-for-byte and are only barred from normalization. Raw rows are never deleted because an AI model rejected them and do not reference Commerce Pilot conversation tables.

Generic commerce products normalize monetary values as `price_amount + currency`. `price_yuan` exists only when the source currency is CNY; foreign display prices are never relabeled as yuan. Provider display-price text, sales text, sales lower/upper bounds, qualifiers and image URLs remain attached to the same source record. Price-band output preserves the source currency and explicitly states that a provider display price is not a complete SKU-price catalog or a verified transaction price.

Enrichment revision `commerce-relevance-v4` separates source validity, research-scope relevance, metric eligibility and ranking. Scope comes from the immutable original request, target and validated language variants. There are no category-specific exclusion expressions: a broad target does not silently exclude adjacent subtypes. Descriptive product text is scored separately from its numeric metrics; the complete text retains its own retrieval vector. Admission requires both reranker and embedding support (with the existing profile-governed lexical allowance), never a weighted-score or exact-keyword shortcut. Valid unsupported records are held, not labeled irrelevant. A supported scope signal is not proof that all returned products form a homogeneous comparison cohort.

`evidence-assessment.ts` checks normalized price plus currency and validated sales intervals independently. Missing or invalid price does not invalidate the whole product. Reviews, arbitrary `volume`/`sold` keys, unreadable sales displays and null values cannot become sales evidence; explicit zero remains a value. Price-band and sales observations include only eligible fields. The original record, interval qualifier, source pointer and model decision remain traceable. Each append-only enrichment result stores the four-part assessment in its existing `model_metadata` JSONB; no schema migration or plan-identity change is required. Public evidence omits private thresholds, and uncalibrated `confidence` fields return null; legacy non-null SQL confidence columns use zero as a deprecated placeholder, never as a probability. The weighted score remains 25% lexical + 25% normalized embedding cosine + 50% reranker, solely for relevance ordering.

`coverage.analysisReadiness` distinguishes processing completion from requested metric coverage and records usable price/sales product counts. This service has no verified homogeneous cohort or comparable sales-period/measure contract, so it does not authorize sales rankings from search samples. Price distributions describe only the returned sample; downstream Harness analysis must establish like-for-like scope and metric semantics before a comparative conclusion. Reprocessing appends a new decision revision, keeps prior evidence for provenance, rebuilds derived metrics from the new job, and lets vector and index search return only observations authorized by the latest completed SQL enrichment job. Plan/workflow result reads also rebuild their bounded projection from current child evidence; persisted `compact_result` is an execution receipt, not an authoritative cache that can bypass a newer assessment. These reads preserve running/unknown states and never finalize or dispatch work.

Generic provider identities are accepted only from known scalar identifier keys and are bounded to 255 characters and 1024 UTF-8 bytes before entering indexed columns. Oversized concatenated filter values remain unchanged in `raw_data` but cannot become an entity identity. In `commerce_product` responses, an object with a direct product identifier is classified as a product before nested fields such as `commentData` are considered. Review counts remain review evidence and are never represented as sales.

Every non-specialized endpoint also passes through the generic source normalizer. It writes a snapshot, one row for every returned array, and one source record for every array item while retaining the complete JSON value and JSON pointer. Text-bearing records may enter local relevance scoring and the provider-neutral business evidence table; empty or non-text metric records remain in the source layer without consuming model context. Payload-shape adapters can strengthen normalization without hard-coding REST dispatch paths: the Douyin `content_list + attribute_datas` adapter extracts the nested content title, author, provider id, publication epoch, canonical video URL, views, likes, comments, shares and total interactions while retaining the complete source JSON. Specialized Taobao and cross-platform search normalizers continue to populate their stronger endpoint-specific contracts.

Workflow-dependent detail and price responses also populate `research_workflow_business_evidence`. Text-bearing rows require AI promotion; text-free numeric structures may enter this business table only through deterministic type/quality rules and an exact workflow-step lineage. This prevents a numeric price response from disappearing merely because it contains no prose, without treating arbitrary raw JSON as model-visible evidence.

When Taobao returns an item id but no product URL, the business layer constructs `https://item.taobao.com/item.htm?id=...`, stores the source name and records `url_derivation=constructed_from_platform_item_id`. It is never represented as a provider-returned field.

## Stable Identities

`intent_key` is SHA-256 over versioned structured research intent. `query_key` is SHA-256 over endpoint id, endpoint schema version and canonical business parameters, including `keyword`, `sort`, `tmall`, `top_n` and every active filter. Pagination controls are excluded from `query_key` and included in `page_key`.

Canonicalization applies NFKC, trims and collapses query whitespace, sorts object keys, materializes endpoint defaults, preserves array order, rejects unknown or credential-like parameters, and separates pagination from logical query identity. The original user request and original model-supplied parameter object are retained alongside the effective provider parameters.

## Taobao Contract

`/api/taobao/search-item-list/v1` is normalized into:

- `taobao_search_snapshot`;
- `taobao_search_page`;
- `taobao_search_item`;
- `taobao_search_brand`;
- `taobao_search_property`;
- `taobao_search_property_value`;
- `taobao_search_trace`.

All lists are mandatory. `brandList`, `propertyList` and every `valueList` member are inserted even when count is zero or the value is malformed. Values containing control characters, excessive length or catalog concatenation are marked `rejected` but remain unchanged in the source layer. Sales values such as `1000+` retain the display string, lower bound and open-ended qualifier instead of becoming a false exact number.

## AI Enrichment

The local inference process binds to loopback and exposes bounded authenticated endpoints only:

- `Qwen/Qwen3-Embedding-4B`, 1024 dimensions, for query/document embeddings;
- `Qwen/Qwen3-Reranker-4B` for cross-encoder relevance scoring.

Both model repositories are pinned to explicit Hugging Face commit revisions. Enrichment jobs, vectors and evaluation runs store `model@revision`, never an unversioned alias.

The service never sends a complete provider response to either model. Deterministic rules first reject explicit corruption. Remaining atomic records are limited to 4096 characters, embedded in batches of at most 64 and reranked in batches of at most 50. Each decision stores model ids, prompt version, input hash, lexical score, cosine score, reranker score, quality label, relevance signals, independent scope/metric assessments and reason codes.

For commerce-product responses, only product records with a bounded provider identifier become model candidates. Scalar presentation arrays such as `price_texts` remain fully retained in the source layer but do not consume model context or inflate rejection counts. Cross-market workflows preserve the user's original concept and validated localized variants. OpenCC expands simplified/Taiwan-traditional equivalents; other scripts are validated against the selected profile. Lexical matching takes the best score across original, localized and normalized terms before Embedding/Reranker judgment. Valid low-confidence evidence is held rather than mislabeled as irrelevant.

`ai_decision_review` supports SQL-only human corrections without mutating model history. `quality_evaluation_case`, `quality_evaluation_run` and `quality_evaluation_result` maintain repeatable simplified Chinese, Taiwan traditional, Thai, Indonesian and Singapore English cases across relevant, adjacent and cross-category evidence; `npm run external-data:evaluate` records model scores and fails below 90% accuracy.

Promotion requires valid source quality plus model-supported scope relevance. When a business intent declares a time range, missing, invalid or out-of-range publication times are deterministically rejected before embedding or reranking; those rows remain unchanged in the source layer. Records with zero provider coverage are held rather than promoted. A failed or unavailable model job leaves raw and normalized data intact, records the failed enrichment job, and fails closed without manufacturing a business result.

## Retrieval

Business search combines three independent signals:

1. Elasticsearch BM25 over promoted product/content text;
2. pgvector HNSW cosine search over promoted source entities;
3. Qwen3 Reranker over the fused top candidates.

MCP returns only bounded business evidence, derived metrics, coverage, exclusions, freshness and limitations. Social content promoted through `business_content_observation` is included alongside provider-neutral evidence, including only provider-reported normalized metrics; requested, available and missing metrics are explicit in `coverage`. It never exposes raw response rows. Price-band metrics preserve sample count, unweighted percentile method and uncalibrated-confidence status; sales metrics preserve exact, ranged and lower-bound qualifiers.

Workflow evidence exposes a stable `evidence_id` and research receipt plus kind, role, source URL, metrics, time, quality basis and confidence. Buyer-review coverage is reported separately as planned review calls, completed review calls and accepted review evidence. A workflow without a review step, or a completed review step with zero accepted evidence, carries an explicit limitation forbidding buyer-pain conclusions from product detail, sales or social-content signals.

## Reliability And Security

`JUSTONEAPI_PROXY_MODE=required` enables a server-owned subscription egress pool exclusively in `JustOneApiClient`. Immutable node/listener revisions provide per-request shuffled round-robin selection, TLS-only health probes, failure cooldown and recovery. CONNECT/TLS failover finishes before any paid HTTP bytes; post-dispatch errors preserve the existing non-replay contract. Missing/all-down pools fail closed. Safe aggregate health is independent of stored-evidence readiness. See [configuration, deployment and validation](../deployment/justoneapi-proxy.md).

- The paid REST call is dispatched at most once. A transport timeout after dispatch becomes `unknown` and is never retried automatically.
- Free plan creation is idempotent by Harness call id or public MCP idempotency key. A lost plan-execution response may read back only the execution bound to that same source call id; another caller cannot replay or take over an executing plan.
- PostgreSQL, Elasticsearch and both local models are warmed before the internal MCP listener accepts traffic. A known pre-dispatch model/configuration failure is non-billable; it is not misclassified as an uncertain provider result.
- After a restart, a call with a confirmed raw response resumes from the raw or normalized SQL layer without another provider request. A pre-response `dispatched` row remains unresolved and is never replayed automatically.
- `external-data:repair:research` is the explicit operator path for a failed normalization or enrichment stage. It requires an existing exact request identity and calls only `resumeStored`; it cannot create or dispatch a provider request.
- The REST Token is injected only into the in-memory query URL and is excluded from SQL, MCP payloads, logs and audit metadata.
- Every tenant table uses workspace-scoped PostgreSQL RLS. The MCP service accepts only a private bearer credential and loopback/explicit hosts.
- Elasticsearch documents contain curated business fields only, never raw responses, credentials or conversation bodies.
- `index_outbox` uses bounded claims, retry backoff, five-minute stale-claim recovery and a terminal attempt limit; the index can be rebuilt from PostgreSQL.
- Every business record links to the research request, source row, raw call and JSON pointer.
- `service_audit_event` is append-only and records redacted collection, normalization, enrichment, business-search reads and index outcomes; prompts, queries, parameters, responses, content and credentials are rejected from audit metadata.

## Local Operation

```bash
npm run external-data:infra:up
npm run external-data:migrate
npm run external-data:import-catalog
npm run external-data:import-market-profiles
npm run external-data:import-business-workflows
npm run external-data:models:sync
npm run external-data:models:download
npm run external-data:models
npm run external-data:dev
```

Local endpoints:

- PostgreSQL/pgvector: `127.0.0.1:55433`;
- Elasticsearch: `127.0.0.1:59200`;
- local Qwen3 model service: `127.0.0.1:8792`;
- SHUEHO external-data MCP: `127.0.0.1:8791/mcp`.

The final integration verification imports the existing paid Taobao archive instead of making another provider call:

```bash
npm run external-data:verify
npm run external-data:verify:catalog
```

It proves complete raw persistence, 10 item rows, 36 brand rows, 7 property rows, 89 property-value rows, corruption rejection, 1024-dimensional vectors, business promotion, Elasticsearch indexing and absence of phone/computer contamination in the promoted product set.

An operator can re-run only the local processing stage for a confirmed raw call:

```bash
npm run external-data:repair:research -- --research-request-id=<warehouse-research-uuid>
```

The command fails unless that exact stored request exists; it never falls through to `JustOneApiClient.call`.

## Complete provider capability access

The Codex Harness remains the agent runtime. Tool contract 6 adds a fixed four-tool capability family: `search_data_capabilities`, `get_data_capability`, free `plan_data_request`, and paid `execute_data_request(plan_id)`. The capability catalog is generated from every imported JustOneAPI endpoint, including disabled, unpriced and unavailable entries. Opaque capability IDs resolve only inside the independent data service; model-facing responses do not contain provider transport URLs or service credentials. Product, social, profile, metric, link and AI-answer capabilities are discoverable independently of specialized marketplace workflows.

Input schemas retain official parameter descriptions, including enum meanings and pagination dependencies. Fixed plans validate those schemas and pin the catalog plus selected market-profile revisions. Generic access cannot execute an unreviewed market option, bypass protected credential inputs, or change business inputs after planning. Normal product research continues to use the specialized marketplace plan, representative sampling and relevance/metric gates. Direct capability queries return a separate source-observation contract and cannot substitute those unverified fields for promoted product-comparison evidence.

Migration `035` adds tenant/workspace-RLS data plans and append-only field observations. Execution claims and transport-run claims are separately fenced. A repeated consumed plan reads the original request; only the original claimant may recover a lost free-claim response. The plan links its research request before provider admission, so polling exposes pending work without creating another call. Native Harness calls retain Commerce approval events, live authorization, reservation, dispatch and settlement; the public MCP uses the same controls and the existing priced enterprise policy. Each supplier request still uses the single JustOneAPI client with token quotas, scoped proxies, shared admission and bounded safe retries.

After the full source response and normalized lists are stored, direct data queries validate primitive fields, numeric precision, text quality and protected values into a separate observation table. These observations preserve source JSON pointers, explicit nulls and empty arrays; they are supplier outputs that may include AI-generated content, not independently verified facts. Credentials and invalid/unsafe fields remain excluded from the model projection. Query/result limits do not delete the complete raw source. `get_research_result` accepts a data plan ID and optional `field_offset`/`field_limit` for bounded read-only field pagination. AI answers are retained even when the target brand is absent, so a relevance score cannot erase a negative observation.

Catalog availability distinguishes registration, catalog state, pricing, provider permission, workspace permission and local token allowance. Local zero/unknown allowances are not a claim about the supplier account balance, and cannot be silently refilled by catalog synchronization. The model must explain the exact gap instead of claiming that a documented interface does not exist. Social popularity sorting also uses actual enum fields and explicitly preserves its provider-popularity semantics rather than claiming an exact interaction sum.

## Durable research tasks (contract 7, supersedes model-facing plans)

The Codex Harness still owns conversations, model tool flow, approvals and continuation. Research orchestration is a deterministic backend worker, not a second agent loop. Public MCP and new Harness tasks expose `submit_marketplace_research`, `submit_social_research`, `submit_data_request`, and `get_research_task(task_id)`. Submission persists immutable scope and a tenant/workspace/user-scoped idempotency key and returns immediately. The free-plan/separate-execute tools are removed from the model-facing registry. Existing scope/pricing receipts are internal implementation records; no client supplies a plan ID or confirms a free quote.

Migration 036 adds tenant/workspace RLS tasks, immutable operation checkpoints, and a narrowly granted worker claim function. A separate `research-worker` service claims queued/expired leases with SKIP LOCKED, renews 90-second leases every 20 seconds and runs at most two tasks concurrently per worker. Supplier concurrency is still governed globally by the shared provider admission ledger. Every checkpoint checks the current lease. Recovered workers replay completed checkpoint results and continue unstarted operations with stable call IDs; they never resend an ambiguous supplier or financial dispatch. If an original warehouse request is terminal, its result can complete the original checkpoint. Otherwise bounded background recovery ends in `reconciliation_required`, retaining the original identities for operator reconciliation. A lost checkpoint in an irreversible admission operation may conservatively require reconciliation even if the provider has not been called.

Live catalog/RBAC checks run on worker execution and each step, while existing reservation, policy, dispatch and settlement controls remain enforced. Native task origin thread/Turn metadata is propagated by the worker; provider credentials stay exclusively in the independent warehouse service. Tasks requiring an unavailable formal approval fail closed instead of fabricating a Harness request. Historical tasks are not automatically enqueued or replayed. Current readback accepts their original research IDs.

Social count projections now recognize valid nested note counts without changing source records. Coverage reports valid samples per field, including real zeroes, missing values and partial samples. Evidence-field availability is distinct from aggregate metrics and does not imply period increments or a full-platform ranking. Existing archived results acquire the corrected projection through normal result reads.

## Reliable research execution (contract 8)

Codex Harness continues to own agent reasoning, conversations, questions, approvals and tool continuation. The deterministic `research-service` owns business operations, independent of a live MCP server. Public MCP and Gateway adapt this service; the worker no longer constructs MCP servers or overrides their registered methods. Immutable task `execution_version` selects legacy sequence checkpoints for existing tasks and argument-addressed operation identities for new tasks. Historical receipts are facts, not reusable authority: the control service revalidates current role, original MCP token, provider price/permission, policy, reserved budget and approval immediately before a fresh supplier operation. Completed supplier results are read without resending. Uncertain results retain monetary reservations and use explicit outcome codes, never JSON string matching.

Migration 037 provides idempotent claim receipts (including empty claims), cancellation and approval state, operational queue health and append-only readback corrections for historical uncertain tasks. Cancellation fences subsequent steps; dispatched calls remain recorded and require settlement/readback. Task listing is owner-scoped and cursor-paginated. Queue admission is bounded to 100 nonterminal tasks per workspace. Queue health exposes queued/running counts, expired leases, oldest queued age, waiting approvals, reconciliation count and last worker poll age; a queue without a recent worker fails readiness.

New direct data tasks may specify `pagination.max_pages` (1–100). Only catalog-declared integer page parameters are traversed; cursor endpoints are explicitly rejected rather than guessed. Every page preserves its own immutable provider request, permission/budget checks and checkpoint. Traversal stops at provider end, the requested ceiling, or the first failed/uncertain page; partial request IDs remain readable. `get_research_records` returns validated whole records by research ID, or deduplicated records across one task by provider record ID. Without a provider ID, records are retained, not guessed duplicates. Complete raw records remain immutable in the private warehouse. Readback strips buyer/user identity fields, retains nulls, nesting, SKU labels, comment dates and provenance, and explicitly labels truncation and source observations. It never claims full history from a bounded page sample.

Approval-required tasks stay `waiting_approval` with the durable reservation receipt. A Gateway task read holds its actual `item/tool/call`, emits application `commerce/approval/*`, and resumes the same task after formal approval. Interrupted prompts leave the task waiting. External clients advertising form elicitation can approve through `elicitation/create` during a task read; clients without it receive the pending state. Model-authored arguments cannot approve a task. For MCP 2025-11-25, the adapter additionally advertises native task capabilities and `run_*` task-required tools, mapped to the same database queue; `tasks/get`, `tasks/list`, `tasks/cancel` and durable `tasks/result` operate on that queue. Older clients retain immediate `submit_*` tools. Native task TTL is explicitly unlimited and no process-local task store is authoritative. The evolving Tasks extension draft is not mixed into the negotiated 2025-11-25 protocol. Tool results expose output schemas, structured content and matching text content; transport/protocol errors remain distinct from failed task state.

## Delivery recovery and stable result snapshots (contract 9)

Codex Harness remains the agent runtime. Public Streamable HTTP now retains a real MCP Server/transport per initialized session, including negotiated client capabilities and pending elicitation requests. Every POST, GET and DELETE authenticates the caller again and binds the session to tenant/workspace/user/token identity. Idle sessions expire after 30 minutes with a 1,000-session ceiling; process replacement invalidates transport sessions, not durable research tasks. Clients reinitialize after session-not-found and read the original task. The Comate bridge reconnects enumerated reads only; submissions are not silently replayed. Stateful replicas require session affinity, or clients must reinitialize on a different replica. This is session transport state, not a replacement for Harness conversations.

Each page shares the parent task's lease/recovery control object. A positively identified admission failure before a fresh provider RPC persists `dispatch_phase=not_dispatched` and returns `PROVIDER_NOT_DISPATCHED`; it does not become an unknown provider charge. Failure after possible transmission retains the original conservative unknown behavior. Unknown exceptions are not assumed safe to replay.

Migration 038 adds an independent settlement outbox. Before a task can complete, its exact settlement intent must be persisted and bound to an owned reservation checkpoint. A separate worker retries the same payload and reservation with bounded exponential backoff, durable idempotent claims and lease fencing; after 20 failed attempts the row becomes `attention_required`. If the outbox write fails, the research task remains recoverable and never silently marks billing complete. Research completion and live settlement state are separate fields; queue health exposes settlement backlog, age and attention counts. A task cancellation cannot erase an already-created settlement intent. The outbox never recollects supplier data or assumes unknown charges may be refunded.

Validated source-field observations are materialized once into immutable record indexes. Task reads create immutable membership snapshots ordered by request creation and record ordinal, with provider-ID deduplication. `get_research_records(task_id)` returns `snapshot_id`; subsequent offset pages must send the same snapshot ID. New completed pages produce a new snapshot only when the caller explicitly reads without a snapshot ID. Old snapshots retain their membership and total. Single research-request records are indexed and page directly in SQL, without reparsing all fields on each request. These are derived delivery indexes, not replacements for raw archives. Snapshot and outbox rows retain tenant/workspace RLS and original source provenance.

## System hardening (contract 10)

The [failure acceptance matrix](research-failure-matrix.md) defines the combined tests, production readback and operating limits. New internal RPCs use independent MCP transports, including supplier execution, reads, heartbeats and compensation; closing one failed request cannot abort a sibling. Query retries retain their original identities, and supplier RPCs are never automatically resent.

Before a reservation RPC, its source/call identity is persisted in the immutable task operation context. Terminal cancellation/failure/reconciliation triggers enqueue budget-release intents transactionally, including reservations whose responses have not returned. Control migration 049 serializes a cancellation fence with reservation creation: a delayed reserve cannot allocate after the fence. Release updates only `reserved`; dispatched, succeeded and unknown calls keep their original settlement obligations. Warehouse migration 039 backfills safe release intents for identifiable terminal tasks, preserves historical waiting approvals, and grants no new supplier permissions.

Both workers back off to 30-second polls when idle and resume their normal cadence after finding work. New claims include fixed `issued_at`, rejected outside a ten-minute validity window; only timestamped operational claim receipts older than one day are cleaned hourly. This avoids turning an expired replay into a new claim. Legacy receipts without timestamps stay intact. The compatibility bridge advertises only elicitation capabilities actually declared by its downstream client and forwards both requests and responses; native task-required tools are omitted from the ordinary compatibility bridge's list.

Record reads expose opaque `next_cursor` values bound to source/task and snapshot membership, with offsets beyond 10,000 supported. Cursor ownership is still checked by the warehouse and cannot grant access. Legacy offsets remain supported within the integer range; task offsets require a snapshot. Harness contract 10 keeps all approval interactions under the Harness/application boundary.

### Record projection v2 and checkpoint recovery

Migration 040 adds independent append-only record index/manifest/snapshot tables. Fresh reads use v2; supplied old snapshot IDs continue reading v1. Generic rateId/id/itemId fields are not authoritative identity metadata, and null is never a record key. V2 identifies records by research request plus source collection/index, preserving all distinct source records; deduplication.cross_page_identity explicitly reports unverified_records_retained. Do not claim unique cross-page counts without validated endpoint/entity identity master data. Raw archives and source observations remain unchanged.

A lost control.dispatch reply is recoverable only by matching reservation ID, source call ID, endpoint and parameter hash against live governance, with normal operation/lease fencing. An already-dispatched financial receipt completes the internal checkpoint; reserved receipts may attempt the financial transition. Actual supplier checkpoints still recover stored results and are never resent after uncertainty. Unknown/mismatched/revoked receipts fail closed.

Native tasks/result handles input_required using real MCP elicitation with related-task metadata. The same business adapter serves ordinary tools, deduplicates concurrent readers within a session and reads persisted approved/denied state after reconnect. Resume requests must include approval_reservation_id and match the currently waiting step, preventing stale approvals from resuming a later step. Dismissing a form leaves the task waiting and does not repeatedly prompt during the same native result wait. No model question, Harness approval or agent loop is synthesized.

### End-to-end durable recovery (contract 11)

ResearchRecoveryRequiredError is an internal control-flow signal. Planning/execution wrappers must rethrow it and cannot cancel the original data plan or convert it to a business failure. A successful provider response whose checkpoint write fails is recovered from its original warehouse request, without recollection or premature unknown settlement. Internal taskOperation rejects isError or missing/false success receipts; HTTP 200 is not evidence of persistence. Task workers back off on infrastructure failures as well as empty queues.

Ordinary/native cancellation and Harness task-denial paths persist task cancellation first; the durable release outbox owns reserved-fund cleanup. Cross-session approval readers refresh task state after a competing decision; no new approval grants or custom agent loops are introduced. Native partial/error/cancelled results keep isError=true and cancelled results no longer expose stale APPROVAL_REQUIRED as their current error.

Migration 041 indexes recent task lookup. New list cursors use the PostgreSQL microsecond timestamp plus UUID, order newest first and remain tenant/user/thread scoped; legacy UUID cursors continue the old ordering until that page sequence finishes. Harness threads use tool contract 11 for the opaque string cursor schema.

### Intermediate result lifecycle

The shared research-lifecycle adapter covers the actual SQL created/collecting/normalizing/enriching/completed/failed/unknown states plus transport acknowledgements; tests compare it with the applied database constraint. Intermediate responses are never business failures and produce no settlement intent, including when raw provider work has finished but warehouse processing is ongoing. Reserved/dispatched budget remains held until an authoritative terminal result can be settled once.

An original RPC checkpoint may contain an intermediate acknowledgement. Recovery reads only the original plan/request/source-call identity and appends a separate .terminal checkpoint after completion; the original acknowledgement remains immutable. A pending-result read never dispatches the supplier. Unknown terminal results preserve uncertain settlement semantics.

Lease-fenced read_operation inspects a checkpoint without inserting one. New supplier steps revalidate governance before recording possible dispatch; transient CONTROL_UNAVAILABLE/5xx failures therefore remain safely recoverable, while explicit authorization/policy denials receive a permanent not-dispatched receipt. Existing started supplier checkpoints always recover stored results and never resend.

Migration 042 separates recovery_failures from claim attempts and adds processing_wait_started_at. The worker queues normal waits every 15 seconds without consuming its five-failure recovery budget. A wait lasting 15 minutes transitions to reconciliation_required with PROCESSING_WAIT_TIMEOUT; no automatic recollection or budget release of dispatched calls occurs. A completed terminal checkpoint ends that wait episode. Historical terminal tasks and old erroneous settlements are not automatically replayed or rewritten by this release.

### Deterministic governance refusals

A control-service 4xx refusal such as EXTERNAL_DATA_CALL_LIMIT must finish the durable task once with that error code and retain available partial results. Reservation-stage refusals carry providerDispatched=false for the current step. last_error_code is persisted for diagnosis; retrying a known exhausted monthly quota is not recovery.

Task settlement counts include only financial settlement deliveries; cancel_source/cancel_reservation deliveries appear separately as cleanup. Migration 043 supports append-only, owner-inserted failure resolutions backed by governance audit receipts. Its database proof trigger rejects resolutions if supplier operations, control dispatch or a matching warehouse request exist. Original terminal task rows are never rewritten or automatically restarted.

Control migration 050 allows monthly_call_limit=null while requiring a finite monthly count or amount cap. The API, UI, reservation/quote/live-revalidation paths and MCP control client preserve null. Provider Token endpoint quotas remain independent and unchanged.
