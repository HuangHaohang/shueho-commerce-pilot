# Commerce Product Catalog

## Product Outcome

Commerce Product Catalog is the workspace-owned first-party product master used by Commerce Pilot tasks. It is not the external marketplace research `business_product` store and it is not a copy of one source system.

The first product slice supports:

- real CSV and JSON product imports;
- immutable source receipts and source records;
- AI-assisted schema mapping through the current Codex Harness Turn;
- deterministic validation and publication into Product/SPU and Variant/SKU revisions;
- tenant-scoped product search and product detail reads;
- an explicit product context selector in the shared composer;
- application-owned Harness tools that retrieve bounded product context on demand.

Embedding and reranking are optional future indexes. Exact identifiers and PostgreSQL text search are sufficient for this slice, so local Qwen services are not a startup dependency.

## Domain Boundary

The canonical hierarchy is:

```text
Product / SPU
  -> Product revision
  -> Variant / SKU
       -> Variant revision
       -> Offer observations
       -> Inventory observations
```

Product content, price, and inventory do not share one mutable row. Product and Variant revisions are append-only. Offer and inventory observations are time-varying facts. Monetary values use decimal amounts plus ISO 4217 currency; a missing currency is held as an issue and is never guessed.

An external market item may be linked to a canonical product later, but it never becomes the canonical product identity automatically.

## Source And Import Layers

Every connector conforms to the same application contract while retaining its source semantics:

```text
Product source
  -> immutable import run / blob receipt
  -> immutable source records
  -> schema profile
  -> mapping revision
  -> validation / dry-run
  -> approved activation
  -> canonical revisions and field lineage
```

Source types in the current registry are file upload, REST API, read-only PostgreSQL, ERP, and PIM. Credentials are secret-manager references; tokens, passwords, connection strings, and raw credential material never enter product JSON, Harness tool arguments, Hook logs, or browser responses.

### Connector Contract

Connector variability is handled below the canonical product boundary. Every connector definition declares a stable adapter key/version, source kind, bounded public configuration schema, credential audience, capabilities, and operational status. A workspace source then references that definition plus a server-owned secret reference. Browser input cannot define executable adapter code, an arbitrary URL, SQL, network policy, credential value, or polling command.

- **File upload** accepts bounded CSV/JSON and is immediately available.
- **Managed API** uses an application/operator registered base URL and resource contract. The browser selects the definition and supplies business configuration only; generic arbitrary URLs are rejected to prevent SSRF.
- **Read-only PostgreSQL** resolves a server-owned secret reference and must prove a read-only transaction, target-table `SELECT`, absence of table write privileges, and a non-superuser/non-`BYPASSRLS` role before it can report ready. Identifiers come from a closed `schema + table` configuration and are quoted by the adapter; browser-provided hosts, ports, databases, connection strings, and SQL are never accepted. Non-loopback secrets must require TLS through `sslmode=require`, `verify-ca`, or `verify-full`.
- **ERP/PIM** uses a versioned application adapter. A definition without an installed/healthy adapter remains visible as unavailable and cannot claim that a connection or sync succeeded.

Connection testing and synchronization are application jobs, not Agent loops. Test results, last successful synchronization, schema hash, cursor/watermark, failure code, and readback counts are persisted under workspace RLS. A test never promotes product facts. A sync stores immutable source records first and then reuses the same Harness mapping, validation, approval, and canonical-publication pipeline as file imports.

The active connectors are bounded CSV/JSON upload and connection testing for an operator-provisioned read-only PostgreSQL secret. Managed REST, ERP, and PIM definitions remain visible but unavailable until their application adapters are installed; they never report a synthetic successful test. Synchronization is also explicitly unavailable in this slice. The importer rejects oversized files, excessive nesting/record counts, unsafe formulas, malformed encodings, and missing or conflicting UUID idempotency keys. Same-workspace content hashes reuse the authoritative existing batch instead of creating duplicate raw storage.

Public product APIs reject environment names and generic broker references. Source creation accepts only a server-issued `broker:psh_*` handle that is already registered to the authenticated tenant/workspace and exact connector version. The browser connector catalog omits handle values; a secure application handoff remains required before a browser administrator can submit one.

### Conversational Onboarding

A newly provisioned company may start product onboarding from an ordinary Codex Harness conversation without first selecting an existing product. Product-source and import-management tools are deliberately independent of composer product-context mode:

1. `list_connectors`, `list_sources`, and `list_imports` read the live workspace state and expose unavailable adapters or synchronization honestly.
2. A CSV/JSON document is uploaded through the tenant-owned thread attachment pipeline. For `commerce-product-onboarding`, the native Turn receives metadata only: artifact UUID, display name, MIME, byte count, and SHA-256. The CSV/JSON body is deliberately omitted from model context. Other non-onboarding document analysis retains the existing bounded extracted-content behavior. Harness passes only the artifact UUID and optional source label to `create_import_from_artifact`; host paths, raw rows, raw JSON, credentials, and mapping programs are forbidden model/tool inputs.
3. Gateway reopens that artifact from `ThreadArtifactStore`, requires the same thread/tenant/workspace/user and an existing Turn binding, verifies MIME, size, stored filename, and SHA-256, then holds the original App Server `item/tool/call` for an application `commerce/approval/*` decision.
4. After approval, live RBAC is checked again and Gateway sends the bytes only to the private authenticated Product Catalog multipart control route. The artifact UUID is the import-creation UUID idempotency key. A successful response is followed by authoritative `import_status` readback; an uncertain result is never retried automatically.
5. `create_source_draft` accepts only a registry connector key/version, its closed public configuration, and a pre-provisioned redacted secret reference. `test_source` is also held for approval because it may contact an external system. Both actions reauthorize, audit, use UUID idempotency, and read the workspace source state back. Source creation never implies connection success, and a connection test never implies synchronization.

The model must never ask a user to paste an environment-variable name, password, token, URL, DSN, database host/port, arbitrary SQL, or ERP credential into chat. Secret values are provisioned out of band; Harness may reference only a tenant/workspace-authorized `broker:psh_*` handle returned by the application secure handoff. Ordinary users can therefore discover the supported path conversationally while unsupported API/ERP/PIM adapters remain visibly unavailable instead of being simulated.

Product sources persist only opaque `broker:psh_*` handles. PostgreSQL binds each handle to the same tenant, workspace, connector key, and connector version before resolving a server-owned environment-secret name; another workspace cannot reuse or probe the handle. Browser source APIs return only a redacted hint and never the complete handle, environment name, or secret value. Connection tests reserve an idempotent running receipt, execute once, persist one terminal result with same-workspace audit lineage, and reject any later mutation.

Product import storage is governed before raw rows are written. The contract defaults to a 1 GiB tenant budget, a 512 MiB workspace budget, and 180-day retention. Admission uses a conservative `raw_storage_bytes` estimate derived from serialized rows, per-record overhead, and a minimum 4× file-size factor while holding a tenant advisory lock. Expired non-held payloads are scrubbed only by the tenant-pinned retention worker; row ids, source pointers, SHA-256 hashes, mapping lineage, canonical revisions, and audit evidence remain. A purged batch cannot be inspected, remapped, or published again.

## AI Mapping Contract

AI does not rewrite each row or write product facts directly. The application first derives a deterministic profile containing field names, types, null rates, cardinality, and a small bounded sample. The active Codex Harness Turn may then call Product Catalog tools to:

1. inspect an import profile;
2. propose a mapping to the closed canonical field catalog;
3. validate the mapping and run a deterministic dry-run;
4. request activation;
5. read the resulting import status and canonical records back.

Mapping fields use a closed transformation DSL such as `trim`, `nfkc`, `decimal`, `currency`, `unit`, and `enum_map`. JavaScript, SQL, JQ, arbitrary regular-expression programs, host paths, and network locations are rejected.

Low-confidence identity matches and all cross-source merges remain reviewable proposals. Title similarity alone never merges products. An activated mapping revision is immutable; changing it creates another revision.

`propose_mapping` and `validate_mapping` persist application state even though they do not publish canonical products. They retain the original App Server `item/tool/call`, pause on explicit `commerce/approval/*`, re-check live review permission in Gateway and Web immediately before writing, require workspace-scoped UUID idempotency keys, store approval and outcome audit evidence, and inspect the import for authoritative readback. A control-plane timeout is `unknown` and is never retried automatically.

Every Agent-initiated Product Catalog state write is application-owned. The original `item/tool/call` remains pending while Commerce Pilot emits `commerce/approval/requested`; the application never fabricates a Codex permission request or model question. Mapping proposal and validation use immutable per-operation UUID receipts and import readback. Activation additionally requires both import and review permission; cancellation or denial writes no canonical revision, and success requires an idempotent result followed by canonical Product/SKU readback.

## Harness Boundary

Codex App Server continues to own threads, Turns, Items, streaming, questions, interruption, recovery, and tool lifecycle. Product Catalog is exposed as an application-owned `commerce_product` namespace with bounded schemas:

- `list_connectors`
- `list_sources`
- `list_imports`
- `create_import_from_artifact`
- `create_source_draft`
- `test_source`
- `search_products`
- `get_product`
- `get_selected_product_context`
- `inspect_import`
- `propose_mapping`
- `validate_mapping`
- `activate_import`
- `import_status`

Dynamic tools are fixed at `thread/start`. Adding the namespace therefore increments the application tool-contract version; an old thread may still be read, but it must create a replacement task before executing Product Catalog tools.

Only product-fact reads (`search_products`, `get_product`, and `get_selected_product_context`) depend on composer product-context mode. Connector discovery, source management, import inspection/mapping/validation, and approved publication are management operations and remain callable in a new-company onboarding task with product context set to `none`.

The browser never submits raw product JSON, mapping code, tenant scope, tool schemas, context-set ids, or instructions. It submits only a context mode and at most twenty canonical product ids. The BFF authenticates the user, checks workspace ownership and `product_catalog.read`, creates an owned context set, and forwards only that server-created opaque id to the private Gateway. The internal Product Catalog route rechecks RBAC, runtime tenant pin, root thread and forced RLS before resolving the exact `product_revision_id` rows fixed by that set.

For product-grounded market research, the resolved subject is `{version: 1, subject_ref, snapshot_sha256, product_count, products[{product_id, product_revision_id}]}`. The hash covers only immutable Product and Variant revision facts. Mutable status, current source names, connector data and freshness timestamps are excluded from both the hash and the model projection. The market-research free plan and paid execution must present the same subject receipt; a mismatch fails before any provider dispatch. The receipt sent to the external-data service contains no product body, SKU, price, cost, inventory, supplier or credential data.

Auto mode does not inject the whole catalog into history. The model calls `search_products` with a bounded query only when product evidence can materially improve the task. Tool output includes canonical ids, revision ids, source freshness, and concise business fields, but never raw source rows.

## Composer And Product Workspace

The shared composer contains a `产品库` context selector after the access-policy control. It is a context selector rather than a second attachment button. The selector shares the existing mutually exclusive popover state with Add, Access, Skill, and Model controls.

The selected visual contract is:

- a compact anchored picker below the centered WorkComposer and above persistent conversation composers when space permits;
- search by title, SPU, or SKU;
- recent and selected views;
- compact product rows with source and freshness;
- at most twenty selected Product references;
- selected Product chips inside the composer, updated directly while the picker is open so removing the final product immediately returns the unsent Turn context to `auto`;
- no permanent right-side product panel;
- `管理产品库` opens the same-shell catalog workspace.
- the workspace reads its newest import through an authenticated, workspace-scoped BFF backed by `listProductImports` plus `inspectProductImport`, omits raw/sample values, and restores pending review or publish actions after navigation and refresh;
- pre-publication evidence is limited to real source record counts, field paths/types/presence, and issues unless a future deterministic inspection contract returns normalized Product/SKU preview rows.

The entry remains visible for empty, syncing, stale, source-error, and permission-denied states. Empty and denied states are never represented as a successful zero-result list. Mobile uses a bottom sheet and bounded chips without page-level horizontal overflow.

The Product Library workspace exposes the same lifecycle without requiring technical knowledge: choose a connection method, upload or configure it, analyze and validate, then publish. File upload is two-stage. `POST /api/products/imports` stores immutable source records and returns `ready_to_publish` or `needs_review`; it never writes canonical Product/SKU rows. A reviewer must explicitly call the activation endpoint, which rechecks both import and review permissions and returns canonical readback. `needs_review` links into the fixed `commerce-product-onboarding` Harness workflow with the import id rather than implementing a second browser mapping engine.

## Authorization And Isolation

Product Catalog is workspace-shared application data. Product facts do not inherit thread-owner isolation. Every table carries `tenant_id` and `workspace_id`, enables and forces PostgreSQL RLS, and uses scoped composite foreign keys.

Thread artifacts are stricter: an onboarding import may read only an artifact owned by the same tenant, workspace, user, and root thread, and it must already be bound to a Harness Turn. The private Web control route independently checks its Gateway credential and current Enterprise permission before parsing, records approval evidence without raw rows or credentials, then checks permission again immediately before the database write. Canonical publication requires both `product_catalog.import` and `product_catalog.review`; upload/import permission alone cannot publish products.

Permissions are independent:

- `product_catalog.read`
- `product_catalog.import`
- `product_catalog.review`
- `product_catalog.sources.manage`

The system `workspace_operator` role includes read and file-import permission so an ordinary workspace user can upload and analyze a bounded file. It does not include mapping review, canonical publication, or source/secret administration. Those remain with workspace owners or explicitly authorized reviewers/administrators.

Every BFF request resolves the Better Auth session and current Enterprise workspace. Every Gateway callback uses the internal service credential plus server-derived tenant, workspace, and user scope. Product reads, selected context resolution, mapping validation, activation, and readback all re-check live authorization.

Raw source records are not browser-downloadable and are not returned by ordinary Harness tools. Audit and outbox payloads store ids, counts, hashes, lifecycle metadata, and outcomes rather than product descriptions, credentials, or raw rows.

## Verification

Required checks include:

- cross-workspace products, imports, mappings, and selected contexts are invisible;
- scoped composite foreign keys reject cross-workspace relationships;
- source records and active mapping revisions cannot be updated or deleted;
- duplicate import and activation idempotency keys do not create duplicate revisions;
- duplicate mapping proposal and validation idempotency keys do not create duplicate mapping revisions, validation transitions, or outcome audit events;
- mapping validation rejects unknown targets and executable transforms;
- low-confidence or cross-source matches cannot auto-merge;
- Agent activation uses Commerce approval and verified readback;
- product onboarding sends only CSV/JSON artifact metadata to the model and maps attachment I/O failures to stable safe error codes without host paths;
- selected products are resolved by canonical ids and the revision references fixed for the admitted Turn;
- selected research products use the exact server-fixed revision snapshot, reject browser context-set ids, and fail closed before plan/execute until Harness has read that snapshot;
- product-grounded marketplace plan and execution reject a missing or mismatched subject hash/revision list before a provider call;
- the picker works in ready, empty, syncing, denied, and failure states at desktop and mobile widths.
