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
- tenant/runtime scope validation and the production tenant pin
- active runtime reauthorization and fail-closed revocation
- BFF-owned admission for automatic and Harness-initiated compaction
- durable delivery of scoped usage and terminal-turn events to the BFF

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

`CODEX_HOME` should point to app-owned, tenant-dedicated persistent storage, for example:

```text
/var/lib/shueho-commerce-pilot/tenants/TENANT_ID/codex
```

Provider config, auth state, durable Codex runtime state, generated images, event outbox, and per-image artifact metadata belong there or in tenant-specific mounted secret/config files. Each generated image artifact is bound to its originating `threadId` and `turnId`; BFF image reads must re-check the authenticated tenant, workspace, and thread creator before proxying bytes.

Threads run from `$CODEX_HOME/workspaces/default`, not `/app`, the source repository, or a browser-provided path. The generated config disables host-development tools. The capability allowlist contains the managed `commerce_web.search` MCP tool, `commerce_image.generate`, approval-gated `commerce_skill.publish`, native provider Web Search when available, and bounded multi-agent collaboration; future commerce tools must be added to the application registry explicitly. `agents.max_concurrent_threads_per_session` is fixed from `COMMERCE_AGENT_MAX_THREADS_PER_SESSION` (default `4`, range `1-16`) and must not exceed the tenant contract.

For the custom CPA provider, Web Search is served by an application-owned stdio MCP server named `commerce_web`. Its only enabled tool is the read-only `search(query)` contract; the process path, cwd, forwarded environment-variable names, tool allowlist, automatic approval mode, startup timeout, and tool timeout are generated under application-owned `$CODEX_HOME`. App Server owns selection and `mcpToolCall` lifecycle, while the MCP server calls the provider's OpenAI-compatible `/v1/responses` Web Search capability and returns cited sources. This MCP boundary is used because App Server currently fixes `dynamicTools` at `thread/start`; resumed older threads cannot acquire a new dynamic tool, but they do load current managed MCP configuration. Native `web_search = "live"` stays enabled where the provider/runtime can use it, and the former dynamic handler remains fail-closed compatibility code for already-persisted definitions.

Gateway does not infer MCP readiness from generated config. Before listening, it calls App Server `config/mcpServer/reload`, which refreshes loaded threads, and requires `mcpServerStatus/list(detail=toolsAndAuthOnly)` to expose `commerce_web.search`. The same guard runs before thread start/resume after an App Server restart. `/health` returns the current App Server MCP state, tool names, check time, and sanitized error; unavailable required MCP makes health and thread operations fail closed. Provider timeout/5xx/429 failures receive one bounded internal retry, and the generated MCP `tool_timeout_sec` covers the configured total attempt budget.

The built-in arbitrary local-path `view_image` tool remains disabled. Image understanding uses the tenant-scoped attachment pipeline: the browser submits only files and later artifact ids, Gateway stores them below `$CODEX_HOME/thread_artifacts/<threadId>`, rechecks tenant/thread/request ownership, and sends App Server a native `localImage` path from the dedicated artifact volume. Browser events strip that path before SSE fan-out. Production App Server must mount only the tenant runtime/artifact volume, never the deployment host filesystem.

Hooks use an application-owned development mode and a managed-only production mode. The Gateway generates one fixed Hook runner under `$CODEX_HOME/managed-hooks` and registers it for prompt, tool, permission, compaction, stop, session, and subagent lifecycle events. `PreToolUse` denies tools outside the Commerce Pilot/Multi-agent allowlist, and `PermissionRequest` always denies host permission escalation. Other initial handlers record only event name, session/turn id, agent type, tool name, decision, and timestamp; they never persist prompt text, tool arguments/results, secrets, or PII.

Browser input, tenant files, project-local `.codex`, plugins, and user uploads may not define Hook commands. Production installs `/etc/codex/requirements.toml` with `allow_managed_hooks_only = true` and a fixed managed directory. Local development has no writable system requirements layer, so Gateway adds `config.bypass_hook_trust = true` only to the server-created `thread/start` request; the browser cannot supply or override thread config, and project/plugin Hook sources remain unavailable.

Interactive turns have a server-enforced deadline (`COMMERCE_AGENT_MAX_TURN_DURATION_MS`, default 10 minutes). Long-running commerce work must use an application tool that creates a background job and returns a tenant-scoped job id; it must not keep an interactive App Server turn open indefinitely.

Managed MCP readiness has two levels. Global `mcpServerStatus/list` proves that App Server discovered the required server, while resumed persisted threads must be verified separately with `mcpServerStatus/list.threadId`. After `thread/resume`, Gateway invokes `config/mcpServer/reload`, waits until that exact thread exposes `commerce_web.search`, and fails the turn start with `503` if it does not. App Server process exit and per-thread MCP startup failures invalidate this cache. This follows the App Server contract that reload queues refreshes for loaded threads; a global-ready catalog must never be treated as proof that an older thread received a newly configured MCP tool.

## Enterprise Runtime Scope

The authenticated BFF resolves the customer's organization and its one-to-one tenant, then derives tenant, workspace, and user ids from the session and active memberships. Organization is a commercial/control-plane identity; the tenant id is the runtime security selector forwarded over the authenticated internal service connection. These values are not accepted from browser input. Gateway requires tenant, workspace, and user, binds every loaded root thread to that scope, rejects scope changes as `404`, and propagates the root scope to subagent threads.

Production additionally requires `COMMERCE_RUNTIME_TENANT_ID`. A Gateway whose pin does not match the BFF tenant fails the request instead of multiplexing another company into the same App Server or `CODEX_HOME`. The current BFF has a static `COMMERCE_GATEWAY_URL`; production therefore needs a customer-specific stack/route until a tenant-aware runtime manager is implemented.

Gateway continuously polls the private `COMMERCE_AGENT_AUTHORIZATION_URL` for active root scopes. The BFF rechecks organization, tenant, workspace, memberships, contract term, creator ownership, and effective `agent.run`. Denial or callback failure interrupts every active root/subagent turn, clears queued root input, and emits `commerce/authorization/revoked`. Host Web Search and image tools also reauthorize directly before their external call.

The Gateway enables raw experimental App Server events for metering. Each Codex 0.149 `rawResponse/completed` event produces one scoped Harness usage event with the exact `totalTokens`, `inputTokens`, `cachedInputTokens`, `cacheWriteInputTokens`, `outputTokens`, and `reasoningOutputTokens` fields. Managed MCP Web Search and application host Web Search/image calls produce separately attributed provider-usage rows. Missing provider usage is recorded with `usageStatus=missing`, not silently interpreted as free. `turn/completed` produces an idempotent terminal event that updates thread state and releases the application turn lease.

Events are atomically persisted to `$CODEX_HOME/commerce-runtime/agent-event-outbox.json` before delivery to `COMMERCE_AGENT_EVENT_SINK_URL`. Delivery uses `COMMERCE_GATEWAY_INTERNAL_TOKEN`, exponential backoff capped at 60 seconds, and batch acknowledgement. Permanent `400/404/409/422` sink failures move to `$CODEX_HOME/commerce-runtime/agent-event-dead-letter.json`; health exposes pending and dead-letter counts. The BFF re-checks root tenant/workspace/creator binding, while PostgreSQL deduplicates usage and terminal events. Signal shutdown waits for pending writes, flushes the files, attempts final delivery, and flushes again before exit.

See [Enterprise Tenancy Foundation](./enterprise-tenancy.md) for accounting rules, quota semantics, RLS, current limitations, and the deployment boundary.

## Context Compaction

Conversation compaction remains owned by Codex App Server. Gateway listens to `thread/tokenUsage/updated` and compares the cumulative `tokenUsage.total.totalTokens` with the model-provided context window. It does not use `last`, which represents only the most recent provider completion. Codex emits a dedicated compact turn and a `contextCompaction` item through the normal `turn/*` and `item/*` stream, while managed `PreCompact` and `PostCompact` Hooks record metadata-only lifecycle events.

Compaction is mutually exclusive per thread. Gateway rejects a new turn for that thread while its compact turn is active, but other threads remain independent. The compact turn is limited by `COMMERCE_AGENT_COMPACTION_TIMEOUT_MS` (default three minutes). The model's own default auto-compaction threshold remains enabled as a final context-window safeguard.

Independent manual and automatic compact turns are admitted as root jobs. The authenticated manual route verifies `thread.compact`, reserves a BFF lease, and maps only to App Server `thread/compact/start`; automatic compaction reserves through `COMMERCE_AGENT_ADMISSION_URL`. A Harness-initiated inline `contextCompaction` first attaches to the active root turn's existing lease; only a standalone Harness compact without such a lease reserves another slot. Denial/failure interrupts that compact turn. Terminal events carry any independent admission UUID so a completion-before-activation race can still release the lease. There is no browser-provided prompt, raw history, config override, or generic JSON-RPC method.

## Queue And In-Turn Steering

Running-turn submissions use the experimental App Server thread queue instead of browser-local state. Commerce Pilot maps its authenticated routes to `thread/queue/add`, `thread/queue/list`, `thread/queue/update`, and `thread/queue/delete`; `thread/queue/changed` causes clients to re-read the authoritative queue. The Gateway additionally caps each thread at 50 queued messages and 500,000 UTF-8 bytes, while the BFF applies a per-user queue-add rate bucket.

A queued row's “调整方向” action uses App Server `turn/steer` with the queued input, its existing `clientUserMessageId`, and the exact `expectedTurnId`. Following Codex's open-source immediate-steer path, the Gateway then calls `turn/interrupt`; after the old turn emits `turn/completed` with `interrupted`, the still-uncommitted pending steer is restored and submitted as the next Harness turn. This prevents the superseded instruction from continuing to a final answer. The Gateway serializes these transitions per thread, removes the selected item from the ordinary queue, and moves it into a distinct FIFO pending-steer registry before steering. The registry is persisted under application-owned `CODEX_HOME` with owner-only permissions. If a queue item was already started while the UI still held a stale active turn id, Gateway reconciles its `clientUserMessageId` against Harness history and returns `alreadyStarted` instead of displaying an error or submitting it twice. Steering cannot override model, cwd, sandbox, permissions, tools, or output schema. Queue CRUD, steer, interrupt, and recovery requests all repeat thread ownership and active-turn preconditions at BFF and Gateway boundaries.

The BFF reserves a tenant-wide quota/concurrency lease before asking Gateway to execute the steer. The queued item's stable client UUID is the tenant-scoped request id. A released or expired waiting reservation can be replaced for this authorized retry, while a reserved/active duplicate fails closed. When Gateway returns a new turn id, BFF activates the lease and records the thread as running; a non-starting result releases it. An ambiguous upstream failure leaves the short reservation in place until expiry because releasing it could admit excess work after Gateway actually accepted the turn.

Recovery distinguishes durable input from authorization to spend. During a live, already-authorized steer transition, Gateway can restore the selected item at the front and start it after the interrupted turn completes. After Gateway/App Server restart, it checks committed Harness history, restores each still-uncommitted item to the front of the durable queue exactly once, persists the new registry state, and passes `startWhenIdle = false`. Recovery therefore never auto-starts billable work; the user must make a fresh authenticated BFF request that passes quota admission.

Outbox maintenance is single-writer. Gateway holds an exclusive process lock in its tenant `CODEX_HOME`; `npm run events:requeue-dead-letter` refuses to run while that Gateway is alive, acquires the same lock for maintenance, requeues every dead letter without truncation, persists, and releases it. Stop and drain the tenant Gateway before invoking the command.

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

There is intentionally no generic RPC, process, shell, filesystem, config-import, server-request response, or direct image-generation endpoint. Production clients use authenticated BFF routes, which add the service token and server-resolved Enterprise scope; images can be created only by the authorized Agent host tool.

The authenticated BFF keeps only a tenant/workspace/creator-owned thread index in PostgreSQL. `GET /api/threads/:threadId` first calls Gateway-managed `thread/resume` with fixed runtime policy, current MCP configuration, and `config.web_search = "live"`, then reads persisted turns with `thread/read`. Resume must happen before read so the managed MCP catalog and current runtime overrides are loaded before the thread becomes active. The same resume guard runs before `turn/start`. This also prevents stale browser thread ids from producing `thread not found` when the rollout still exists.

Different root jobs may have active turns concurrently. Gateway tracks loaded threads and per-turn deadlines independently. The BFF runs tenant-wide contract/quota admission before a direct start, execution-producing queue steer, or manual compact; Gateway obtains BFF admission for automatic/Harness compaction. One lease counts one root job, while inherited subagent threads are bounded separately by the default four-thread Codex session cap. Closing one browser SSE subscription or switching conversations does not interrupt the root job. Open BFF SSE streams re-check Enterprise access and creator ownership every 15 seconds and fail closed after revocation.

## Approval And Server Requests

When Codex sends `item/tool/call`, the Gateway dispatches it only if its namespace and tool name exist in the Commerce Pilot dynamic-tool compatibility registry. The current handler is `commerce_image.generate`; the former `commerce_web.search` handler is retained for persisted legacy definitions. Each host-tool call reauthorizes its root scope before provider access. Current Web Search calls use the managed MCP server and arrive as `mcpToolCall` items, whose provider usage metadata is recorded separately. Unknown tools are rejected. Other App Server requests are rejected unless explicitly implemented by application code. Commerce write operations need dedicated approval endpoints, tenant authorization, idempotency, audit, and downstream readback; a generic server-request response API is prohibited.
