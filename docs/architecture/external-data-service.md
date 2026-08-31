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

When a Harness Turn explicitly selects first-party catalog products, the control plane also supplies a minimal `first_party_subject` receipt: contract version `1`, an opaque subject UUID, a snapshot SHA-256 and one to twenty `product_id + product_revision_id` pairs. The service does not receive product descriptions, SKUs, costs, inventory or connector data through this receipt. Free planning pins the subject receipt into `business_intent`, coverage and plan-key version 4; paid execution must present the same subject hash and product revisions under the same tenant, workspace, user, thread and Turn or fail closed before dispatch.

Harness never searches this endpoint directory. `preflight_social_content_research` and `preflight_marketplace_product_research` receive business constraints plus the current workspace allowlist, then deterministically select only endpoints whose database request schemas satisfy the hard capability. Exact-window social discovery requires keyword/source/start/end fields; interaction-ranked discovery requires a platform endpoint with a declared high-interaction sort; marketplace research requires keyword, seller type, price filters and a database-declared default sort. A missing capability fails before reservation, approval or provider dispatch.

`JustOneApiRestClient` has no endpoint-specific URL branches. It receives one prepared transport request from the database contract, always injects the service-owned Token into the URL, supports GET query and POST query/form requests, preserves the Token-free request query/body/content type in the immutable raw row, and applies the common `code=0` billing result semantics. Provider date parameters declared as `yyyy-MM-dd HH:mm:ss` are deterministically normalized in `Asia/Shanghai` before validation.

`business_product` holds stable `platform + item_id` identity and first/last-seen state. `business_product_observation` retains query-specific price, sales bucket, shop and relevance at each observation time, so later searches never overwrite market history.

Every known provider field is normalized when a stable meaning exists. Every source row also retains its complete `raw_data` or `extra_map`; new or unknown provider fields therefore remain queryable without waiting for a migration. Non-JSON HTTP responses are still archived byte-for-byte and are only barred from normalization. Raw rows are never deleted because an AI model rejected them and do not reference Commerce Pilot conversation tables.

Generic commerce products normalize monetary values as `price_amount + currency`. `price_yuan` exists only when the source currency is CNY; foreign display prices are never relabeled as yuan. Provider display-price text, sales text, sales lower/upper bounds, qualifiers and image URLs remain attached to the same source record. Price-band output preserves the source currency and explicitly states that a provider display price is not a complete SKU-price catalog or a verified transaction price.

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

The service never sends a complete provider response to either model. Deterministic rules first reject explicit corruption. Remaining atomic records are limited to 4096 characters, embedded in batches of at most 64 and reranked in batches of at most 50. Each decision stores model ids, prompt version, input hash, lexical score, cosine score, reranker score, quality label, relevance label, confidence and reason codes.

For commerce-product responses, only product records with a bounded provider identifier become model candidates. Scalar presentation arrays such as `price_texts` remain fully retained in the source layer but do not consume model context or inflate rejection counts. Cross-market workflows preserve the user's original concept and validated localized variants. OpenCC expands simplified/Taiwan-traditional equivalents; other scripts are validated against the selected profile. Lexical matching takes the best score across original, localized and normalized terms before Embedding/Reranker judgment. Valid low-confidence evidence is held rather than mislabeled as irrelevant.

`ai_decision_review` supports SQL-only human corrections without mutating model history. `quality_evaluation_case`, `quality_evaluation_run` and `quality_evaluation_result` maintain repeatable simplified Chinese, Taiwan traditional, Thai, Indonesian and Singapore English cases across relevant, adjacent and cross-category evidence; `npm run external-data:evaluate` records model scores and fails below 90% accuracy.

Promotion requires valid source quality plus exact or model-supported target relevance. When a business intent declares a time range, missing, invalid or out-of-range publication times are deterministically rejected before embedding or reranking; those rows remain unchanged in the source layer. Records with zero provider coverage are held rather than promoted. A failed or unavailable model job leaves raw and normalized data intact, records the failed enrichment job, and fails closed without manufacturing a business result.

## Retrieval

Business search combines three independent signals:

1. Elasticsearch BM25 over promoted product/content text;
2. pgvector HNSW cosine search over promoted source entities;
3. Qwen3 Reranker over the fused top candidates.

MCP returns only bounded business evidence, derived metrics, coverage, exclusions, freshness and limitations. Social content promoted through `business_content_observation` is included alongside provider-neutral evidence, including only provider-reported normalized metrics; requested, available and missing metrics are explicit in `coverage`. It never exposes raw response rows. Price-band metrics preserve sample count, unweighted percentile method and confidence; sales metrics preserve exact, ranged and lower-bound qualifiers.

Workflow evidence exposes a stable `evidence_id` and research receipt plus kind, role, source URL, metrics, time, quality basis and confidence. Buyer-review coverage is reported separately as planned review calls, completed review calls and accepted review evidence. A workflow without a review step, or a completed review step with zero accepted evidence, carries an explicit limitation forbidding buyer-pain conclusions from product detail, sales or social-content signals.

## Reliability And Security

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

The command fails unless that exact stored request exists; it never falls through to `JustOneApiRestClient.call`.
