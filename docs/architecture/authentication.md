# Commerce Pilot Authentication

## Boundary

Commerce Pilot user authentication is application-owned. It is separate from Codex App Server account authentication:

- Commerce Pilot auth identifies a user, the customer's commercial organization, its one-to-one isolation tenant, the selected workspace, and effective roles.
- Codex `account/read` and `account/login/start` identify the model/provider account used by a runtime.
- Browser sessions, passwords, and verification codes must never be sent to Codex App Server.

## Current Phase

The current implementation supports:

- email plus password login and invitation-gated registration;
- phone number plus password accounts for local/legacy authentication, but not Enterprise invitation registration;
- PostgreSQL-backed sessions using HttpOnly cookies;
- sign out and server-side session read;
- normalized E.164 phone numbers, including Chinese 11-digit mobile input;
- database-backed authentication rate limits;
- password length and composition validation.

Email and SMS verification are deliberately not enabled in this phase. `EmailVerificationSender` and `SmsVerificationSender` are stable application interfaces. Both resolve to disabled implementations until a production provider is explicitly configured.

Verification codes must never be logged or returned to the browser by a development fallback.

Email addresses and phone numbers created in this phase remain unverified contact points. They must not be used for password recovery, security notifications, marketing, or as proof that the user owns that contact point. Production registration is already fail-closed to an email-matching Enterprise invitation. `COMMERCE_ALLOW_PUBLIC_REGISTRATION=true` is honored only outside production for explicit bootstrap/E2E work.

## Phone Password Accounts

Better Auth requires an internal email identity for credential accounts. Phone registrations therefore receive an HMAC-derived alias under `phone.commerce-pilot.invalid`; the raw phone number is stored in the dedicated unique `phoneNumber` field and used by the phone sign-in endpoint. The alias is never shown as the user's public identifier.

## Runtime Isolation

Enterprise authorization is application-owned and evaluated after Better Auth authentication. A valid login is not sufficient: the user must also have active tenant and workspace memberships, an active tenant, an active contract for Agent operations, and the required effective permission. Explicit denies from any direct or group role override all allows.

`commerce_organization` carries the customer company's commercial identity. Its required one-to-one `commerce_tenant` carries memberships, contract, runtime, authorization, audit, and data isolation. A workspace always belongs below that tenant.

The web process uses `DATABASE_URL` with a non-superuser, non-`BYPASSRLS` application role and fails closed on unsafe role flags in production. Schema migration and provisioning use a distinct `MIGRATION_DATABASE_URL` outside the long-running web process. `npm run enterprise:verify-isolation` proves the runtime role cannot perform unscoped or cross-tenant reads/writes.

Every new Codex thread is recorded in `commerce_agent_thread` with its authenticated `(tenant_id, workspace_id, created_by_user_id)` binding. Event-stream, turn, queue, compact, and interrupt BFF routes verify this binding and return `404` for missing or foreign threads. Random thread ids and browser-provided scope headers are not treated as authorization.

The thread index also stores title, timestamps, and the dynamic-tool contract version created at `thread/start`. Message history remains App Server-owned: refresh reads metadata plus paginated `thread/turns/list`, and Gateway calls `thread/resume` before the first new turn after a process restart. PostgreSQL does not duplicate raw conversation bodies or falsely upgrade an old thread's fixed dynamic-tool catalog.

The index stores the last known runtime status, active turn id, turn start time, and duration. The sidebar polls only while at least one thread is running and reconciles each row against thread metadata plus one summary Turn, not full history. This supports concurrent turns across different owned threads without mirroring conversation content into PostgreSQL.

The runtime disables host shell/filesystem capabilities and runs from an app-owned runtime directory. This prevents an end user from turning the web agent into a deployment-host coding agent.

Production requires one tenant-dedicated Gateway, App Server process, `CODEX_HOME`, provider credential set, runtime workspace, artifacts, and event outbox. `COMMERCE_RUNTIME_TENANT_ID` pins that Gateway to one tenant. Local development can run without the pin for isolation testing, but that mode is not a production tenant boundary. The current BFF has one static Gateway URL, so a tenant-aware runtime manager/router remains future work; until then, deploy an isolated application/Gateway route per customer.

Open SSE streams re-check membership, permission, contract, and thread ownership every 15 seconds and close on revocation or lookup failure. In parallel, Gateway polls the private authorization endpoint for active root jobs every 10 seconds by default. A denied or failed check interrupts all active root/subagent turns, deletes queued root input, and emits a revocation event; host Web Search and image calls also re-authorize immediately before the external call.

See [Enterprise Tenancy Foundation](./enterprise-tenancy.md) for the complete membership, role, invitation, quota, RLS, usage, and deployment contract.

## Enterprise Invitation Requirement

The Enterprise product is invitation-only in production. Invitations are bound to a normalized email, store only a token hash, enforce seat availability, constrain role escalation, and assign tenant/workspace roles in one acceptance transaction. Registration validates the raw token and invited email before creating an account; acceptance revalidates the inviter's current authority and contract/seat state. The accepting Better Auth user's email must match exactly, so phone-only accounts cannot accept an Enterprise email invitation.

The API returns `/invite#token=...`. The fragment is not sent in HTTP requests, proxy/CDN logs, or referrer headers. The client copies it into memory, immediately removes it from the address bar, and sends it only in the one-time registration or acceptance POST body. It is never stored in local/session storage. The current API returns a copyable link because production email delivery is not configured; do not log or retain it, and configure verified delivery/account recovery before customer onboarding.
