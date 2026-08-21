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

Provider config, auth state, and durable Codex runtime state belong there or in mounted secret/config files.

Threads run from `$CODEX_HOME/workspaces/default`, not `/app`, the source repository, or a browser-provided path. The generated config disables host-development tools. The capability allowlist contains `commerce_image.generate`, the provider-backed `commerce_web.search` dynamic tool, and bounded multi-agent collaboration; future commerce tools must be added to the application registry explicitly.

For the custom CPA provider, Web Search is not assumed to appear merely because Codex config enables the first-party hosted capability. Gateway registers `commerce_web.search` in `dynamicTools`; its handler calls the provider's `/v1/responses` endpoint with the OpenAI-compatible `web_search` tool and returns cited sources through `item/tool/call`. Codex still owns tool selection, the dynamic-tool item lifecycle, streaming, and turn continuation. The same registry is supplied when a persisted thread is resumed after a Gateway restart.

The built-in local-path `view_image` tool remains disabled while App Server shares a filesystem namespace with the host. Image understanding must use a tenant-scoped upload/artifact id or an App Server worker whose only image mount is the tenant artifact volume.

Hooks use an application-owned development mode and a managed-only production mode. The Gateway generates one fixed Hook runner under `$CODEX_HOME/managed-hooks` and registers it for prompt, tool, permission, compaction, stop, session, and subagent lifecycle events. `PreToolUse` denies tools outside the Commerce Pilot/Multi-agent allowlist, and `PermissionRequest` always denies host permission escalation. Other initial handlers record only event name, session/turn id, agent type, tool name, decision, and timestamp; they never persist prompt text, tool arguments/results, secrets, or PII.

Browser input, tenant files, project-local `.codex`, plugins, and user uploads may not define Hook commands. Production installs `/etc/codex/requirements.toml` with `allow_managed_hooks_only = true` and a fixed managed directory. Local development has no writable system requirements layer, so Gateway adds `config.bypass_hook_trust = true` only to the server-created `thread/start` request; the browser cannot supply or override thread config, and project/plugin Hook sources remain unavailable.

Interactive turns have a server-enforced deadline (`COMMERCE_AGENT_MAX_TURN_DURATION_MS`, default 10 minutes). Long-running commerce work must use an application tool that creates a background job and returns a tenant-scoped job id; it must not keep an interactive App Server turn open indefinitely.

## HTTP Surface

- `GET /health`
- `GET /api/codex/events`
- `GET /api/models`
- `GET /api/generated-images/:filename`
- `POST /api/images/generations`
- `POST /api/threads`
- `GET /api/threads/:threadId`
- `POST /api/threads/:threadId/turns`
- `POST /api/threads/:threadId/turns/:turnId/interrupt`

There is intentionally no generic RPC, process, shell, filesystem, config-import, or server-request response endpoint.

The authenticated BFF keeps only a tenant/user-owned thread index in PostgreSQL. `GET /api/threads/:threadId` reads persisted turns from App Server; after a Gateway/App Server restart, the first follow-up calls `thread/resume` with the fixed runtime policy before `turn/start`. This prevents stale browser thread ids from producing `thread not found` when the rollout still exists.

Different threads may have active turns concurrently. Gateway tracks loaded threads and per-turn deadlines independently. The BFF marks a thread running after `turn/start`; the sidebar polls and reconciles only running records with `thread/read`. Closing one browser SSE subscription or switching conversations does not interrupt that thread.

## Approval And Server Requests

When Codex sends `item/tool/call`, the Gateway dispatches it only if its namespace and tool name exist in the Commerce Pilot registry. The current read-only handlers are `commerce_web.search` and `commerce_image.generate`. Unknown tools are rejected. Other App Server requests are rejected unless explicitly implemented by application code. Commerce write operations need dedicated approval endpoints, tenant authorization, idempotency, audit, and downstream readback; a generic server-request response API is prohibited.
