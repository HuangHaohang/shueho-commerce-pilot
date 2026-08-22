# Custom Model Providers

Codex App Server can use custom model providers configured through the Codex config visible to the app-owned runtime.

## Where To Configure Providers

For local development, provider definitions can live in:

- `~/.codex/config.toml`
- `$CODEX_HOME/config.toml`
- `~/.codex/<profile-name>.config.toml`

For deployment, do not rely on a human developer's `~/.codex` directory. Set `CODEX_HOME` to an app-owned directory and provide:

```text
$CODEX_HOME/config.toml
```

from a mounted config file, secret, init step, or container image layer.

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
base_url = "https://cpa.luusmosh.com/v1"
env_key = "COMMERCE_PROVIDER_API_KEY"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 4
stream_max_retries = 5
stream_idle_timeout_ms = 300000
```

Then provide the secret to the service process:

```bash
export COMMERCE_PROVIDER_API_KEY="..."
export CODEX_HOME="/var/lib/shueho-commerce-pilot/codex"
npm run dev
```

The gateway renders this definition into the application-owned `$CODEX_HOME/config.toml` at startup. The rendered TOML contains only the environment variable name, never the secret value.

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

## Image Generation

The app-owned Codex runtime synchronizes the built-in `imagegen` system skill and enables `features.image_generation`. Third-party App Server clients do not automatically receive the first-party image executor, so Commerce Pilot supplies a host dynamic tool through the harness `dynamicTools` and `item/tool/call` protocol:

```text
commerce_image.generate -> POST /v1/images/generations -> gpt-image-2
```

Codex still owns image intent detection, skill instructions, prompt augmentation, tool selection, item lifecycle, and turn continuation. The gateway performs only the provider call, saves the result under `$CODEX_HOME/generated_images`, and stores non-PII artifact metadata under `$CODEX_HOME/generated_image_metadata` so `thread/read` can restore images after restart. BFF image delivery requires ownership of the artifact's thread.

The image model is fixed by `COMMERCE_IMAGE_MODEL=gpt-image-2`. Other image models returned from `/models` are not silently selected.

## Web Search

Commerce Pilot exposes provider-backed Web Search as the managed `commerce_web.search` MCP tool. The MCP server calls the same configured provider and returns grounded content plus source URLs:

```text
commerce_web.search MCP -> POST /v1/responses
                        -> tools: [{ "type": "web_search" }]
                        -> grounded answer + cited source URLs
```

The Gateway does not scrape arbitrary pages with deployment-host shell commands. It asks the configured provider to execute its OpenAI-compatible Web Search tool, returns the grounded answer and sanitized source URLs to Codex, and lets Codex continue the turn. The browser receives the App Server `mcpToolCall` lifecycle and renders `正在搜索网页` followed by a collapsible completed search activity.

The MCP capability comes from app-owned config rather than `dynamicTools`, because current App Server versions only accept dynamic tools at `thread/start`. Persisted-thread reads execute managed resume before `thread/read`, so the current MCP catalog is loaded for old conversations without rewriting history. `PreToolUse` and `PostToolUse` Hooks allow and audit the MCP tool name while recording only lifecycle metadata; queries and results are not written to the Hook audit log. Native `web_search = "live"` remains enabled as a provider-supported capability, and the old dynamic handler remains only for already-persisted threads that contain it.

Gateway calls `config/mcpServer/reload` and validates `mcpServerStatus/list` before accepting turns. Web Search uses one bounded transient retry: the first attempt is capped at 45 seconds, and later attempts use `COMMERCE_WEB_SEARCH_TIMEOUT_MS` (default 90 seconds). Set `COMMERCE_WEB_SEARCH_MAX_ATTEMPTS` from 1 to 3; the default is 2. Generated `tool_timeout_sec` is derived from the total provider attempt budget plus a 15-second protocol margin.

Start a thread with that provider:

```bash
curl -X POST http://127.0.0.1:8787/api/threads \
  -H 'Content-Type: application/json' \
  -d '{"model": "gpt-5.6-sol"}'
```

The gateway passes `modelProvider` to `thread/start`; the Codex App Server process resolves the provider definition from its effective Codex config.

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
