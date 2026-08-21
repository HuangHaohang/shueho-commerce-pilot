# SHUEHO Commerce Pilot

Web application for a commerce agent, built on OpenAI's open-source Codex App Server harness.

The project invariants are recorded in [AGENTS.md](./AGENTS.md): the e-commerce agent runtime must be based on the Codex open-source harness, and the product surface is a browser-based web application, not a desktop app. Product UI, commerce tools, persistence, and integrations should sit around that runtime instead of replacing it.

## What Is Integrated

- Starts `codex app-server --listen stdio://` as the local agent runtime.
- Declares `@openai/codex` as an application dependency so deployments do not rely on a globally installed `codex` binary.
- Sends the required `initialize` request and `initialized` notification.
- Exposes a small HTTP/SSE gateway for the browser web application.
- Streams allowlisted Codex App Server notifications over SSE.
- Fixes the model provider, runtime directory, permissions, and tool registry on the server; browser requests cannot override them.
- Discovers text and image models from the application-owned CPA provider.
- Uses the Codex host-tool protocol to expose `gpt-image-2` image generation inside agent turns.
- Disables shell, unified exec, arbitrary local-path file tools, process network access, connectors, unmanaged MCP, plugins, and unmanaged Hooks.
- Exposes provider-backed Web Search as the App Server dynamic tool `commerce_web.search`, with real search lifecycle events and cited source URLs.
- Allows bounded multi-agent collaboration; subagents inherit the same restricted runtime policy.
- Keeps the built-in local-path `view_image` tool disabled until images are tenant-scoped artifacts or App Server runs with a tenant-only artifact mount.
- Enables an application-generated managed Hook runner for prompt, tool, compaction, stop, session, and subagent lifecycle policy/audit events; users cannot provide Hook commands.

This is not a desktop app scaffold. The browser frontend should call this gateway; it should not embed Codex App Server directly.

## Requirements

- Node.js 20+
- npm
- Docker with Compose for the provided local PostgreSQL environment, or an externally managed PostgreSQL database
- OpenAI/Codex credentials or a compatible custom provider configured for the deployed app runtime

The app uses the dependency-managed Codex binary by default:

```bash
./node_modules/.bin/codex --version
```

## Install

```bash
npm install
```

## Verify The App Server Integration

This starts Codex App Server over stdio, initializes it, reads diagnostics/config, and exits without starting a model turn:

```bash
npm run smoke:codex
```

## Run The Gateway

```bash
npm run dev
```

Default URL:

```text
http://127.0.0.1:8787
```

## Run The Web App

The browser frontend lives in `apps/web` and follows the design system in [designs/DESIGN.md](./designs/DESIGN.md). Authentication uses PostgreSQL-backed Better Auth sessions.

Start the local authentication database and apply the idempotent schema migration:

```bash
npm run db:up
npm run auth:migrate
```

Copy the authentication values from `apps/web/.env.example` into an ignored `apps/web/.env` for local development. Production must provide its own `DATABASE_URL`, `BETTER_AUTH_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters, and trusted browser origins.

```bash
npm run web:dev
```

Default URL:

```text
http://127.0.0.1:3000
```

The web app reads gateway health through its own Next.js route handler at `/api/gateway/health`. By default it expects the gateway at `http://127.0.0.1:8787`; override it for local or deployed environments with:

```bash
COMMERCE_GATEWAY_URL=http://127.0.0.1:8787 npm run web:dev
```

Frontend checks:

```bash
npm run web:check
npm run web:test
npm run web:build
```

Current authentication supports email or phone number plus password. Email and SMS verification delivery interfaces exist but resolve to disabled providers until real delivery services are configured; the application does not log or return verification codes as a fallback. See [docs/architecture/authentication.md](./docs/architecture/authentication.md).

Authenticated conversations are indexed by user in PostgreSQL while Codex App Server remains the source of truth for turns and messages. Refresh restores the most recent thread, the sidebar opens older owned threads, and Gateway resumes persisted threads before a post-restart follow-up.

Users may run independent threads concurrently. Running history items show a spinner in the sidebar; switching conversations or starting a new task leaves background turns running, while each individual thread still permits only one active turn at a time.

Health check:

```bash
curl http://127.0.0.1:8787/health
```

Open the event stream:

```bash
curl -N http://127.0.0.1:8787/api/codex/events
```

Start a thread:

```bash
curl -X POST http://127.0.0.1:8787/api/threads \
  -H 'Content-Type: application/json' \
  -d '{"model": "MODEL_ID"}'
```

Start a turn:

```bash
curl -X POST http://127.0.0.1:8787/api/threads/THREAD_ID/turns \
  -H 'Content-Type: application/json' \
  -d '{"message": "分析这个店铺的库存预警策略"}'
```

These direct Gateway examples are for loopback-only local development. Production callers must use the Next.js BFF with `COMMERCE_GATEWAY_INTERNAL_TOKEN`; do not expose port `8787` to browsers or the public internet.

## Custom Model Providers

Yes, custom providers can be used with App Server. This gateway configures `luusmosh_cpa` at `https://cpa.luusmosh.com/v1`, passes `modelProvider` to `thread/start`, and uses the Responses wire API required by current Codex.

Provider definitions are generated into the app-owned `$CODEX_HOME/config.toml`. The application does not rely on a human user's `~/.codex/config.toml`, and deployment machines do not need a globally installed `codex`.

Project `.codex/config.toml` is not the right place for production provider secrets. Treat provider definitions and credentials as deployment configuration.

Example user-level config:

```toml
model_provider = "luusmosh_cpa"
model = "gpt-5.6-sol"

[model_providers.luusmosh_cpa]
name = "Luusmosh CPA"
base_url = "https://cpa.luusmosh.com/v1"
env_key = "COMMERCE_PROVIDER_API_KEY"
wire_api = "responses"
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000
```

The browser selects only the model. Provider identity and runtime policy remain server-owned:

```json
{
  "model": "gpt-5.6-sol"
}
```

The gateway also exposes `gpt-image-2` as the Codex-hosted `commerce_image.generate` tool. Generated files are stored under the application-owned `$CODEX_HOME/generated_images`; provider keys remain server-side.

Web Search is exposed as `commerce_web.search`. The Gateway calls the configured provider's OpenAI-compatible `/v1/responses` Web Search tool and returns its cited sources to the Codex turn. The dynamic-tool registry is applied to new and resumed threads, so a Gateway restart does not remove search from a saved conversation.

See [docs/config/custom-model-provider.md](./docs/config/custom-model-provider.md) for details.

## Deployment Runtime

Deployment machines do not need to preinstall Codex. The app declares `@openai/codex` as a production dependency and resolves Codex App Server from the application dependency tree. See [docs/deployment/runtime.md](./docs/deployment/runtime.md).
