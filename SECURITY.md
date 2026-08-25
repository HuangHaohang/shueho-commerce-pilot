# Security Policy

## Reporting

Report suspected vulnerabilities privately to the repository owners. Do not open a public issue containing credentials, customer identifiers, prompts, attachments, production URLs, exploit payloads, or tenant data.

Include the affected commit, deployment environment, reproduction conditions, impact, and whether any external system or customer record changed.

## Security Invariants

- The public browser communicates only with the authenticated Next.js BFF.
- Gateway and Codex App Server are private service infrastructure.
- Each production Gateway/App Server/`CODEX_HOME` is pinned to one Enterprise tenant.
- App Server runs non-root in an OS/container boundary with dedicated runtime/artifact volumes.
- Shell, arbitrary host filesystem, process control, arbitrary process network, unmanaged MCP, unmanaged Hooks, and browser-selected runtime configuration are disabled.
- Application Tool filtering is mandatory and does not replace OS isolation.
- Unknown Tool calls and App Server requests fail closed.
- Tenant, workspace, user, thread, Turn, artifact, and approval ownership is rechecked server-side.

## Secrets

Never commit:

- `.env` or `.env.migration`;
- provider/API credentials;
- `BETTER_AUTH_SECRET`;
- Gateway service tokens;
- database credentials;
- private keys, cookies, session data, OAuth tokens, or ERP/marketplace credentials.

Production secrets belong in a secret manager or deployment-level protected file/variable. Browser bundles must not contain `NEXT_PUBLIC_*` secrets.

## Data And Artifacts

- Prompt text, Tool arguments/results, attachments, secrets, and PII are excluded from audit/outbox payloads.
- Uploaded files are type-checked, size-limited, tenant/thread/request-bound, and stored with owner-only permissions.
- Browser events strip local artifact paths and extracted document content.
- Permanent thread deletion removes generated images, uploads, extracted text, and descendant thread artifacts.
- Customer data should be minimized and masked in UI, logs, fixtures, screenshots, and bug reports.

## Dependencies

Use the lockfile in every environment. Review new parser, archive, image, network, auth, and cryptography dependencies carefully. Run `npm audit --omit=dev`; document existing framework advisories separately from vulnerabilities introduced by a change. Do not use `npm audit fix --force` without reviewing the resulting major upgrades.

## Production Gate

Follow [`docs/deployment/runtime.md`](docs/deployment/runtime.md). A healthy HTTP response alone is insufficient: verify managed MCP readiness, authorization/admission callbacks, outbox/dead letters, database role safety, container identity, mount boundaries, and real business readback.
