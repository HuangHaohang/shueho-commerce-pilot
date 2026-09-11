# Full browser workbench on server244

This overlay adds the Next.js workbench and tenant-dedicated open-source Codex
Harness Gateway to the existing public MCP deployment. It keeps the existing MCP
hostname, databases, supplier overlays and model service. Apply all overlays with
the same `commerce-pilot-mcp` project name; never create replacement data volumes.

## Release

Build the MCP runtime/jobs images using `deploy/production-mcp/Dockerfile`, and the
Gateway using the root Dockerfile, from the same reviewed Git commit. The Gateway
build compiles and tests the pinned patched Linux Harness; do not copy a developer
macOS binary or Codex home. `CARGO_BUILD_JOBS` defaults to two to bound build memory.
Tag images with the full commit and set `COMMERCE_SOURCE_COMMIT` for revision labels.
BuildKit caches Cargo downloads and target artifacts between builds; the pinned
source, patch checks and native tests still run. Cargo diagnostics stream during
compilation, including test discovery, so dependency failures remain visible.

Protected `gateway.env` contains the existing tenant pin and internal token,
service-owned model-provider credential, private external-data MCP URL/token, and
private BFF callback URLs. `web.env` provides the public auth origin and
`COMMERCE_GATEWAY_URL=http://gateway:8787`, plus the operator's legal/contact values.
Both files are runtime-only, outside source archives. Workers receive these
least-privilege runtime values, never migration credentials. The jobs image supplies
TypeScript worker entry points; using it does not grant database owner privileges.

Back up both PostgreSQL databases and protected configuration. Verify backups with
`pg_restore --list`. Drain actual running research/agent work before replacement;
unknown supplier outcomes stay unknown and must never be replayed. Apply registered
Web migrations (including 051 and 052) with the jobs image and protected
`web-jobs.env` before updating control. Apply external-data migrations only when
pending; retain immutable imports and provider quotas.

Compose file order (paths relative to the release root):

1. `deploy/production-mcp/compose.yaml`
2. existing `compose.justoneapi-proxy.yaml` and `compose.justoneapi-tokens.yaml`
3. `deploy/production-web/compose.yaml`

Use `deploy/production-web/compose.sh` as the full deployment wrapper. It preserves
the existing supplier overlays and reads protected configuration from
`COMMERCE_CONFIG_DIR` (the server244 configuration directory by default).

Set release image variables in protected `deployment.env`, including
`COMMERCE_GATEWAY_IMAGE` and `COMMERCE_JOBS_IMAGE`. Validate with `docker compose
config --quiet` so resolved secrets are never printed. Start private services,
verify Gateway HTTP 200 with `managedMcp.state=ready`, then start background workers
and web-edge. Only the web edge publishes loopback `127.0.0.1:18088`; Gateway has no
host port. The edge rejects `/api/internal/*`, preserves SSE without buffering or
upstream replay, and bounds request bodies (6 MiB only for attachment and product
import routes, whose application handlers enforce authentication and file limits).

Add the approved browser hostname to the existing Cloudflare Tunnel pointing at
`http://127.0.0.1:18088`; preserve every pre-existing route and fallback. Do not rotate
the tunnel identity or change `/mcp`. Verify HTTPS, login, private-route denial,
unauthenticated artifact denial, model inventory, native session creation, image
canvas/version reads, and MCP 401/discovery through their actual public origins.
Public registration stays disabled. Legal/contact values must be supplied by the
operator before the public browser rollout.

The `codex-runtime` volume contains production Harness history, artifacts and event
outbox. Back it up consistently with the application database. Local development
histories, browser sessions and generated images are not copied into production.

## Rollback

Restore the previous protected image references and Compose file list, then recreate
only affected application services. Preserve the database and runtime volumes, and
keep append-only migrations. If disabling the newly introduced web surface, remove
only its added Tunnel route. Never run `down -v` or restore older databases over new
customer writes as an automatic rollback.
