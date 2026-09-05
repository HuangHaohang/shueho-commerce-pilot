# Public MCP on server244 with a Mac retrieval worker

Commerce Pilot is built on the open-source Codex Harness. This deployment is the separate external-client MCP service, not the complete browser Agent/Gateway deployment described in [Runtime Deployment](runtime.md). No Codex host-development capabilities, provider endpoint controls or raw warehouse API are exposed.

## Topology

```text
External MCP client --HTTPS + workspace Bearer token--> Cloudflare
  -> existing server244-production Tunnel
  -> server244 127.0.0.1:18087 (restricted Nginx ingress)
  -> public-mcp (stateless Streamable HTTP/SSE)
     -> private Next.js control BFF -> Enterprise PostgreSQL with forced RLS
     -> internal TLS -> independent external-data service
        -> JustOneAPI REST, with the service-owned provider credential
        -> separate PostgreSQL/pgvector and Elasticsearch
        -> model-client -> private Unix socket -> model-relay
           -> server244 127.0.0.1:18792
           -> SSH reverse forwarding -> Mac 127.0.0.1:8792
           -> real Qwen3 Embedding 4B / Reranker 4B on Metal
```

The public URL is `https://commerce-mcp.shueho.com/mcp`. `/health` provides a bounded readiness response; every other public path is rejected. Browser workbench and BFF `/api/internal/*` paths are not routed. Cloudflare authentication challenges or an interactive SSO redirect must not replace the MCP Bearer contract.

The existing Tunnel retains its other application routes. The Mac needs no Cloudflare Tunnel for inference. A legacy local connector belonging to a different account was retired with protected backups; local cloudflared operator authentication was changed to the account owning `shueho.com`.

## Runtime and storage

- Server release root: `/home/shueho/services/shueho-commerce-pilot/releases/`.
- Protected service configuration: `/home/shueho/services/shueho-commerce-pilot/config/`.
- Application-owned model socket: `/home/shueho/services/shueho-commerce-pilot/run/model/relay.sock`.
- Compose project: `commerce-pilot-mcp`; independent PostgreSQL, warehouse and Elasticsearch volumes.
- Mac worker root: `~/Library/Application Support/SHUEHO External Data/`.
- Mac user launch services: `com.shueho.commerce-qwen` and `com.shueho.commerce-qwen-tunnel`.

Application and proxy containers run as UID 1000 with read-only root filesystems, dropped capabilities, `no-new-privileges`, bounded memory/process limits and bounded logs. Only the small model-relay proxy shares the host network so it can reach SSH's loopback listener; it exposes only the dedicated Unix socket. The model-client sees that directory read-only. No host firewall changes or application ports on the LAN are required.

PostgreSQL certificates validate the internal database names against a dedicated private CA. Runtime roles are neither superusers nor `BYPASSRLS`. Only job containers receive migration URLs. Node trusts the private CA through a read-only certificate mount, without disabling certificate validation.

Nginx, PostgreSQL, pgvector and Elasticsearch images are digest-pinned. App and job artifacts are tagged with the full source commit and include `org.opencontainers.image.revision`. Release archives contain reviewed Git files only; environment files, runtime directories, database snapshots, model weights and client credentials are excluded.

## Protected configuration contract

`COMMERCE_CONFIG_DIR` contains these operator-provisioned files; the repository does not contain their values:

| File | Contents and audience |
|---|---|
| `database.env`, `warehouse-database.env` | Independent database owner bootstrap credentials |
| `control.env` | Least-privilege app database URL, Enterprise tenant pin, Better Auth secret/origin, internal control token and public MCP URL |
| `public-mcp.env` | Explicit Host allowlist, private BFF callback URLs/token, internal data-service TLS URL and its distinct MCP token |
| `warehouse.env` | Least-privilege warehouse URL, private Elasticsearch URL, JustOneAPI credential, model URL/token and pinned model identities |
| `web-jobs.env`, `warehouse-jobs.env` | Corresponding runtime values plus job-only migration URLs; never mount in application services |
| `ca.crt`, `database-tls/`, `warehouse-database-tls/`, `internal-tls/` | Private trust root and service certificates; retain the CA signing key on the operator machine |

The model URL is `http://model-client:8081`. Both Unix-socket proxies allow only `/health`, `/v1/embeddings` and `/v1/rerank`; inference endpoints retain the Mac service's Bearer validation. The Mac `.env` supplies pinned weight paths/revisions, `LOCAL_MODEL_FAKE_MODE=false` and `LOCAL_MODEL_ALLOW_CPU=false`. Verify every model weight shard against the downloader's SHA-256 manifest before activation.

The Mac launch service runs Uvicorn under `caffeinate -i`, and uses an independent runtime environment. Both LaunchAgents use `RunAtLoad`, `KeepAlive` and throttled restart. The SSH identity has no shell/PTY/agent/X11 access and restricts TCP forwarding to the designated reverse listener. Host-key checking is strict and pinned; keepalive detects a lost link. These user LaunchAgents start after login, not before login. The Mac must remain powered, connected and logged in; explicit sleep or shutdown makes model-dependent operations unavailable.

## Provisioning and activation

Create a clean deployment from the reviewed source commit and protected configuration. Use a filtered, consistent source snapshot or explicit Enterprise provisioning; do not copy developer browser sessions, MCP tokens, unrelated tenants or Codex conversation state. Preserve original raw responses, immutable source receipts, revisions and request identities when migrating existing research evidence. Verify table counts and file hashes before enabling the data service. Rebuild Elasticsearch through fresh index-outbox entries, never by replaying paid provider calls.

Start databases and model proxies first, restore/apply registered migrations once, then start application services:

```sh
docker compose --env-file /path/to/release.env -f deploy/production-mcp/compose.yaml \
  up -d --wait database warehouse-database elasticsearch model-relay model-client
docker compose --env-file /path/to/release.env -f deploy/production-mcp/compose.yaml \
  up -d --wait
```

The Mac inference service and forwarding channel must already be healthy. The independent data service warms both real models before listening. After a model outage, process restart must resume stored data processing only; uncertain paid provider dispatches remain blocked for reconciliation.

Run the repository validation matrix. Operator verification additionally includes `auth:migrate`, `enterprise:verify-isolation`, `enterprise:verify-external-data`, `external-data:migrate`, `external-data:verify:catalog`, `external-data:evaluate` and `external-data:verify`. The latter mounts the legacy source migration configuration into that one job only and reuses an existing confirmed archive; it does not purchase new data. Validate the current immutable catalog/profile/workflow receipts instead of silently reseeding master-data defaults.

Only publish the Cloudflare hostname after the local ingress is healthy, unauthenticated MCP returns `401`, private callback paths return `404`, and an authenticated SDK client can discover tools, retrieve evidence and obtain a free quote. Verify these again through the public HTTPS hostname and after a service/forwarding restart. Do not call `execute_marketplace_research` as a deployment smoke test.

Enterprise approval policy is preserved on migration. With `always_ask`, paid MCP execution returns `APPROVAL_REQUIRED`; a token does not grant automatic spending. Human approval requires the separately deployed Commerce Pilot Harness web flow, or an authorized operator can later configure a priced enterprise policy ceiling through normal governance. The MCP deployment must not weaken this policy for a smoke test.

## Rollback and maintenance

Retain the previous image, release directory, protected configuration and a restorable database snapshot. To roll back application code, select the previous release's `COMMERCE_MCP_IMAGE` and run `docker compose up -d --wait`; keep the same project name and volumes. Do not run `docker compose down -v`, replay paid calls, downgrade append-only schemas, rotate the shared existing Cloudflare Tunnel token or alter other application routes.

Monitor the model/SSH launch services, container health, raw-call `unknown` states, index outbox failures, TLS certificate expiry, token expiry, disk capacity and backup restoration. Renewal of a client token does not authorize changing its workspace or scopes. Renew private service certificates before their expiry and read back TLS verification after replacement.
