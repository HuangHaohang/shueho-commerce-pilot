# Custom Model Providers

Codex App Server can use custom model providers configured through the Codex config visible to the app-owned runtime.

## Where To Configure Providers

For local development, provider definitions can live in:

- `~/.codex/config.toml`
- `$CODEX_HOME/config.toml`
- `~/.codex/<profile-name>.config.toml`

For deployment, do not rely on a human developer's `~/.codex` directory. Set `CODEX_HOME` to an app-owned, tenant-dedicated directory and provide:

```text
$CODEX_HOME/config.toml
```

from a mounted config file, secret, init step, or container image layer. A production Gateway is pinned by `COMMERCE_RUNTIME_TENANT_ID`; never reuse its `CODEX_HOME`, provider secret, generated artifacts, or event outbox for another customer tenant.

Do not put provider secrets in project `.codex/config.toml`. Treat provider definitions, keys, and routing as deployment configuration owned by the web service.

## Commerce Pilot Provider

```toml
model_provider = "luusmosh_cpa"
model = "gpt-5.6-sol"
web_search = "live"

[features]
image_generation = true
shell_tool = false
unified_exec = false
apps = false
multi_agent = true
hooks = true

[tools]
web_search = true
view_image = false

[model_providers.luusmosh_cpa]
name = "Luusmosh CPA"
base_url = "http://127.0.0.1:8787/api/internal/provider/v1"
wire_api = "responses"
requires_openai_auth = false
http_headers = { "x-openai-actor-authorization" = "<gateway-derived-runtime-actor>" }
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 120000
```

Then provide the secret to that tenant's service process:

```bash
export COMMERCE_PROVIDER_API_KEY="..."
export CODEX_HOME="/var/lib/shueho-commerce-pilot/codex"
npm run dev
```

The gateway renders this definition into the application-owned `$CODEX_HOME/config.toml` at startup. The actor value is HMAC-derived from application-owned secret material and scoped to the tenant, Provider id, and upstream base URL. It authenticates only the loopback relay and is never accepted by browser/BFF routes. The upstream Provider key remains in the service process environment and the explicit managed-MCP environment allowlist; it is never written to the Codex Provider definition or exposed to the browser.

Where supported, provision and rotate a separate provider credential per Enterprise tenant so upstream revocation, spend controls, and incident containment follow the Commerce Pilot tenant boundary. If the upstream account must be shared, it remains an infrastructure credential and does not weaken the requirement for a tenant-dedicated App Server, `CODEX_HOME`, artifacts, outbox, BFF authorization, or usage ledger.

## Wire Protocol

Current Codex custom providers support only:

```toml
wire_api = "responses"
```

Even when an upstream also exposes `/v1/chat/completions`, Chat Completions is not a supported Codex provider wire protocol. Commerce Pilot uses `/v1/responses` for agent threads, tools, reasoning items, and streamed events.

## Model Discovery

The gateway fetches `GET https://cpa.luusmosh.com/v1/models` with the provider key and caches the result. It separates:

- agent models that can be selected for Codex `thread/start`;
- image models;
- non-agent utility models.

The browser reads the sanitized catalog through the authenticated `/api/provider/models` BFF route. It never receives the provider key.

The UI catalog is discovery-based but intentionally curated. `COMMERCE_AGENT_MODEL_SELECTORS` contains exact ids or `*` patterns; only models that both match a selector and currently exist in `/v1/models` are returned. The current selectors cover:

- GPT-5.5;
- GPT-5.6 Sol, Terra, and Luna;
- Gemini 3.7 Flash;
- Claude 4.6 Sonnet;
- Claude 4.6 Opus Thinking.

This prevents an upstream catalog expansion from silently exposing unsupported models while avoiding a hardcoded frontend list.

## Thread Title Generation

Conversation and Task Recipe titles use a separate utility model:

```bash
COMMERCE_TITLE_MODEL=gpt-5.3-codex-spark
```

The model id is not added to the end-user model selector. Gateway verifies the exact id against `/models`, calls `/responses` with low reasoning and a fixed title JSON schema, and never falls back to the active conversation model. Title generation is asynchronous after the first completed result and is recorded as `title_generation` usage.

## Image Generation

The app-owned Codex runtime enables `features.image_generation` and points the custom Provider at the Gateway's actor-authenticated loopback relay. Gateway treats `modelProvider/capabilities/read.imageGeneration` as the capability authority; namespace-tool support is required only when the selected Provider uses the `image_gen` extension path. Two Provider wire paths converge on one Harness Item contract:

```text
image_gen namespace extension -> Provider Image API -> Harness imageGeneration Item
Provider-hosted /responses image_generation_call -> patched Harness imageGeneration Item
Harness imageGeneration Item -> tenant artifact storage
```

The relay accepts only model listing, Responses, Responses compaction, image generation, and image edit routes. It validates the runtime actor, strips that header, injects the upstream CPA key, and streams the one upstream response. The application-owned `shueho.1` Harness patch projects completed hosted `image_generation_call` output in real time and during history replay; it never dispatches a second image call. The relay and Gateway do not create an application-owned image tool or synthesize an Item.

Codex owns image intent detection, Skill instructions, provider execution, item lifecycle, usage and Turn continuation. Gateway consumes the completed native Item, saves the base64 result under `$CODEX_HOME/generated_images`, and stores non-PII metadata under `$CODEX_HOME/generated_image_metadata`. Before SSE or history reaches the BFF, Gateway removes image bytes and `savedPath`; the browser receives only an ownership-checked artifact URL. A Provider request or stream failure is treated as uncertain: retries are disabled and 120 seconds without SSE progress terminates the attempt for explicit reconciliation/retry.

The image model is fixed by `COMMERCE_IMAGE_MODEL=gpt-image-2`. Other image models returned from `/models` are not silently selected.

The browser cannot bypass the Agent boundary because no direct BFF or Gateway image-generation route exists and browser input cannot inject tools. Native image generation runs only inside an admitted Harness Turn. Its usage is captured by the normal `codex_harness` response event rather than a second `commerce_image_tool` request.

## Web Search

Commerce Pilot exposes provider-backed Web Search as the managed `commerce_web.search` MCP tool. The MCP server calls the same configured provider with the dedicated `COMMERCE_WEB_SEARCH_MODEL` and returns grounded content plus source URLs:

```text
commerce_web.search MCP -> POST /v1/responses
                        -> tools: [{ "type": "web_search" }]
                        -> grounded answer + cited source URLs
```

The Gateway does not scrape arbitrary pages with deployment-host shell commands. It asks the configured provider to execute its OpenAI-compatible Web Search tool, returns the grounded answer and sanitized source URLs to Codex, and lets Codex continue the turn. The browser receives the App Server `mcpToolCall` lifecycle and renders `正在搜索网页` followed by a collapsible completed search activity.

The MCP capability comes from app-owned config rather than `dynamicTools`, because current App Server versions only accept dynamic tools at `thread/start`. Persisted-thread reads execute managed resume before paginated `thread/turns/list`, so the current MCP catalog is loaded for old conversations without rewriting history. `PreToolUse` and `PostToolUse` Hooks allow and audit the MCP tool name while recording only lifecycle metadata; queries and results are not written to the Hook audit log. Native `web_search = "live"` remains enabled as a provider-supported capability, and the old dynamic handler remains only for already-persisted threads that contain it.

Gateway calls `config/mcpServer/reload` and validates `mcpServerStatus/list` before accepting turns. The default Web Search model is `gpt-5.6-luna`, with a 30-second timeout and one attempt. `COMMERCE_WEB_SEARCH_MAX_ATTEMPTS` still accepts 1 to 3 for controlled deployments, but hidden retries are discouraged: a failed MCP result carries a stable reason so the Harness can issue at most one shorter query. Generated `tool_timeout_sec` is derived from the configured provider attempt budget plus a 15-second protocol margin.

The managed MCP returns provider response id, model, and usage in application-owned `_meta.commercePilotUsage`; Gateway records it as `commerce_web_mcp`. The legacy host compatibility path records `commerce_web_tool`. If the provider omits usage, the immutable request row is retained with `usage_status=missing` and zero placeholder counts so operations can alert and reconcile it later.

Start a thread with that provider:

```bash
curl -X POST http://127.0.0.1:8787/api/threads \
  -H 'Content-Type: application/json' \
  -H 'X-Commerce-Tenant-Id: TENANT_UUID' \
  -H 'X-Commerce-Workspace-Id: WORKSPACE_UUID' \
  -H 'X-Commerce-User-Id: USER_ID' \
  -d '{"model": "gpt-5.6-sol"}'
```

This is loopback-only protocol diagnostics with the internal token deliberately unset. Production uses the authenticated BFF and never trusts browser-supplied scope headers. The gateway passes `modelProvider` to `thread/start`; the Codex App Server process resolves the provider definition from its effective Codex config.

## Built-In Provider IDs

Custom provider IDs must not reuse reserved built-ins such as:

- `openai`
- `ollama`
- `lmstudio`

Use a project-specific provider id such as `commerce_proxy`, `azure_commerce`, or `local_commerce`.

## Security Rules

- Do not commit provider API keys.
- Use `env_key` or command-backed auth for secrets.
- Do not echo tokens in gateway logs or SSE events.
- Never return provider keys to the browser or write them to `config.toml`.
- Generated images are exposed to the browser only through an authenticated, filename-constrained BFF route.
- Web Search runs through the application-owned `commerce_web.search` MCP server against the configured provider; credentials and raw provider responses remain server-side. Native Responses search remains enabled where available, and the legacy dynamic handler is compatibility-only.
- Keep write-capable commerce tools behind explicit approval and readback.
- Provider identity, `cwd`, sandbox, permissions, instructions, raw input items, and tool definitions are server-owned and cannot be overridden by browser requests.
- The model can call only tools in the Commerce Pilot registry; it cannot use shell or deployment-host files as a fallback.
- Harness usage, including native image generation, is recorded from Codex 0.150.1 `rawResponse/completed`; managed MCP and legacy host Web Search have separate source-attributed rows. Cached input and cache-write input remain subsets of input, and reasoning output remains a subset of output; do not add those classifications twice or infer currency cost without an effective provider/contract rate card and provider reconciliation.

See [Enterprise Tenancy Foundation](../architecture/enterprise-tenancy.md) for the exact usage fields, idempotency rule, contract quotas, and tenant-dedicated runtime boundary.
