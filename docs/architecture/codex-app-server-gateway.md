# Codex App Server Gateway

This repository is a web application. It integrates Codex through a server-side gateway that runs `codex app-server --listen stdio://`.

The product UI is browser-based. Do not convert this architecture into Electron, Tauri, a native desktop shell, or an IDE-extension-first product. The web backend owns the Codex App Server process and exposes product-safe HTTP/SSE APIs to the browser.

Deployment must be self-contained at the application layer. A target server may have only Node.js, npm, environment variables, mounted secrets, and persistent volumes. It must not be required to have a preinstalled global Codex CLI or a developer-owned `~/.codex` directory.

## Boundary

The gateway owns:

- resolving the application-owned Codex runtime binary, normally `./node_modules/.bin/codex`
- starting and stopping the local App Server process
- JSON-RPC request/response correlation
- server-initiated request capture
- SSE event fan-out for the browser product UI
- commerce-specific defaults and metadata
- the application tool allowlist and fail-closed host-tool dispatcher
- the fixed runtime root, provider identity, sandbox, and approval policy
- service-to-service authentication between the Next.js BFF and Gateway

Codex App Server still owns:

- thread lifecycle
- turn lifecycle
- streamed execution events
- sandbox and permission policy
- persisted Codex history/state
- application-registered dynamic tool call lifecycle

The gateway must not replace App Server with a custom agent loop.

## Transport

Use `stdio://` for the first integration because it avoids exposing the experimental WebSocket transport. The backend process is the only direct App Server client. Browser UI must call the commerce gateway.

## Runtime Packaging

The web application declares `@openai/codex` as a production dependency. In deployment, install dependencies with the same lockfile used in development and run the gateway from the application root so it resolves:

```text
./node_modules/.bin/codex
```

`CODEX_BIN` is an explicit override for controlled deployments that provide a separately built App Server binary. It is not the default production assumption.

`CODEX_HOME` should point to app-owned persistent storage, for example:

```text
/var/lib/shueho-commerce-pilot/codex
```

Provider config, auth state, durable Codex runtime state, generated images, and per-image artifact metadata belong there or in mounted secret/config files. Each generated image artifact is bound to its originating `threadId` and `turnId`; BFF image reads must re-check the authenticated user's thread ownership before proxying bytes.

Threads run from `$CODEX_HOME/workspaces/default`, not `/app`, the source repository, or a browser-provided path. The generated config disables host-development tools. The capability allowlist contains the managed `commerce_web.search` MCP tool, `commerce_image.generate`, native provider Web Search when available, and bounded multi-agent collaboration; future commerce tools must be added to the application registry explicitly.

For the custom CPA provider, Web Search is served by an application-owned stdio MCP server named `commerce_web`. Its only enabled tool is the read-only `search(query)` contract; the process path, cwd, forwarded environment-variable names, tool allowlist, automatic approval mode, startup timeout, and tool timeout are generated under application-owned `$CODEX_HOME`. App Server owns selection and `mcpToolCall` lifecycle, while the MCP server calls the provider's OpenAI-compatible `/v1/responses` Web Search capability and returns cited sources. This MCP boundary is used because App Server currently fixes `dynamicTools` at `thread/start`; resumed older threads cannot acquire a new dynamic tool, but they do load current managed MCP configuration. Native `web_search = "live"` stays enabled where the provider/runtime can use it, and the former dynamic handler remains fail-closed compatibility code for already-persisted definitions.

Gateway does not infer MCP readiness from generated config. Before listening, it calls App Server `config/mcpServer/reload`, which refreshes loaded threads, and requires `mcpServerStatus/list(detail=toolsAndAuthOnly)` to expose `commerce_web.search`. The same guard runs before thread start/resume after an App Server restart. `/health` returns the current App Server MCP state, tool names, check time, and sanitized error; unavailable required MCP makes health and thread operations fail closed. Provider timeout/5xx/429 failures receive one bounded internal retry, and the generated MCP `tool_timeout_sec` covers the configured total attempt budget.

The built-in local-path `view_image` tool remains disabled while App Server shares a filesystem namespace with the host. Image understanding must use a tenant-scoped upload/artifact id or an App Server worker whose only image mount is the tenant artifact volume.

Hooks use an application-owned development mode and a managed-only production mode. The Gateway generates one fixed Hook runner under `$CODEX_HOME/managed-hooks` and registers it for prompt, tool, permission, compaction, stop, session, and subagent lifecycle events. `PreToolUse` denies tools outside the Commerce Pilot/Multi-agent allowlist, and `PermissionRequest` always denies host permission escalation. Other initial handlers record only event name, session/turn id, agent type, tool name, decision, and timestamp; they never persist prompt text, tool arguments/results, secrets, or PII.

Browser input, tenant files, project-local `.codex`, plugins, and user uploads may not define Hook commands. Production installs `/etc/codex/requirements.toml` with `allow_managed_hooks_only = true` and a fixed managed directory. Local development has no writable system requirements layer, so Gateway adds `config.bypass_hook_trust = true` only to the server-created `thread/start` request; the browser cannot supply or override thread config, and project/plugin Hook sources remain unavailable.

Interactive turns have a server-enforced deadline (`COMMERCE_AGENT_MAX_TURN_DURATION_MS`, default 10 minutes). Long-running commerce work must use an application tool that creates a background job and returns a tenant-scoped job id; it must not keep an interactive App Server turn open indefinitely.

## Context Compaction

Conversation compaction remains owned by Codex App Server. Gateway listens to `thread/tokenUsage/updated` and compares the latest active input-token count with the model-provided context window. After a completed user turn reaches `COMMERCE_AGENT_AUTO_COMPACT_THRESHOLD_PERCENT` (default `75`), Gateway calls `thread/compact/start`; it never creates or injects an application-authored summary. Codex emits a dedicated compact turn and a `contextCompaction` item through the normal `turn/*` and `item/*` stream, while managed `PreCompact` and `PostCompact` Hooks record metadata-only lifecycle events.

Compaction is mutually exclusive per thread. Gateway rejects a new turn for that thread while its compact turn is active, but other threads remain independent. The compact turn is limited by `COMMERCE_AGENT_COMPACTION_TIMEOUT_MS` (default three minutes). The model's own default auto-compaction threshold remains enabled as a final context-window safeguard.

The authenticated manual route is intentionally narrow: BFF verifies thread ownership and maps `POST /api/agent/threads/:threadId/compact` to the fixed Gateway `POST /api/threads/:threadId/compact`, which can only invoke App Server `thread/compact/start`. There is no browser-provided prompt, raw history, config override, or generic JSON-RPC method.

## Queue And In-Turn Steering

Running-turn submissions use the experimental App Server thread queue instead of browser-local state. Commerce Pilot maps its authenticated routes to `thread/queue/add`, `thread/queue/list`, `thread/queue/update`, and `thread/queue/delete`; `thread/queue/changed` causes clients to re-read the authoritative queue. The queue supports up to the Harness-defined capacity and drains through normal Codex turn lifecycle behavior.

A queued row's “调整方向” action uses App Server `turn/steer` with the queued input, its existing `clientUserMessageId`, and the exact `expectedTurnId`. Following Codex's open-source immediate-steer path, the Gateway then calls `turn/interrupt`; after the old turn emits `turn/completed` with `interrupted`, the still-uncommitted pending steer is restored and submitted as the next Harness turn. This prevents the superseded instruction from continuing to a final answer. The Gateway serializes these transitions per thread, removes the selected item from the ordinary queue, and moves it into a distinct FIFO pending-steer registry before steering. The registry is persisted under application-owned `CODEX_HOME` with owner-only permissions. If a queue item was already auto-started while the UI still held a stale active turn id, Gateway reconciles its `clientUserMessageId` against Harness history and returns `alreadyStarted` instead of displaying an error or submitting it twice. App Server restart or Gateway recovery also checks persisted Harness history before restoring every still-uncommitted pending steer exactly once. Steering cannot override model, cwd, sandbox, permissions, tools, or output schema. Queue CRUD, steer, interrupt, and recovery requests all repeat thread ownership and active-turn preconditions at BFF and Gateway boundaries.

## HTTP Surface

- `GET /health`
- `GET /api/codex/events`
- `GET /api/models`
- `GET /api/generated-images/:filename`
- `POST /api/images/generations`
- `POST /api/threads`
- `GET /api/threads/:threadId`
- `POST /api/threads/:threadId/compact`
- `POST /api/threads/:threadId/turns`
- `GET /api/threads/:threadId/queue`
- `POST /api/threads/:threadId/queue`
- `PATCH /api/threads/:threadId/queue/:queuedSubmissionId`
- `DELETE /api/threads/:threadId/queue/:queuedSubmissionId`
- `POST /api/threads/:threadId/queue/:queuedSubmissionId/steer`
- `POST /api/threads/:threadId/turns/:turnId/interrupt`

There is intentionally no generic RPC, process, shell, filesystem, config-import, or server-request response endpoint.

The authenticated BFF keeps only a tenant/user-owned thread index in PostgreSQL. `GET /api/threads/:threadId` first calls Gateway-managed `thread/resume` with fixed runtime policy, current MCP configuration, and `config.web_search = "live"`, then reads persisted turns with `thread/read`. Resume must happen before read so the managed MCP catalog and current runtime overrides are loaded before the thread becomes active. The same resume guard runs before `turn/start`. This also prevents stale browser thread ids from producing `thread not found` when the rollout still exists.

Different threads may have active turns concurrently. Gateway tracks loaded threads and per-turn deadlines independently. The BFF marks a thread running after `turn/start`; the sidebar polls and reconciles only running records with `thread/read`. Closing one browser SSE subscription or switching conversations does not interrupt that thread.

## Approval And Server Requests

When Codex sends `item/tool/call`, the Gateway dispatches it only if its namespace and tool name exist in the Commerce Pilot dynamic-tool compatibility registry. The current handler is `commerce_image.generate`; the former `commerce_web.search` handler is retained for persisted legacy definitions. Current Web Search calls use the managed MCP server and arrive as `mcpToolCall` items. Unknown tools are rejected. Other App Server requests are rejected unless explicitly implemented by application code. Commerce write operations need dedicated approval endpoints, tenant authorization, idempotency, audit, and downstream readback; a generic server-request response API is prohibited.
