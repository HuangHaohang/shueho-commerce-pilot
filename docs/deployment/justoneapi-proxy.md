# JustOneAPI dedicated subscription egress

Commerce Pilot remains built on the open-source Codex Harness. This feature belongs exclusively to the independent SHUEHO External Data service's REST adapter. It introduces no Harness tool, permission, browser setting or paid-call retry loop.

## Traffic and payment boundary

```text
Governed paid call -> JustOneApiRestClient
  -> per-request healthy-node shuffle bag
  -> that node's fixed internal HTTP CONNECT listener
  -> verified TLS to the configured JustOneAPI origin
  -> exactly one GET/POST, complete response archive and existing billing settlement
```

The application owns subscription import, node selection, health and cooldown. Mihomo translates supported Shadowsocks, VMess, VLESS, Trojan and Hysteria2 nodes into dedicated HTTP CONNECT listeners. Each listener has one fixed outbound. No mutable global selector, shared connection pool, global proxy environment/dispatcher, system proxy, TUN, controller or DIRECT fallback is used. Database, Elasticsearch, Qwen, model-provider, Web Search, public/internal MCP and other HTTP paths keep their existing routing.

Each round randomly shuffles healthy node ids and consumes each id once; adjacent rounds avoid repeating the previous final id when multiple nodes are healthy. Concurrent requests claim ids synchronously and each keeps its own verified TLS socket through the complete response. Health probes perform only CONNECT plus verified TLS to the provider origin: no provider HTTP path, Token or business input is sent. Failed nodes enter exponential cooldown capped at fifteen minutes; background checks restore them after recovery. Default interval/cooldown is sixty seconds, with four concurrent bounded probes.

Only CONNECT/TLS failures before HTTP creation may try another node, at most three by default. Once the `ClientRequest` is created, there is exactly one attempt: no retry after timeout, truncated body, reset, HTTP error, redirect or uncertain response. GET is also non-retryable. An unavailable/missing required pool raises `PROXY_UNAVAILABLE` with `uncertain=false`; existing warehouse handling records a known non-billable failure. Post-dispatch transport failures remain `RESULT_UNKNOWN`, preserving reconciliation and non-replay. Existing reservations, authorization, approvals, idempotency, raw capture and billing remain authoritative.

`GET /health` includes only mode, configured state, total/healthy counts and check time. Stored evidence remains readable during an egress outage; paid dispatch fails closed. Subscription addresses, credentials, raw node addresses and business content are never health fields or log output.

## Protected import and renewal

Save the provider's Clash YAML export outside Git. Alternatively save its HTTPS subscription URL in a mode-0600 file; never put the URL directly in shell arguments, source code, logs or browser/BFF fields. The downloader has bounded size/timeout and follows at most three HTTPS redirects within the source origin or an explicit operator allowlist. The importer accepts only a bounded `proxies` list and an explicit outbound-field schema. It excludes notice rows, duplicate connection definitions, unsupported fields/protocols and `skip-cert-verify: true` nodes. It never applies subscription rules, listeners, controllers, DNS, plugin commands or file paths. Review `excludedUnsupported` before activation.

```sh
npm run external-data:proxy:import -- \
  --subscription-file=/absolute/protected/subscription.yaml \
  --output-dir=/absolute/protected/justoneapi-proxy \
  --proxy-host=127.0.0.1 --listen=127.0.0.1 --first-port=19000
```

Use `--subscription-url-file=/absolute/protected/subscription-url.txt` instead of `--subscription-file` to download the subscription. Imports do not alter active runtime. The returned hash-named immutable directory contains:

- `mihomo.yaml`: secret node definitions and fixed listeners, mode 0600;
- `nodes.json`: opaque ids and internal listener URLs, mode 0600;
- `receipt.json`: source/config hashes, revision and import/exclusion counts, mode 0600.

Identical imports reuse the verified directory. Changes create a new revision; tampered existing revisions are rejected. Keep all inputs and generated artifacts outside Git. Never feed a complete subscription directly to Mihomo.

For V2Board-compatible subscriptions that default to Base64 URI lists, request `--format=meta` or `--format=clash`. If the subscription service uses another download origin, add `--allow-redirect-origin=https://approved-provider-alias.example` after checking that provider alias; arbitrary cross-origin redirects remain blocked before credentials are forwarded. These are free subscription-download options and never affect the paid JustOneAPI transport.

Start an official, pinned Mihomo binary with the generated YAML and a dedicated writable state directory:

```sh
/absolute/application-owned/mihomo -t -d /absolute/protected/mihomo-state -f /absolute/protected/REVISION/mihomo.yaml
/absolute/application-owned/mihomo -d /absolute/protected/mihomo-state -f /absolute/protected/REVISION/mihomo.yaml
npm run external-data:proxy:verify -- --nodes-file=/absolute/protected/REVISION/nodes.json
```

Verification samples actual CONNECT/TLS leases without sending paid provider HTTP requests. `--verify-exit` additionally contacts free `https://api.ipify.org` through sampled nodes and directly; it emits only distinct-exit count and whether sampled exits differ from direct, never IP addresses or credentials. Different nodes may share an exit IP; probes are point-in-time observations.

Set only the external-data service's protected environment and restart it:

```dotenv
JUSTONEAPI_PROXY_MODE=required
JUSTONEAPI_PROXY_NODES_FILE=/absolute/protected/REVISION/nodes.json
JUSTONEAPI_PROXY_CONNECT_TIMEOUT_MS=5000
JUSTONEAPI_PROXY_HEALTH_INTERVAL_MS=60000
JUSTONEAPI_PROXY_COOLDOWN_MS=60000
JUSTONEAPI_PROXY_MAX_CONNECT_ATTEMPTS=3
```

`off` is the compatibility default for installations that have not opted in. Required mode never degrades to off/direct, including when all nodes are down, files are invalid or the process restarts. A mode change is an explicit operator action, never automatic recovery.

Renew by importing a fresh revision and validating it with the pinned binary; pause new paid admission, drain active calls, stop external-data, switch both services to the same revision and restart. Repeat TLS/exit checks before new paid calls. Do not hot-reassign ports underneath running requests or replay uncertain calls. Retain the previous revision for rollback. Renewal requires no schema or provider master-data migration.

## server244 Compose overlay

Import with `--proxy-host=justoneapi-egress --listen=0.0.0.0`; listeners remain on a dedicated Docker network. In the protected release environment set:

```dotenv
COMMERCE_JUSTONEAPI_PROXY_IMAGE=metacubex/mihomo@sha256:REVIEWED_OFFICIAL_IMAGE_DIGEST
COMMERCE_JUSTONEAPI_PROXY_REVISION_DIR=/absolute/protected/justoneapi-proxy/REVISION
```

Use a reviewed official digest, never `latest`. Provision the copied revision with parent traversal permission and mode 0640 files in a dedicated group 65532; the overlay adds that group to warehouse and Mihomo runs with gid 65532. Do not relax the subscription-URL source file. Validate actual container read permissions before rollout.

```sh
docker compose --env-file /path/to/release.env \
  -f deploy/production-mcp/compose.yaml \
  -f deploy/production-mcp/compose.justoneapi-proxy.yaml config --quiet
docker compose --env-file /path/to/release.env \
  -f deploy/production-mcp/compose.yaml \
  -f deploy/production-mcp/compose.justoneapi-proxy.yaml up -d justoneapi-egress warehouse
```

The sidecar runs non-root with read-only root, no capabilities, bounded resources and only the dedicated config mount. No ports are published. Only warehouse joins its internal listener network; a separate sidecar egress network keeps listeners isolated from edge/BFF. Warehouse retains other-service egress; only `JustOneApiRestClient` opts into the pool. The overlay does not modify the Mac's existing sing-box or unrelated services.

## Acceptance

Run the repository validation matrix plus `justoneapi-proxy-*` tests. Real socket tests use a local TLS origin and independent CONNECT servers to verify node rotation, safe pre-dispatch switching, no direct fallback, unrelated HTTP isolation, no token in CONNECT, certificate verification, origin/header restrictions, no redirects, and exactly one GET/POST after received requests disconnect or response bodies time out. Import tests cover strict fields, fixed routing, immutable receipts and permissions. No paid JustOneAPI request is needed.

References: [Mihomo listeners](https://wiki.metacubex.one/en/config/inbound/listeners/), [Mihomo HTTP listeners](https://wiki.metacubex.one/en/config/inbound/listeners/http/), [Node HTTPS](https://nodejs.org/api/https.html), [Node HTTP CONNECT](https://nodejs.org/api/http.html#event-connect).
