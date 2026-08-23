# Enterprise Tenancy Foundation

## Product Position

Commerce Pilot is an Enterprise-only B2B product. It does not implement Free, Plus, or Pro plans. A prospective customer enters through the public Enterprise page and contacts Sales; an activated customer is provisioned as an organization with a one-to-one isolation tenant and at least one workspace.

The current Sales contact surface is intentionally not connected to a CRM or email sender, so it must not claim that a lead was delivered. Production sales intake still needs an approved destination, consent/privacy handling, abuse protection, delivery monitoring, and a human ownership process.

The product model is:

```text
customer company
└── organization (commercial identity)
    └── tenant (security, contract, runtime, and data boundary)
        └── one or more workspaces
            └── members, groups, roles, threads, and usage
```

- An **organization** is the customer company's commercial identity: its name, slug, lifecycle, and future sales/control-plane relationship.
- A **tenant** is that organization's security, contract, seat, administration, audit, runtime, and primary data-isolation boundary.
- A **workspace** is a resource and operating boundary inside one tenant. It can separate teams, brands, stores, regions, or business units, but it is not a substitute for tenant isolation.
- A **user** is a global Commerce Pilot identity. Access exists only through an active tenant membership and an active workspace membership.
- A **Codex runtime** is tenant-dedicated in production. It is not shared across customer companies.

`commerce_organization` and `commerce_tenant` are distinct records but are deliberately one-to-one in the current schema: `commerce_tenant.organization_id` is required and unique. This separates commercial identity from the runtime/data boundary without allowing either record to drift into a different customer. Supporting a holding company, reseller, or partner above several isolated tenants would require an explicit future control-plane relationship and migration; it must not be implemented by weakening tenant isolation.

This model is informed by OpenAI's documented Enterprise workspace, roles, groups, governance, and project concepts. It is a Commerce Pilot design, not a claim that it reproduces OpenAI's private implementation, billing rules, or internal data model. Relevant public references are listed at the end of this document.

## Implemented Data Model

The current Enterprise schema is migrations `001` through `011`. Versioned migrations are applied by `npm run auth:migrate` under a PostgreSQL advisory lock:

- `001` creates the tenant/workspace/RBAC/contract/thread/usage/lease/audit foundation;
- `002` separates organization from tenant and adds tenant-wide admission scope;
- `003` makes invitation role keys unambiguous and adds idempotent turn completion records;
- `004` attributes provider usage to Harness, MCP, Web Search, or image sources;
- `005` forces RLS across the Enterprise control plane and grants a least-privilege application role;
- `006` distinguishes reported usage from missing provider usage and hardens tenant-wide invitation management;
- `007` adds per-turn token reservations and the Codex agent-thread cap to contracts;
- `008` enables hardened tenant-wide administration and validates role-assignment scope in PostgreSQL.
- `009` adds database-backed per-user API buckets for thread, turn, queue, compaction, invitation, workspace, and membership mutation limits.
- `010` aligns built-in read-only role promises with implemented surfaces and assigns finite default monthly contract limits.
- `011` adds audited missing-usage reconciliation fields and removes tenant-only promises from the workspace-owner role.

| Area | Primary records | Boundary |
| --- | --- | --- |
| Company identity | `commerce_organization` | Commercial name, slug, and lifecycle |
| Isolation tenant | `commerce_tenant` | One-to-one organization security and Enterprise boundary |
| Operating space | `commerce_workspace` | Tenant-owned resource namespace |
| Access | tenant/workspace memberships | Active user access and default selection |
| Authorization | roles, direct assignments, groups, group assignments | Tenant or workspace scope |
| Commercial terms | `commerce_enterprise_contract` | Seats, workspaces, monthly limits, concurrency |
| Runtime placement | `commerce_tenant_runtime` | Dedicated runtime identity and readiness |
| Conversations | `commerce_agent_thread` | Tenant, workspace, creator, visibility |
| Metering | `commerce_agent_usage_event` | Immutable provider-response usage rows |
| Concurrency | `commerce_agent_turn_lease` | Reserved/active/released/expired turns |
| Terminal ordering | `commerce_agent_turn_completion` | Idempotent terminal event and stale-update protection |
| Audit | `commerce_enterprise_audit_event` | Tenant/workspace-scoped security events |
| Replay protection | `commerce_idempotency_record` and turn request ids | Tenant-scoped idempotency |

The current access path fails closed on organization, tenant, contract term, workspace, membership, ownership, and permission state:

- a non-`active` organization cannot enter an Enterprise context;
- a non-`active` tenant cannot enter an Enterprise context;
- a non-`active` contract, a contract before `effective_from`, or an expired `effective_until` cannot run Agent operations;
- inactive workspace or membership rows do not grant access;
- an unknown or foreign thread is returned as `404`, so its existence is not disclosed.

## Roles, Groups, And Permission Resolution

System roles are seeded per tenant during bootstrap. They are Commerce Pilot roles whose shape follows the public OpenAI pattern of workspace-level administration, members, analytics access, groups, and custom permission assignment.

Tenant roles:

- `tenant_owner`: all currently cataloged permissions, including tenant administration, contract visibility, roles, quotas, usage, audit, and Agent operation;
- `tenant_admin`: member, group, role, workspace, quota, usage, and audit administration, without owner-level contract control;
- `tenant_member`: an Enterprise seat with basic tenant/workspace discovery; Agent access normally comes from a workspace role;
- `analytics_viewer`: read-only contract, quota, usage, and audit visibility.

Workspace roles:

- `workspace_owner`: runs and manages the member's own Agent work in that workspace; tenant administrators retain workspace lifecycle and membership control;
- `workspace_operator`: run and manage the user's own Agent tasks;
- `workspace_analyst`: read shared workspace threads, artifacts, and usage;
- `workspace_viewer`: read shared workspace content and artifacts.

Effective roles are the union of:

1. roles assigned directly to the user at tenant scope;
2. roles assigned directly to the user for the selected workspace;
3. tenant-scoped roles assigned through active groups;
4. selected-workspace roles assigned through active groups.

Effective permissions use explicit-deny precedence:

```text
effective = union(all allowed permissions) - union(all denied permissions)
```

A denial from any effective direct or group role wins over an allowance from every other role. Unknown permission strings are discarded against the application permission catalog. Route handlers then require a named permission in addition to membership and ownership checks.

Tenant-wide administration requires the permission to come from a tenant-scoped role; a workspace role cannot be used to list or mutate tenant-wide members, workspaces, invitations, or audit records. PostgreSQL triggers reject a tenant role assigned with a workspace id or a workspace role assigned without one. Invitation role keys are unique inside a tenant, and a non-owner inviter cannot grant permissions above the inviter's own effective boundary.

The schema supports manual groups and records a future `scim` source. Custom-role and group-management UI/API, SCIM provisioning, and identity-provider synchronization are not complete yet. The current Agent BFF also remains creator-only even though workspace read permissions and a thread visibility field exist; workspace thread sharing needs a dedicated UI and authorization policy before use.

## Enterprise Administration APIs

The authenticated BFF exposes these tenant-scoped management surfaces. All responses are non-cacheable where they contain tenant data, all ids are schema-validated, and each handler repeats tenant-level permission checks:

| API | Permission | Implemented behavior |
| --- | --- | --- |
| `GET /api/enterprise/context` | active membership | Organization, tenant, workspace, effective roles, tenant permissions, and contract |
| `GET /api/enterprise/members` | `members.read` | Members, status, roles, workspace memberships, and seat limit |
| `PATCH /api/enterprise/members/:userId` | `members.manage` | Suspend, reactivate, or remove; protects self and tenant owner; audits the transition |
| `GET /api/enterprise/workspaces` | `workspaces.read` | Active/archived workspaces, member counts, and contract limit |
| `POST /api/enterprise/workspaces` | `workspaces.manage` | Creates within the contract limit and makes the creator workspace owner |
| `PATCH /api/enterprise/workspaces/:workspaceId` | `workspaces.manage` | Archive/reactivate; protects the default workspace and blocks archive with running turns |
| `POST /api/enterprise/workspaces/select` | active workspace membership | Sets an HttpOnly selected-workspace cookie after membership readback |
| `POST /api/enterprise/workspaces/:workspaceId/members` | tenant `workspaces.manage` + `members.manage` | Adds an active tenant member or atomically replaces direct workspace roles |
| `DELETE /api/enterprise/workspaces/:workspaceId/members/:userId` | tenant `workspaces.manage` + `members.manage` | Removes non-default workspace access and direct workspace roles |
| `GET/POST /api/enterprise/invitations` | `members.read` / `members.manage` | List, expire, and create invitations with seat and role-escalation checks |
| `DELETE /api/enterprise/invitations/:invitationId` | `members.manage` | Revoke a pending invitation |
| `POST /api/enterprise/invitations/accept` | authenticated invitee | Email-bound, one-time invitation acceptance |
| `GET /api/enterprise/usage` | `usage.read` | Workspace usage; tenant aggregate only when the permission is tenant-scoped |
| `GET /api/enterprise/audit` | `audit.read` | Tenant-wide time-paginated audit read, capped at 200 rows per request |

Removing a member deletes direct roles and group membership after the status transition. Suspending or removing a member also triggers runtime revocation behavior described below; it is not merely a UI state change.

## Invitation-Only Onboarding

An Enterprise administrator with `members.manage` creates an email-bound invitation for the selected workspace and one or more role keys.

The invitation flow provides these controls:

- the token is generated with 32 random bytes;
- only its SHA-256 digest is stored in PostgreSQL;
- the raw bearer token is returned once as `/invite#token=...`, never as a query parameter, and responses use `Cache-Control: no-store`;
- URL fragments do not reach Next.js, reverse proxies, CDN access logs, referrer headers, or server-rendered page props;
- the invite page reads the token into an in-memory ref and immediately replaces the address bar with `/invite`; it does not write browser storage;
- expiry is limited to 1-30 days by the API, with 7 days as the default;
- a newer pending invitation revokes an older pending invitation for the same normalized email and tenant;
- invitation creation is serialized per tenant while checking the seat limit;
- production account registration requires this invitation token and the exact invited work email; phone registration cannot satisfy an Enterprise invitation;
- existing users log in without sending the token, then explicitly submit it only to the acceptance endpoint;
- acceptance re-checks tenant/workspace and contract state, seat availability, the inviter's current `members.manage` authority, and the inviter's ability to grant every requested role;
- memberships, role assignments, acceptance state, and audit are committed in one transaction;
- invitation creation and acceptance write metadata-only audit events.

The application must not log invite URLs or tokens, place them in analytics, persist them in browser storage, or send them through an unapproved channel. The current API returns a copyable invite URL because transactional email delivery is not configured. Production always rejects registration without an invitation; `COMMERCE_ALLOW_PUBLIC_REGISTRATION=true` works only outside production for explicit bootstrap/E2E use. A user without an active invitation-backed membership cannot access Enterprise or Agent APIs even if the authentication account exists.

## Contract, Seats, And Quotas

Every tenant has one versioned Enterprise contract with:

- lifecycle: `pending`, `active`, `suspended`, or `terminated`;
- seat limit and workspace limit;
- optional monthly total-token limit;
- optional monthly model-request limit;
- concurrent-turn limits for the tenant, selected workspace, and user;
- `token_reservation_per_turn`, default `50,000`, for conservative in-flight admission near the monthly token limit;
- `max_agent_threads_per_session`, default `4`, for bounded Codex multi-agent fan-out;
- a UTC billing anchor day from 1 through 28;
- effective dates and a contract version.

The billing period begins at `00:00:00 UTC` on the anchor day. If the current month's anchor has not arrived, the period begins on the previous month's anchor. `NULL` monthly limits mean the contract does not impose that limit; they do not mean usage is unmetered.

Pending valid invitations consume seat capacity when a new invitation is created. Active, invited, or suspended tenant memberships retain seat capacity; only removal releases it. Both invitation operations take a tenant advisory lock so two administrators cannot oversubscribe the same last seat through the normal API race. Workspace create/reactivate uses a separate tenant advisory lock and enforces `workspace_limit`; the default workspace cannot be archived, and a workspace with a running turn cannot be archived.

Before a direct Agent turn or an execution-producing queue steer starts, the BFF:

1. takes a tenant-keyed PostgreSQL transaction advisory lock;
2. expires stale reserved/active leases;
3. rejects a repeated tenant/request UUID;
4. re-reads the current contract under the lock and checks its status/effective term, concurrency, and projected current-period usage;
5. creates a short-lived `reserved` lease;
6. changes it to `active` only after App Server returns a turn id;
7. releases it on terminal events, explicit reconciliation, or a definitive startup failure; an ambiguous queue-steer result is held until expiry.

Lease expiry is the maximum interactive turn duration plus a 60-second recovery margin. Limit failures return `429` with a stable reason code and create a metadata-only audit event. A model-request unit is one completed provider Responses request recorded from Codex, not one browser message or one whole turn; a turn can produce multiple model requests.

Monthly admission does not look only at settled totals. It projects:

```text
projected tokens = recorded total + (current in-flight root jobs + 1) × token reservation per turn
projected requests = recorded response rows + current in-flight root jobs + 1
```

The new job is denied when either projection would exceed its contract limit. This is a concurrency-safe budget guard, not final invoice settlement: actual provider usage is recorded separately in the immutable ledger, while the reservation exists only for admission and lease lifetime.

Quota admission uses an explicit tenant-wide database context. Ordinary product transactions set `commerce.tenant_wide = 'off'` and remain restricted to the selected workspace. Only the admission transaction sets it to `on`; usage and turn-lease RLS then permits rows from every workspace whose `tenant_id` equals the current tenant. This allows the same advisory-locked query to enforce:

- tenant concurrency across all workspaces;
- selected-workspace concurrency;
- per-user concurrency across all workspaces in the tenant;
- tenant-wide monthly total-token and model-request limits.

The tenant id remains mandatory in the RLS policy even in tenant-wide mode, and the flag is transaction-local. It does not allow admission code to see another tenant.

Queue storage does not consume a concurrency slot while the input is waiting. When a user promotes a queued item through the billable steer/start path, the BFF first performs the same tenant-wide quota admission using the queued item's stable client UUID. A previously released or expired waiting reservation may be safely replaced, but an active duplicate is rejected. If Gateway starts a replacement turn, the lease becomes `active` with the returned turn id; non-starting outcomes release it. If the upstream result is ambiguous, the reservation remains until its short expiry instead of admitting possibly duplicate work.

Pending-steer state is durable. On a normal uninterrupted steer transition, Gateway restores the selected item at the front of the queue and may start it using the already-authorized reservation. After a Gateway restart, recovery only restores and reorders the input in the durable Harness queue; it deliberately does not call `thread/queue/start`. A fresh authenticated BFF request and quota lease are required before billable execution resumes.

### Context compaction admission

Every compaction path participates in the same contract admission budget:

- **Manual:** the authenticated BFF checks `thread.compact`, reserves a lease using the client request UUID, and only then calls Gateway.
- **Automatic:** after the configured context threshold, Gateway calls the private `COMMERCE_AGENT_ADMISSION_URL` and starts native `thread/compact/start` only when the BFF reserves a lease.
- **Harness-initiated:** if Codex emits a `contextCompaction` item on its own, Gateway immediately asks the same admission endpoint; denial or endpoint failure interrupts that compact turn and emits a failed-compaction event.

The compaction request UUID is attached to its terminal event so the BFF can release a reservation even if the compact turn completed before the lease could be bound to a turn id. A compact turn never receives an application-authored summary; App Server continues to own compaction content and lifecycle.

### Root-job concurrency and Codex agent threads

Enterprise turn leases count admitted **root jobs** at tenant, workspace, and user scope. Subagent threads inherit the root job's tenant/workspace/user authorization and usage attribution; they do not each consume a second root-job lease.

Codex separately caps concurrent agent threads within one session through `agents.max_concurrent_threads_per_session`. `COMMERCE_AGENT_MAX_THREADS_PER_SESSION` defaults to `4` and accepts `1-16`; the tenant contract stores the negotiated `max_agent_threads_per_session`. A tenant-dedicated deployment must configure the runtime value equal to or lower than that contract value. This runtime fan-out ceiling complements, rather than replaces, root-job concurrency quotas.

### Current limitations

The remaining Enterprise gaps are deliberately narrow:

- SAML/OIDC SSO and SCIM provisioning/deprovisioning are not implemented.
- A central multi-tenant runtime manager/router is not implemented; production still uses an isolated per-tenant route or stack.
- Custom-role and group-management UI/API are not implemented, although the schema and effective-permission engine exist.
- Workspace-shared thread UI and its sharing policy are not implemented; current conversation routes remain creator-only.
- Provider invoice/rate-card reconciliation is not implemented. Missing provider usage is surfaced explicitly and must not be treated as zero-cost usage.

## Codex 0.149 Usage Accounting

The repository pins `@openai/codex` `0.149.0`. Commerce Pilot preserves the Harness usage categories instead of inferring usage from message text.

`thread/tokenUsage/updated` contains:

```text
threadId
turnId
tokenUsage.total
tokenUsage.last
tokenUsage.modelContextWindow
```

`total` is cumulative thread usage and may be replayed. `last` describes only the most recent provider completion. Therefore:

- `total.totalTokens / modelContextWindow` drives context-compaction pressure;
- cumulative `total` values must never be repeatedly summed into billing;
- `last` must not be treated as the total for a multi-response turn.

For Harness model calls, Gateway enables raw experimental events and consumes one `rawResponse/completed` notification per completed Responses call. Its exact 0.149 usage breakdown is:

```text
totalTokens
inputTokens
cachedInputTokens
cacheWriteInputTokens
outputTokens
reasoningOutputTokens
```

Accounting rules:

- cached input and cache-write input are classifications inside `inputTokens`, not extra tokens to add on top;
- reasoning output is a classification inside `outputTokens`, not extra output;
- ordinary input is derived as `inputTokens - cachedInputTokens - cacheWriteInputTokens`;
- the database enforces `cachedInputTokens + cacheWriteInputTokens <= inputTokens` and `reasoningOutputTokens <= outputTokens`;
- Harness category totals are stored from the raw completion event and are not inferred from conversation content;
- the workspace cache-hit ratio is `cachedInputTokens / inputTokens` when input is non-zero;
- token quotas use recorded `totalTokens` plus in-flight reservations, while request quotas count immutable response rows plus in-flight root jobs.

Usage is also attributed for provider calls made outside the main Harness response stream:

| `source` | Origin |
| --- | --- |
| `codex_harness` | Codex `rawResponse/completed` |
| `commerce_web_mcp` | Managed `commerce_web.search` MCP result metadata |
| `commerce_web_tool` | Legacy application host Web Search compatibility path |
| `commerce_image_tool` | Application-owned `commerce_image.generate` host tool |

External tool usage is normalized from provider snake_case or camelCase fields. Cached/cache-write/reasoning subsets are clamped to their parent counts, and `totalTokens` is at least input plus output. Each row stores both `requested_model` and the effective `model`; `model/rerouted` notifications preserve the difference when Codex/provider routing changes the model.

If a Harness, MCP, or host-tool provider response omits usable usage, Commerce Pilot still records the model request with zero placeholder counts and `usage_status = 'missing'`. Usage summaries expose `missingUsageEvents`. This means “provider did not report usage,” not “the call was free”: subsequent admissions pause with `TENANT_USAGE_RECONCILIATION_REQUIRED`, and active authorization polling interrupts further work. An operator can use `npm run enterprise:reconcile-usage -- ...` with the job-only migration credential, exact tenant/provider/response ids, validated token components, a stable reason code, and optional active actor id. The transaction updates only a still-missing row, appends `usage.reconcile` audit evidence, and verifies readback before resuming work.

Prompt-cache discounts and billing rules vary by provider and model. A cache hit can still consume rate-limit capacity, and a reported cached-token category is not itself a Commerce Pilot price. Pricing should be calculated later from an effective-dated provider/contract rate card, without rewriting this immutable raw-usage ledger.

The idempotency key for persistence is `(tenant_id, provider_id, response_id)`. Subagent events inherit their root thread's tenant, workspace, and user scope while preserving child `thread_id` and `parent_thread_id`. The internal BFF verifies that the root thread is bound to the same tenant, workspace, and creator before inserting usage. Tenant-scoped `usage.read` returns a tenant aggregate; a workspace-only grant sees only its selected workspace.

No direct browser/BFF or Gateway image-generation route is exposed. Images can be generated only through the application-owned host tool inside an already admitted Agent turn, where runtime authorization and usage attribution apply. The authenticated BFF artifact-read route remains available for immutable generated files and re-checks the artifact's owning thread before proxying bytes.

`rawResponse/completed` is an internal/experimental App Server event, not a stable public billing API. Any Codex upgrade must regenerate the App Server schema, compare the usage fields and event semantics, run adapter tests, and deploy a compatible migration before changing the pinned version.

## Durable Event Delivery

Usage and terminal-turn events cross the Gateway/BFF boundary through a durable local outbox:

```text
Codex App Server event
  -> tenant-pinned Gateway scope
  -> $CODEX_HOME/commerce-runtime/agent-event-outbox.json
  -> authenticated internal BFF event sink
  -> ownership check + PostgreSQL transaction
  -> outbox acknowledgement
```

The outbox and dead-letter file are written atomically with owner-only filesystem permissions and loaded after Gateway restart:

```text
$CODEX_HOME/commerce-runtime/agent-event-outbox.json
$CODEX_HOME/commerce-runtime/agent-event-dead-letter.json
```

Delivery is at least once. Successful event ids are acknowledged in one persisted batch; if a later transient delivery fails before that batch commits, earlier events may be retried and PostgreSQL idempotency absorbs the replay. Retryable failures use exponential backoff capped at 60 seconds. Sink `400`, `404`, `409`, or `422` responses are treated as permanent contract/ownership failures and moved to the dead-letter file with a sanitized reason; only the most recent 100 dead letters are retained.

Terminal events are deduplicated in `commerce_agent_turn_completion` by tenant/root-thread/turn and by event id. A replay cannot overwrite a newer thread state: the thread update accepts only the matching active turn or an empty active slot and only a newer terminal timestamp. Lease release can match either the bound turn id or the original request UUID, covering completion-before-activation races such as compaction.

On `SIGINT` or `SIGTERM`, Gateway stops authorization/retry timers and turn deadlines, ends SSE clients, stops App Server, waits for pending event-file writes, flushes the outbox, makes one final sink-delivery attempt, and flushes again before exit. Events contain identifiers, usage counts, status, and timestamps, not prompts, tool inputs/results, provider secrets, or commerce record payloads. Both files are nevertheless tenant data and belong only on that tenant's encrypted runtime volume.

Production requires `COMMERCE_AGENT_EVENT_SINK_URL` and the same 32+ character `COMMERCE_GATEWAY_INTERNAL_TOKEN` on Gateway and BFF. The callback is an internal service endpoint and must not be internet-addressable. Health exposes sanitized sink state, pending count, and dead-letter count; deployment must alert on backlog, any dead letter, repeated sink errors, or an old successful check time. HTTP `200` alone is not sufficient readiness evidence.

## Isolation And Ownership

### Browser and BFF

The browser never chooses an organization or tenant identity, user identity, provider, `cwd`, sandbox, permissions, raw App Server input, or tool definitions. The BFF resolves the organization/tenant pair and workspace context from the authenticated session and active memberships. An optional workspace id selects only a workspace to which the user already belongs.

Every Agent route applies permission checks and binds a thread to `(tenant_id, workspace_id, created_by_user_id)`. These values are forwarded to the internal Gateway as trusted service headers only after BFF authorization. The Gateway rejects absent or malformed scope, returns `404` on a scope mismatch, pins all production traffic to `COMMERCE_RUNTIME_TENANT_ID`, and gives subagents the parent thread's scope.

### PostgreSQL

Migrations force RLS across the Enterprise control plane and runtime ledger: organization, tenant, workspace, tenant/workspace memberships, roles and assignments, groups and assignments, contract, runtime placement, invitations, threads, usage, leases, terminal completions, audit, and idempotency. Better Auth identity/session tables remain governed by Better Auth and least-privilege grants rather than Enterprise workspace RLS.

Transactions set only the scoped PostgreSQL settings they need: `commerce.organization_id`, `commerce.tenant_id`, `commerce.workspace_id`, `commerce.user_id`, `commerce.tenant_wide`, and, for bearer-token invitation discovery, `commerce.invitation_token_hash`. Normal operations set tenant-wide off. Tenant administration/admission sets it on inside an explicit transaction; every expanded policy still requires the exact current tenant id. Compound tenant/workspace foreign keys and explicit SQL predicates remain required because RLS is defense in depth, not the only authorization check.

Runtime and migration credentials are separate:

- `DATABASE_URL` is the web/BFF role. In production it must be non-superuser, must not have `BYPASSRLS`, and receives only the table/sequence privileges needed at runtime. Application initialization refuses to run when production detects either dangerous role flag.
- `MIGRATION_DATABASE_URL` is the owner/migration credential loaded only by migration, provisioning, and isolation-verification jobs (locally from `.env.migration`). Production migration fails closed when it is absent. Do not mount that file or inject the variable into the long-running web process.

After migrations, run `npm run enterprise:verify-isolation` with distinct URLs. The verifier confirms the runtime role flags, unscoped invisibility, self-membership discovery, organization/tenant/workspace isolation, rejected cross-tenant writes, and tenant-wide same-tenant lease aggregation. `COMMERCE_ENFORCE_DATABASE_RLS=true` enables the same role check in CI/local runs; production enforces it regardless.

The thread policy temporarily permits legacy rows whose `tenant_id` is `NULL` when their legacy `user_id` matches the current user. Bootstrap backfills the selected owner's old rows. Before a sensitive multi-company production migration is declared complete, every retained legacy row must be assigned or quarantined, the foreign key validated, and the legacy RLS branch removed in a follow-up migration.

### Codex Runtime

Production uses one dedicated Gateway, Codex App Server process, `CODEX_HOME`, provider credential set, runtime workspace, generated-artifact volume, Hook audit, pending-steer state, and event outbox per tenant. `COMMERCE_RUNTIME_TENANT_ID` is mandatory in production and prevents a dedicated Gateway from accepting a different tenant id.

App Server runs as a non-root identity in a container or equivalent OS isolation boundary. Mount only the tenant's runtime and artifact volumes. Do not mount the source repository, developer home, Docker socket, SSH agent, cloud metadata socket, or another tenant's volume. Application tool filtering remains mandatory but is not a replacement for OS isolation.

The current application has one static `COMMERCE_GATEWAY_URL`; it is not yet a central runtime manager for many dedicated tenants. Until tenant-aware runtime provisioning and routing are implemented, production must deploy a tenant-specific application/Gateway stack or an equivalently isolated per-tenant route configured outside browser control. Local development may omit the tenant pin for cross-tenant authorization tests, but that mode is not production hard isolation.

## Revocation And Concurrent Use

Authorization is active, not a one-time check at turn start:

- Gateway polls `COMMERCE_AGENT_AUTHORIZATION_URL` for every active root scope at `COMMERCE_AGENT_AUTHORIZATION_POLL_MS` (default 10 seconds, allowed 5-60 seconds).
- The BFF authorizer re-checks active organization, tenant, workspace, memberships, effective contract term, root-thread creator binding, and effective `agent.run` with deny precedence.
- A denial, timeout, malformed response, or endpoint failure is fail-closed. Gateway interrupts every active Codex thread under that root job, deletes every queued root submission, marks the root revoked, and emits `commerce/authorization/revoked`.
- Before an application host Web Search or image tool performs its external call, Gateway independently re-runs the same authorization check.
- Suspending or removing a member immediately sends interrupts for that member's known running root threads; the independent poll then supplies race-safe queue clearing and subagent/root coverage.
- The browser-facing SSE BFF separately re-resolves Enterprise access and creator ownership every 15 seconds and closes the stream on denial or lookup failure.

Different roots can run concurrently, while Codex preserves one active turn per individual thread and the runtime fan-out cap bounds subagents. Database advisory locks and tenant-scoped request UUIDs prevent common double-click and simultaneous-admission races. Terminal App Server events release active leases even when the initiating browser disconnects. Restart recovery may restore pending input to the queue, but it cannot start that billable work without a fresh BFF admission.

For a 100+ member customer, production readiness also requires connection-pool sizing, load tests at negotiated concurrency, graceful Gateway drain, outbox/backlog alerts, database backup and restore exercises, and documented incident response. These operational controls are not implied by the schema alone.

## Provisioning An Organization And Tenant

First create the intended owner through a controlled operator identity flow, apply migrations with the migration credential, verify RLS with the runtime credential, and run bootstrap. For local development only, temporarily setting `COMMERCE_ALLOW_PUBLIC_REGISTRATION=true` can create the first account; production ignores that override and remains invitation-only.

```bash
npm run auth:migrate
npm run enterprise:verify-isolation
npm run enterprise:bootstrap -- \
  --owner-email=owner@example.com \
  --tenant-name="Example Company" \
  --tenant-slug=example-company \
  --workspace-name="Default Workspace" \
  --workspace-slug=default \
  --seat-limit=150 \
  --workspace-limit=10 \
  --concurrent-turn-limit=25 \
  --workspace-turn-limit=15 \
  --user-turn-limit=3 \
  --token-reservation-per-turn=50000 \
  --max-agent-threads-per-session=4
```

Bootstrap creates or updates the one-to-one organization and tenant, default workspace, active contract, dedicated-runtime record, system roles, owner assignments, and an audit event. It returns both organization and tenant UUIDs and binds that owner's legacy threads to the new tenant/workspace. Defaults are 150 seats, 10 workspaces, 25 tenant root jobs, 15 workspace root jobs, 3 root jobs per user, a 50,000-token reservation, 4 Codex agent threads per session, 50,000,000 monthly tokens, and 50,000 monthly provider responses; operator flags can set the negotiated values.

Bootstrap is an idempotent provisioning operator, not a harmless read-only command. Re-running it for the same slug reactivates records, updates limits, resets seeded system-role permissions/denies, and increments the contract version. Review parameters and audit its use.

The returned tenant UUID becomes the runtime pin:

```text
COMMERCE_RUNTIME_TENANT_ID=<tenant UUID>
```

The `commerce_tenant_runtime` row begins in `provisioning`. Runtime orchestration must mark it ready only after the tenant-dedicated container, volume, provider secret, event sink, health checks, and recovery checks are complete.

## Production Environment Contract

Gateway/runtime variables:

- `NODE_ENV=production`
- `COMMERCE_RUNTIME_TENANT_ID`: required UUID for the one tenant served by this Gateway;
- `CODEX_HOME`: absolute path to that tenant's persistent runtime volume;
- `COMMERCE_PROVIDER_API_KEY`: secret scoped and rotated for this runtime where the provider supports it;
- `COMMERCE_PROVIDER_BASE_URL`, `COMMERCE_PROVIDER_ID`, `COMMERCE_PROVIDER_NAME`: application-owned provider identity;
- `COMMERCE_GATEWAY_INTERNAL_TOKEN`: random 32+ character service secret shared only with the BFF;
- `COMMERCE_AGENT_EVENT_SINK_URL`: private BFF callback for usage and terminal events;
- `COMMERCE_AGENT_AUTHORIZATION_URL`: private BFF callback for active root/tool authorization;
- `COMMERCE_AGENT_ADMISSION_URL`: private BFF callback for automatic/Harness compaction admission and release;
- `COMMERCE_AGENT_AUTHORIZATION_POLL_MS`: active authorization interval, `5000-60000`, default `10000`;
- `COMMERCE_AGENT_MAX_THREADS_PER_SESSION`: Codex agent-thread cap, `1-16`, default `4`, no higher than the tenant contract;
- `COMMERCE_AGENT_MAX_TURN_DURATION_MS`: interactive deadline used by lease expiry;
- `COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT` and `COMMERCE_AGENT_COMPACTION_TIMEOUT_MS`: native Codex compaction controls.

BFF variables:

- `DATABASE_URL`: TLS-protected PostgreSQL connection using a non-superuser, non-`BYPASSRLS`, least-privilege runtime role;
- `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `AUTH_TRUSTED_ORIGINS`: deployed authentication boundary;
- `COMMERCE_GATEWAY_URL`: the private URL of the correct tenant-dedicated Gateway;
- `COMMERCE_GATEWAY_INTERNAL_TOKEN`: the matching service secret;
- `COMMERCE_ALLOW_PUBLIC_REGISTRATION=false`: production is invitation-only; production code ignores a true override;
- explicit verified email/SMS delivery providers before external onboarding.

Migration/provisioning job variables:

- `MIGRATION_DATABASE_URL`: owner credential, distinct from the runtime URL and absent from the long-running web service;
- `DATABASE_URL`: the runtime-role URL used by `enterprise:verify-isolation` to prove enforced RLS;
- `COMMERCE_ENFORCE_DATABASE_RLS=true`: optional outside production and useful in CI.

Production Gateway startup fails when its tenant pin, service token, event sink, authorization URL, or admission URL is missing. Production BFF startup/use fails when the database role is superuser or `BYPASSRLS`. Never expose any value above through `NEXT_PUBLIC_*`, and never publish Gateway or internal callback routes to untrusted clients.

## Next Phases

The implemented foundation leaves five principal product/platform phases:

1. SAML/OIDC SSO plus SCIM provisioning, deprovisioning, and identity-provider group sync;
2. a tenant-aware runtime manager/router for provisioning, health reconciliation, rolling upgrades, drain, and disaster recovery across many companies;
3. custom-role and group-management UI/API on top of the existing schema and deny-precedence engine;
4. workspace-shared thread UI, explicit sharing policy, and shared-artifact lifecycle;
5. provider usage/invoice reconciliation, effective-dated rate cards, missing-usage resolution, billing export, and financial settlement.

These phases do not remove the operational need for penetration testing, 100+ user load/failure tests, backup-restore drills, audit retention/export, and incident runbooks before customer production traffic.

## Public Design References

- [OpenAI Enterprise roles and workspace permissions](https://learn.chatgpt.com/docs/enterprise/roles-and-workspace-permissions)
- [OpenAI Enterprise groups and provisioning](https://learn.chatgpt.com/docs/enterprise/groups-and-provisioning)
- [OpenAI Enterprise governance](https://learn.chatgpt.com/docs/enterprise/governance)
- [OpenAI Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
