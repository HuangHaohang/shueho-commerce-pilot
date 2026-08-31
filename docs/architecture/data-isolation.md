# Enterprise Data Isolation And Security

Commerce Pilot is a multi-tenant e-commerce Agent built on OpenAI's open-source Codex App Server harness. Isolation is enforced below the model and below the browser UI. A prompt, product id, thread id, URL parameter, or tool argument is never an authorization boundary.

## Scope Hierarchy

```text
commercial organization
  -> one security/runtime tenant
       -> workspace (brand, store, team, or business unit)
            -> users, threads, artifacts, products, sources, operations
```

The browser selects neither `tenant_id` nor an arbitrary `workspace_id`. Better Auth resolves the signed-in user; the BFF resolves the active Enterprise tenant and workspace from server-owned membership state. `COMMERCE_RUNTIME_TENANT_ID` is mandatory in production and filters the BFF context itself, not only Gateway traffic; every internal Product Catalog callback repeats the same pin. Gateway traffic is service authenticated and receives the resolved scope rather than accepting scope fields from a model or browser.

## Defense In Depth

Every tenant or workspace data path must enforce all applicable layers:

1. **Authenticated BFF context** — the route resolves the current user, active contract, tenant membership, workspace membership, and explicit permission with deny precedence.
2. **Server-derived tool principal** — application-owned Harness tools bind the current root thread to the same tenant, workspace, and user. Tool arguments cannot replace that scope.
3. **Least-privilege database role** — the long-running Web process uses a non-superuser role without `BYPASSRLS`; migration credentials are restricted to one-shot jobs.
4. **Transaction-local database scope** — every scoped transaction sets tenant, workspace, user, and when applicable root-thread configuration locally and enables row security.
5. **Forced PostgreSQL RLS** — tenant/workspace tables enable and force RLS. Missing scope fails closed and returns no rows.
6. **Scoped relational integrity** — foreign keys include `tenant_id` and `workspace_id` where both records are workspace data. A globally unique UUID is not accepted as proof that two rows belong together.
7. **Application authorization at write time** — side-effecting operations re-check live RBAC immediately before dispatch.
8. **Approval, idempotency, audit, and readback** — governed writes retain approval evidence, use operation-specific idempotency, persist a bounded audit receipt, and read authoritative state back before reporting success.

RLS is mandatory but is not used as an excuse to omit API authorization, scoped foreign keys, or runtime isolation.

## Data Classes

### Global master data

Validated connector definitions, provider endpoint catalogs, and other application master data may be globally readable by the application role. The runtime role cannot insert, update, or delete these records. Changes arrive through immutable operator import receipts or migrations.

Better Auth's `user`, `session`, `account`, `verification`, and authentication rate-limit tables are also intentionally outside Enterprise RLS: they must resolve identity before an Enterprise tenant is known. They are not commerce business data and remain protected by Better Auth's lookup contracts, opaque session credentials, restricted database grants, and the BFF boundary. Enterprise membership and every post-authentication business record remain tenant scoped. This exception must not be copied to a new commerce table.

### Tenant and workspace business data

Products, variants, sources, imports, mappings, marketplace policies, usage, audit events, access tokens, approval receipts, feedback, user-input answers, and deletion jobs are tenant scoped. Business records that belong to a brand/store/team are workspace scoped as well.

A company in tenant A cannot read, link to, mutate, approve, export, or delete a record from tenant B. Two workspaces inside tenant A are also isolated unless an explicitly authorized tenant-level operation is designed to aggregate them.

### Thread and user artifacts

Codex threads are persisted with tenant, workspace, creator, and user ownership. Events, Turns, interruption, queue actions, approvals, attachments, generated images, and deletion operations re-check the owned thread. Thread artifact lookup additionally verifies tenant, workspace, user, root thread, request, and artifact id; host paths are never returned to the browser or model.

### External-data archive

The independent raw external-data warehouse has its own SQL-only access, retention, and legal-hold boundaries. A browser-visible normalized record never grants access to raw provider payloads. Commerce Pilot and the upstream provider credential remain separate audiences.

## Product Catalog Boundary

Product source records are immutable and retain field lineage. Canonical Product/SPU and Variant/SKU revisions carry tenant and workspace scope, and every source binding, mapping field, issue, context set, activation receipt, and operation receipt uses scoped relationships.

Harness sees only bounded profiles, reviewed mapping evidence, canonical ids, and readback counts. Source samples are treated as untrusted data. Passwords, Tokens, DSNs, arbitrary URLs, SQL, and raw connection strings are never product-tool arguments or conversation content; connectors use a closed public configuration and an opaque server-owned secret reference.

File ingestion and source synchronization create immutable raw records first. AI may propose a closed declarative mapping, but deterministic validation and explicit publication are separate stages. Low-confidence identity and cross-source merge proposals remain held for review. Import admission enforces tenant/workspace byte budgets from a conservative serialized-storage estimate, reuses duplicate content hashes, and assigns a contract retention deadline. Tenant-pinned cleanup may scrub only expired, non-held payload values while retaining their hashes, lineage, canonical revisions, and audit receipt.

## New Table Checklist

Before a new commerce table is accepted:

- classify it as global master, tenant, workspace, user, or thread data;
- use `tenant_id NOT NULL` for tenant data and `workspace_id NOT NULL` for workspace data;
- add scoped unique keys required by composite foreign keys;
- use composite foreign keys for every tenant/workspace relationship;
- enable and force RLS;
- create policies that fail closed when scope is absent;
- grant only required operations to the application role;
- prohibit mutable cross-scope identifiers in browser or model contracts;
- add cross-tenant and cross-workspace read/write/delete tests;
- add the table to the dynamic isolation verifier.

Legacy `tenant_id IS NULL` compatibility branches are prohibited for persisted commerce data. A migration that cannot prove and validate its scoped foreign keys is incomplete.

## Verification Contract

`enterprise:verify-isolation` is required after isolation, migration, or business-data changes. It verifies:

- the application role is neither superuser nor `BYPASSRLS`;
- unscoped access returns no tenant rows;
- tenant A cannot observe tenant B;
- workspace A1 cannot observe workspace A2 unless a documented tenant-wide path is used;
- scoped composite foreign keys reject cross-scope relationships;
- tenant tables have RLS enabled, forced, and backed by policies;
- product, external-data, feedback, user-input, deletion, approval, and artifact-related records preserve their scopes;
- privileged claim/worker functions require an explicit tenant and cannot claim legacy NULL-tenant jobs.

Frontend and API tests remain necessary. Database verification cannot prove that a route chose the correct permission or that sensitive content is absent from a browser response.

## Production Requirements

Production App Server runs as a non-root process inside a container or equivalent OS boundary with only tenant-dedicated runtime volumes. Gateway is internal infrastructure and requires service authentication. Secrets come from a managed secret system, database/storage encryption and backup isolation are operator responsibilities, and production logs must exclude prompts, tool arguments/results, credentials, raw customer data, and unnecessary PII.

Application tool filtering is mandatory but is not a substitute for OS isolation, network policy, secret management, encrypted storage, retention controls, monitoring, incident response, and tested backup restoration.
