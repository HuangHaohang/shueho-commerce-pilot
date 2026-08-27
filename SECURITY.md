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
- External data calls require live RBAC, workspace policy, a budget reservation, approval or policy evidence, and an atomic dispatch transition.
- Commerce Pilot MCP credentials and JustOneAPI credentials are separate audiences; token passthrough is forbidden.

## Secrets

Never commit:

- `.env` or `.env.migration`;
- provider/API credentials;
- `BETTER_AUTH_SECRET`;
- Gateway service tokens;
- database credentials;
- private keys, cookies, session data, OAuth tokens, or ERP/marketplace credentials.
- `JUSTONEAPI_API_TOKEN`, `EXTERNAL_DATA_SERVICE_MCP_TOKEN`, `LOCAL_MODEL_INTERNAL_TOKEN`, or full `cp_*` Commerce Pilot MCP Access Tokens.

Production secrets belong in a secret manager or deployment-level protected file/variable. Browser bundles must not contain `NEXT_PUBLIC_*` secrets.

## Data And Artifacts

- Prompt text, Tool arguments/results, attachments, secrets, and PII are excluded from audit/outbox payloads.
- Uploaded files are type-checked, size-limited, tenant/thread/request-bound, and stored with owner-only permissions.
- Browser events strip local artifact paths and extracted document content.
- Permanent thread deletion removes generated images, uploads, extracted text, and descendant thread artifacts.
- External research requests and provider responses are deliberately retained outside conversation storage in the independent SQL-only warehouse. Raw rows are RLS-scoped, unavailable through browser/public MCP routes, immutable after settlement, and excluded from Elasticsearch.
- Customer data should be minimized and masked in UI, logs, fixtures, screenshots, and bug reports.
- External-data audit stores endpoint ids, parameter keys and hashes, not full parameters or upstream payloads. An `unknown` paid result must be reconciled, never retried automatically.
- Complete JustOneAPI business requests and responses are stored only in the SQL-only `commerce_external_data_archive`; no browser UI, BFF read/download route, public MCP tool, Hook, log or ordinary audit event may expose them. Archived request payloads must reject credential-like keys, and thread deletion must not cascade into this independent dataset.

## Dependencies

Use the lockfile in every environment. Review new parser, archive, image, network, auth, and cryptography dependencies carefully. Run `npm audit --omit=dev`; document existing framework advisories separately from vulnerabilities introduced by a change. Do not use `npm audit fix --force` without reviewing the resulting major upgrades.

Current time-bounded assessments are recorded in [`docs/security/dependency-advisories.md`](docs/security/dependency-advisories.md). An exception without a review date and compensating controls is not acceptable.

## Production Gate

Follow [`docs/deployment/runtime.md`](docs/deployment/runtime.md). A healthy HTTP response alone is insufficient: verify managed MCP readiness, authorization/admission callbacks, outbox/dead letters, database role safety, container identity, mount boundaries, and real business readback.
