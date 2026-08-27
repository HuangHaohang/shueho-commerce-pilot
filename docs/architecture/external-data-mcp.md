# External Data MCP And Governance

## Purpose

Commerce Pilot integrates the independent SHUEHO External Data Service for market research and exposes a separate Commerce Pilot MCP surface to authorized customers. JustOneAPI is an upstream REST provider owned only by that service.

The system has two different MCP roles:

```text
Commerce Pilot Web user
  -> Next.js BFF
  -> private Gateway
  -> Codex App Server / Harness
  -> commerce_data host tools
  -> Commerce external-data control plane
  -> SHUEHO External Data MCP client
  -> SHUEHO raw/normalized/business warehouse
  -> JustOneAPI REST API

External customer MCP client
  -> Commerce Pilot public Streamable HTTP MCP server
  -> Commerce MCP access-token authentication
  -> the same external-data control plane
  -> SHUEHO External Data MCP client
  -> JustOneAPI REST API and SHUEHO warehouse
```

The customer and Commerce Pilot Gateway never receive the JustOneAPI Token. Inbound Commerce Pilot credentials, the internal SHUEHO MCP credential and the outbound JustOneAPI REST credential are different audiences and are never passed through.

## Harness Ownership

The browser Agent remains a Codex Harness application. App Server owns the thread, Turn, streaming, interruption, model-originated `request_user_input`, and the complete `item/tool/call` lifecycle. Commerce Pilot implements the client-hosted dynamic-tool adapter, authorization, billing reservation, business approval and audit, then calls the internal SHUEHO MCP. When approval is required, the original App Server dynamic-tool request remains pending; Commerce Pilot does not synthesize a Harness `request_user_input` event.

There is no custom Agent loop. New and resumed threads receive the `commerce_data` namespace through App Server `dynamicTools`:

- `search_business_data` performs free, read-only hybrid retrieval over previously curated workspace evidence;
- `list_marketplace_research_platforms` lists only platforms backed by a complete active database workflow;
- `get_marketplace_options` reads current database-backed market/site choices without a provider call;
- `get_research_result` reloads one curated result by the id returned from a prior collection;
- `research_social_content` accepts a public platform, keyword, inclusive Shanghai dates, one business objective and required interaction metrics;
- `research_marketplace_products` accepts marketplace product filters and required price, sales, brand or property metrics.

`research_marketplace_products` is a composed business contract. Before the Agent proposes a platform question, it must read `list_marketplace_research_platforms` and use only the exact returned ids and labels. Gateway records that directory for the current Turn and rejects `get_marketplace_options` or `research_marketplace_products` when the directory was not read or the platform is absent. The model then supplies a catalog marketplace id, keyword, optional country/site market code, seller and price filters, requested metrics and result limit. It never supplies provider identifiers. The private service selects a versioned SQL workflow, performs search first, resolves identifiers only from quality-promoted search rows, and then materializes the bounded detail/price/review steps. With `always_ask`, each actual provider request produces its own approval prompt; one Harness tool call may therefore pause more than once.

Provider endpoint ids, REST paths, raw parameter names, provider sort tokens and endpoint schemas are never model-facing inputs. The managed market-research Skill chooses only a business tool and business constraints, and forbids shell, host files, arbitrary network calls, browser automation and unmanaged MCP. The SHUEHO service applies the workspace endpoint/platform intersection, performs a deterministic no-charge preflight from database OpenAPI contracts, and returns the exact endpoint and normalized parameters only to the Gateway control plane.

For social research, `latest_content` requires an endpoint whose database request schema supports keyword, source and exact start/end values. `interaction_ranked` requires a platform endpoint whose schema exposes high-interaction ordering; the warehouse then rejects missing or out-of-range publication times before AI enrichment. If no allowed endpoint satisfies the hard business capability, preflight returns `CAPABILITY_UNAVAILABLE` before reservation, approval or provider dispatch. A combined latest-plus-interaction report requires two separately governed business calls because neither capability may silently stand in for the other.

Commerce Pilot follows the App Server dynamic-tool failure contract instead of rewriting model arguments. A business-contract or capability failure returns `success: false` with an exact code, message and corrective instruction in `contentItems`; Harness records the `dynamicToolCall` as failed and exposes that output to the model. The host must never silently relax dates or metrics, inject a provider endpoint, substitute Web Search after a governed call fails, or convert a failure into success. A dispatched, completed or uncertain paid research call remains non-retryable.

This contract follows the [official App Server dynamic-tool lifecycle](https://developers.openai.com/codex/app-server/) and the pinned Codex [`DynamicToolHandler`](https://github.com/openai/codex/blob/rust-v0.149.0/codex-rs/core/src/tools/handlers/dynamic.rs), where returned content and `success` become the model-visible function output and the authoritative completed/failed item state.

The user does not have to mention JustOneAPI, an endpoint id, or a tool in the prompt. The Harness decides from the business objective whether governed external data would materially improve the answer and which business evidence objective is required. It must not spend money merely because a tool is available. Once the Harness chooses a paid business research tool, Commerce Pilot applies the selected approval mode below while the original `item/tool/call` remains pending.

## Internal Service Contract

The Gateway connects only to the private SHUEHO Streamable HTTP MCP endpoint:

```text
http://127.0.0.1:8791/mcp
Authorization: Bearer ${EXTERNAL_DATA_SERVICE_MCP_TOKEN}
```

Production uses private TLS networking. The internal token is injected through the deployment secret manager and is distinct from the JustOneAPI REST Token. Neither token is written to Codex config, PostgreSQL, logs, audit metadata, browser responses, or customer MCP Token records.

`ExternalDataServiceMcpClient` verifies these tools:

- `list_platforms`
- `list_marketplace_research_platforms`
- `get_marketplace_options`
- `search_endpoints`
- `get_endpoint_schema`
- `preflight_social_content_research`
- `preflight_marketplace_product_research`
- `begin_marketplace_product_research`
- `resolve_marketplace_product_bindings`
- `complete_marketplace_product_research`
- `cancel_marketplace_product_research`
- `preflight_endpoint`
- `call_endpoint`
- `get_research_result`
- `search_business_data`

The directory, workflow lifecycle, binding and `call_endpoint` tools are private control-plane contracts between Gateway and SHUEHO; they are not registered with Codex Harness or the public Commerce Pilot MCP. Read-only preflight may reconnect once after a transport failure. `call_endpoint` is never retried automatically because a result timeout can be ambiguous after a paid REST dispatch. Every workflow step uses a distinct source call id, reservation, approval, raw row and settlement. The SHUEHO service persists the complete provider response before normalization and returns a compact result bounded to one MiB by default. See [SHUEHO External Data Service](./external-data-service.md).

## Approval Modes

The composer exposes three application-defined modes:

| Mode | Meaning | Server behavior |
|---|---|---|
| `always_ask` | Ask before each paid external call | Holds the App Server tool call until an application approval is answered |
| `task` | User preauthorizes the current task | Dispatches without another per-call prompt when workspace maximum automation permits task grants; resets to `always_ask` when leaving or starting another task |
| `policy` | Follow enterprise automation policy | Requires enterprise policy mode, an active official/provider or workspace price, and a per-call price at or below the configured ceiling |

Every mode still enforces user RBAC, workspace status, platform and endpoint allowlists, monthly call limit, monetary budget, and vendor availability. None grants computer control, host filesystem access, arbitrary internet access, or unregistered tools.

When a workspace configures a monetary budget, every callable endpoint must have an active official provider price or a workspace rate-card override. An unpriced endpoint is rejected rather than allowed to bypass the configured spend ceiling. Workspaces without a monetary budget may still explicitly approve an unpriced call, which remains visible as an operational exception.

## Persistence

Commerce Pilot governance migrations `018` through `025` and `027` through `031` add:

- `commerce_external_data_policy`: workspace enablement, maximum approval mode, allowed platforms/endpoints, monthly call/spend limits, per-Turn call cap, auto-approval price ceiling, and metadata retention;
- `commerce_external_data_rate_card`: effective endpoint vendor cost and customer price;
- `commerce_external_data_call`: immutable call identity, approval, dispatch, settlement, price and upstream business status;
- `commerce_mcp_access_token`: user-owned, workspace-bound, hashed external MCP credentials;
- `commerce_authenticate_mcp_access_token`: security-definer digest authentication with live tenant, membership, contract and RBAC checks.
- `commerce_purge_external_data_calls`: tenant-pinned retention batches that preserve unresolved calls and rows under legal hold.
- `commerce_external_provider_import`: immutable JustOneAPI pricing-import receipts with source filename, SHA-256, export time, filter, currency and row counts;
- `commerce_external_provider_endpoint`: the active data-driven provider catalog containing API path, MCP `endpoint_id`, platform, permission and official per-request price.
- `commerce_external_data_archive`: SQL-only approval/billing receipt and opaque warehouse lineage ids; legacy rows retain their previous complete MCP response;
- `commerce_external_data_search_v1_archive`: SQL-only projection of stable `/api/search/v1` request and response-envelope fields.

The independent service migrations add the complete raw authority, endpoint-specific normalized tables, quality issues, local-AI decisions, 1024-dimensional pgvector records, curated business observations, research metrics and Elasticsearch Outbox documented in [SHUEHO External Data Service](./external-data-service.md).

Independent migrations `015` and `016` add immutable workflow-definition receipts, current workflow/step rows, tenant-scoped workflow executions, per-step research links, SQL-only identifier-binding evidence and curated structured workflow evidence. A conversation deletion cannot cascade into any of these warehouse rows.

## Official Pricing Imports

Provider platforms and official unit prices are database master data, not application constants. Import a complete Dashboard export with:

```bash
npm run enterprise:import-justoneapi-pricing -- \
  --file=/absolute/path/justoneapi-pricing.xlsx \
  --actor-email=owner@example.com
```

The importer requires the `Just One API` and `定价` sheets, an all-endpoints/no-search export, exact `平台 / API / 单价 / 权限` headers, a declared row count, CNY, and unique API paths. It records `允许` as callable and `未开通` as unavailable; unavailable `N/A` prices remain null and can never become an effective rate. A source SHA-256 can be imported only once. A newer complete snapshot updates present rows and deactivates rows absent from that export while preserving the import receipt.

The endpoint identity is derived deterministically from the official REST path and is checked against the provider catalog during integration verification. At call admission, an active workspace override in `commerce_external_data_rate_card` wins; otherwise the current official provider price is used for both vendor cost and default customer price. Enterprise settings read platform choices and official prices from these tables. Future pricing updates therefore require an Excel import, not a code change.

Tenant policy, rate-card, token, and call-ledger tables use forced PostgreSQL RLS. The global provider import/catalog tables contain only public supplier metadata, revoke public access, grant the runtime role read-only access, and accept writes only from the migration/operator credential. Token lookup receives a SHA-256 digest and prefix, not the bearer secret. Effective token scopes are the intersection of token scopes and current RBAC permissions with explicit-deny precedence.

## Billing State Machine

Paid calls use this sequence:

```text
reserved -> approved/not_required -> dispatched
  -> succeeded
  -> business_failed
  -> unknown

reserved -> cancelled
```

`dispatch` is an atomic compare-and-set and cannot be repeated. Only `succeeded` rows contribute customer and vendor monetary totals. `business_failed` is retained for audit but clears monetary amounts. `unknown` remains visible for reconciliation and blocks automatic replay.

The approval HTTP response returns immediately while Gateway continues the original Harness dynamic-tool request. The approval decision is retained in the approval, audit and billing control plane, but it is not written to the user-message display index and is not injected into model history. Only answers to native App Server `item/tool/requestUserInput` questions receive a user-visible answer summary. A Gateway restart after reservation or dispatch never replays the upstream call: the durable ledger remains `reserved`, `dispatched`, or `unknown` for operator reconciliation, while the interrupted Harness Turn may be resumed only through a new user-authorized request.

The MCP discovery catalog does not provide a contractual unit price. Commerce Pilot therefore reads official unit prices from the latest validated Dashboard Excel import, with workspace rate-card rows reserved for customer-pricing overrides. A call without either price source is `unpriced`; monetary-budget policies reject it rather than allowing a budget bypass.

## Public Commerce Pilot MCP

Run the separate listener with:

```bash
npm run dev:mcp
```

Default endpoint:

```text
http://127.0.0.1:8790/mcp
```

Production publishes this listener only behind TLS and a dedicated ingress. Port `8787` remains a private Gateway port. The public server accepts Commerce Pilot MCP Access Tokens created in Enterprise settings and exposes only the scopes still granted to the token owner.

`COMMERCE_PUBLIC_MCP_ALLOWED_HOSTS` is mandatory in production and protects the listener from unexpected Host routing. Browser-originated requests are rejected unless their exact Origin appears in `COMMERCE_PUBLIC_MCP_ALLOWED_ORIGINS`; ordinary server-side MCP clients usually send no Origin. Authentication is limited through the persistent Enterprise rate-limit bucket before any tool request is accepted.

The first release uses high-entropy bearer access tokens rather than claiming OAuth compatibility. ChatGPT web plugin publication requires a standards-compliant OAuth protected-resource and authorization-server deployment in a later reviewed change. Codex, Cursor, and other clients that support bearer-token Streamable HTTP can use the current endpoint.

The public MCP exposes the same `research_social_content` and `research_marketplace_products` business contracts, never raw endpoint selection. Calls with `external_data.call` request policy automation. If workspace policy requires human approval, the tool returns `APPROVAL_REQUIRED` and does not dispatch upstream. Human approval remains available through the Commerce Pilot web Harness flow.

## Audit And Data Minimization

Audit events record action, tenant/workspace/user, endpoint id, platform, source, call id, parameter keys, pricing state, business code, result size and outcome. They do not record:

- prompt or conversation bodies;
- full query parameters or upstream results;
- Commerce Pilot or JustOneAPI credentials;
- raw customer personal information.

Complete business request parameters, exact REST response text and parsed JSON are persisted in the independent service's `external_api_call_raw`. This raw authority is intentionally SQL-only: there is no browser component, BFF read route, download route, public MCP read tool or Enterprise product permission for it. Service credentials are never included. Each row includes SHA-256 hashes, byte counts, provider request/record times, source-call identity, tenant/workspace/user ownership and original thread/Turn ids as non-foreign-key provenance labels.

The independent warehouse does not reference `commerce_agent_thread`, so permanent conversation deletion does not delete or mutate research requests, raw calls, normalized rows or business evidence. `retention_until=NULL` means permanent until an authorized SQL operator acts; `legal_hold=true` blocks retention. The Commerce Pilot call ledger and governance receipt can expire without deleting warehouse rows.

The official `/api/search/v1` response schema leaves `data` untyped, so its raw JSON remains authoritative while stable item fields are projected into `social_search_item`. SQL operators can query the independent raw table; no MCP tool exposes it:

```sql
SELECT endpoint_id, request_params, response_payload,
       provider_request_id, provider_recorded_at, completed_at
FROM external_api_call_raw
WHERE tenant_id = '<tenant-uuid>'
ORDER BY completed_at DESC;
```

`npm run jobs:external-data-retention` continues to govern Commerce Pilot receipts and billing rows. Independent warehouse retention is operated separately and must never infer deletion from a conversation event.

## Production Gates

Do not accept paid customer traffic until all of these are complete:

1. JustOneAPI confirms in writing that the intended multi-tenant SaaS proxy, customer charging, and result redistribution are permitted.
2. A current official pricing import, any required customer-pricing overrides, and a vendor-usage reconciliation process exist.
3. The actual operating entity and privacy contacts are configured and customer contracts describe the external data service.
4. JustOneAPI API-processing region, retention, subprocessors, security controls, and personal-information terms are documented in a DPA or equivalent written agreement.
5. TLS, ingress limits, MCP Token rotation/revocation, monitoring and incident response are operational.
6. Migration, forced-RLS isolation, mock MCP contract tests, browser approval UI and unknown-result reconciliation pass.

Technical implementation and legal text are controls and disclosures, not a legal opinion or proof that every regulatory obligation has been completed.
