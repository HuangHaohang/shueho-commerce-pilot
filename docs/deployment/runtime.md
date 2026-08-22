# Runtime Deployment

This is a web application. Deployment machines do not need a preinstalled global `codex` executable.

## Runtime Ownership

The application declares `@openai/codex` in `package.json`. During deployment, install dependencies from `package-lock.json`; the Codex App Server runtime is then resolved from the application dependency tree.

Resolution order:

1. `CODEX_BIN`, only when explicitly set.
2. `./node_modules/.bin/codex`.
3. `./node_modules/@openai/codex/bin/codex.js`.
4. `./node_modules/@openai/codex-<platform>/vendor/<target>/bin/codex`.
5. global `codex`, only outside `NODE_ENV=production` for local development fallback.

Production fails fast if no application-owned Codex runtime is runnable.

## Container Deployment

Build:

```bash
docker build -t shueho-commerce-pilot .
```

Run:

```bash
docker run --rm \
  --network commerce-internal \
  -e COMMERCE_PROVIDER_API_KEY="..." \
  -e COMMERCE_PROVIDER_BASE_URL="https://cpa.luusmosh.com/v1" \
  -e COMMERCE_IMAGE_MODEL="gpt-image-2" \
  -e COMMERCE_GATEWAY_INTERNAL_TOKEN="a-random-secret-of-at-least-32-characters" \
  -e COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT="75" \
  -e COMMERCE_AGENT_COMPACTION_TIMEOUT_MS="180000" \
  -v commerce-pilot-codex:/var/lib/shueho-commerce-pilot/codex \
  shueho-commerce-pilot
```

Port `8787` is an internal service port. Connect the Next.js BFF over the private container network and give it the same `COMMERCE_GATEWAY_INTERNAL_TOKEN`. Do not publish `8787` to the internet. For local-only diagnostics, bind explicitly to loopback with `-p 127.0.0.1:8787:8787`.

The mounted `CODEX_HOME` directory should contain app-owned Codex configuration, including custom provider definitions when needed:

```text
/var/lib/shueho-commerce-pilot/codex/config.toml
```

## Provider Configuration

Do not assume a developer's `~/.codex/config.toml` exists on the server. For deployment, render or mount provider config into:

```text
$CODEX_HOME/config.toml
```

The runtime creates an isolated working directory at:

```text
$CODEX_HOME/workspaces/default
```

Do not mount the source repository, `/`, `/home`, `/root`, a Docker socket, SSH agent sockets, cloud metadata sockets, or arbitrary host directories into the App Server container. Run as a non-root user and mount only dedicated application runtime volumes.

Provider API keys should be injected as environment variables or secret manager files. Do not commit real provider keys. The gateway resolves `CODEX_HOME` to an absolute application-owned path before starting App Server and generates the provider definition without embedding the key.

## Defense In Depth

The generated Codex config disables shell, unified exec, raw local-path view-image, apps/connectors, unmanaged Hooks, plugins, automatic dependency installation, and inherited shell environment. Threads are fixed to read-only sandbox mode and cannot override `cwd` or permissions through HTTP.

Provider-backed Web Search uses the application-owned `commerce_web.search` stdio MCP tool, and multi-agent collaboration is enabled. The generated MCP config exposes only that read-only tool, forwards provider configuration by environment-variable name, and runs the bundled MCP server artifact from the application image. The MCP process executes `/v1/responses` Web Search calls; it does not expose generic process or host-network tools to users. Gateway also keeps native `web_search = "live"` enabled, and the managed Hook allowlist includes both MCP and native search names. Subagents inherit the same restricted runtime. Raw local-path image reading remains disabled until App Server is isolated with a tenant-only artifact mount; use an application-owned artifact id boundary instead.

Gateway monitors App Server `thread/tokenUsage/updated` events and invokes native `thread/compact/start` after completed turns cross the configured context threshold. Keep the percentage below the model's hard context limit and the timeout below infrastructure request limits. Compaction uses App Server's own `contextCompaction` item and managed `PreCompact`/`PostCompact` Hooks; deployment code must not replace it with an application-authored summary.

Hooks run in managed-only mode from `$CODEX_HOME/managed-hooks/commerce-runtime-hook.mjs`. Mount the managed Hook directory read-only in hardened production deployments. Hook audit output belongs in the dedicated `$CODEX_HOME/hook-audit` volume and must not contain prompt bodies, tool inputs/results, provider secrets, or commerce PII.

The production image installs `/etc/codex/requirements.toml`, pins Hooks on, sets `allow_managed_hooks_only = true`, and repeats the shell/sandbox restrictions as administrator requirements. Non-container production deployments must install [runtime/commerce-requirements.toml](../../runtime/commerce-requirements.toml) at the same system path before starting Gateway.

These controls prevent the model from receiving host-development capabilities. Container or equivalent OS isolation remains mandatory because an application-layer allowlist cannot mitigate an App Server or runtime implementation vulnerability by itself.
