# Commerce Pilot Authentication

## Boundary

Commerce Pilot user authentication is application-owned. It is separate from Codex App Server account authentication:

- Commerce Pilot auth identifies a user, organization, workspace, and role.
- Codex `account/read` and `account/login/start` identify the model/provider account used by a runtime.
- Browser sessions, passwords, and verification codes must never be sent to Codex App Server.

## Current Phase

The current implementation supports:

- email plus password registration and login;
- phone number plus password registration and login;
- PostgreSQL-backed sessions using HttpOnly cookies;
- sign out and server-side session read;
- normalized E.164 phone numbers, including Chinese 11-digit mobile input;
- database-backed authentication rate limits;
- password length and composition validation.

Email and SMS verification are deliberately not enabled in this phase. `EmailVerificationSender` and `SmsVerificationSender` are stable application interfaces. Both resolve to disabled implementations until a production provider is explicitly configured.

Verification codes must never be logged or returned to the browser by a development fallback.

Email addresses and phone numbers created in this phase remain unverified contact points. They must not be used for password recovery, security notifications, marketing, or as proof that the user owns that contact point. Public registration must not be launched until the corresponding verification provider and account-recovery flow are implemented.

## Phone Password Accounts

Better Auth requires an internal email identity for credential accounts. Phone registrations therefore receive an HMAC-derived alias under `phone.commerce-pilot.invalid`; the raw phone number is stored in the dedicated unique `phoneNumber` field and used by the phone sign-in endpoint. The alias is never shown as the user's public identifier.

## Runtime Isolation

Every new Codex thread is recorded in `commerce_agent_thread` with its authenticated Commerce Pilot `user_id`. Event-stream, turn, and interrupt BFF routes verify this mapping and return 404 for missing or foreign threads. Random thread ids are not treated as authorization.

The thread index also stores title and timestamps for the authenticated user's sidebar. Message history remains App Server-owned: refresh and history selection call `thread/read`, and Gateway calls `thread/resume` before the first new turn after a process restart. PostgreSQL does not duplicate raw conversation bodies.

The index stores the last known runtime status, active turn id, turn start time, and duration. The sidebar polls only while at least one thread is running and reconciles running rows against App Server `thread/read`. This supports concurrent turns across different owned threads without mirroring conversation content into PostgreSQL.

The runtime disables host shell/filesystem capabilities and runs from an app-owned runtime directory. This prevents an end user from turning the web agent into a deployment-host coding agent.

The current Gateway still uses one App Server process for all users. Thread ownership checks provide the required application authorization boundary, but stronger tenant isolation remains required before handling sensitive data from multiple organizations: introduce a runtime manager keyed by organization/workspace, isolate `CODEX_HOME`, provider credentials, event routing, artifacts, approvals, quotas, and process lifecycle, or deploy isolated runtime workers per tenant. Do not market the current single-runtime phase as hard tenant isolation.
