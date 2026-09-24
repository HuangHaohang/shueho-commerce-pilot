# Windows Docker Desktop with an existing Cloudflare Tunnel

Commerce Pilot remains a browser application backed by the application-owned
Codex Harness container. Windows is the deployment host, not a desktop product
shell. The initial release on 2026-09-14 used application/jobs/Gateway source
`0c5bee6e3af74eb9f84d044f0f595698ea4231c7` and the unchanged reviewed proxy image
from `23ed8ca0fea00437359408c13a8252a0acf799cd`.

## Installed layout

- Source releases: `C:\shueho-commerce-pilot\releases\<commit>`.
- Protected environment, certificates and Windows Compose overlay:
  `C:\shueho-commerce-pilot\config`.
- Compose project: `commerce-pilot-mcp`; dedicated database, search, runtime,
  Linux TLS and model-socket volumes. Never run `down -v` during an update.
- Compose order: production-mcp base, production-web overlay, protected
  `windows.yaml`, and `jobs.yaml` (its jobs profile is opt-in). Supplier overlays
  require separate protected configuration and are not in this installed project.
- SSH operations use the project-specific `DOCKER_CONFIG` and
  `DOCKER_HOST=npipe:////./pipe/dockerDesktopLinuxEngine`. Do not overwrite the
  desktop user's credential-helper settings.

Windows bind-mounted private keys cannot enforce Linux ownership. Initialize
dedicated Linux volumes once: PostgreSQL Alpine UID 70, warehouse PostgreSQL UID
999, internal TLS and model socket UID 1000. Keep CA signing keys off the server;
renew service certificates before their one-year expiry. Normal containers receive
only runtime database credentials; migration credentials belong only to job runs.

The Windows model-relay overlay removes Linux host networking and connects through
`host.docker.internal:18792`. Its private Unix socket is shared with model-client
using a named Linux volume. The guarded relay entrypoint remains mandatory.

## Ingress and restart behavior

Reuse `shueho-cpa-tw-prod`, retaining all unrelated ingress records. Route
`commerce.shueho.com` to `http://127.0.0.1:18088` and
`commerce-mcp.shueho.com` to `http://127.0.0.1:18087`; proxied CNAMEs select this
tunnel, never the connector's changing public IP. The previous shared tunnel's
two Commerce routes were removed only after public readback. Other routes remain.

Cloudflared runs as an automatic Windows service. The
`SHUEHO-Commerce-Docker-Start` scheduled task starts Docker Desktop after the
deployment user logs in; Compose restart policies then recover containers.
This is **not** verified unattended pre-login cold-boot recovery. Do not enable
Windows automatic login or restart Docker/WSL globally to test one application.

Retrieval models still run on the designated Mac. Its
`com.shueho.commerce-qwen-tunnel-server144` LaunchAgent uses a dedicated restricted
key, host-key checking and reconnects a loopback-only SSH reverse forward. The
Mac, model service and network path must remain available. This SSH destination
uses the server's private address, independently of Cloudflare's dynamic-IP handling.

## Acceptance and limits

The deployed release passed authenticated login, workspace/thread reads, browser
guest/login rendering, public health 200, unauthenticated MCP 401, internal path
404 and application-service restart recovery. Warehouse readiness returned 200
with zero pre-imported key/endpoint quota pairs. No paid supplier or image call
was used for acceptance; multi-key failover was tested in disposable PostgreSQL.
The initial deployment contains one configured supplier key. Legal entity/contact
fields remain unconfigured by operator choice. Do not describe these boundaries
as fully verified business-flow or legal launch acceptance.
