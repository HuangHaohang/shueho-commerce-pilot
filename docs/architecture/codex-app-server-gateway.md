# Codex App Server Gateway

This repository is a web application. It integrates Codex through a server-side gateway that runs `codex app-server --listen stdio://`.

The product UI is browser-based. Do not convert this architecture into Electron, Tauri, a native desktop shell, or an IDE-extension-first product. The web backend owns the Codex App Server process and exposes product-safe HTTP/SSE APIs to the browser.

Deployment must be self-contained at the application layer. A target server may have only Node.js, npm, environment variables, mounted secrets, and persistent volumes. It must not be required to have a preinstalled global Codex CLI or a developer-owned `~/.codex` directory.

## Source Conformance Baseline

The protocol/development fallback dependency is pinned to `@openai/codex` `0.150.1`. The production runtime is the application-owned `shueho.1` patch set built from `openai/codex` tag `rust-v0.150.1`, commit `90854393966b21e9ebfd21b122334eb09a20c93d`. `vendor/codex/upstream.json`, the hash-checked patch series, upstream license/notice, binary manifest and resolver form one fail-closed runtime identity. Runtime changes must be checked against `codex-rs/app-server`, `codex-rs/app-server-protocol`, and their tests before local abstractions are introduced.

| Concern | Required Codex-owned path | Commerce Pilot responsibility |
|---|---|---|
| Conversation | `thread/start`, `thread/resume`, `thread/read`, `thread/delete` | Authentication, tenant binding, safe projection |
| Work cycle | `turn/start`, `turn/interrupt`, `turn/completed` | Admission, deadlines, authenticated commands |
| Streaming | `item/started`, deltas, `item/completed` | Sanitization and SSE fan-out |
| Model questions | `item/tool/requestUserInput`, client response, `serverRequest/resolved` | Authenticated presentation and answer validation |
| Client-hosted tools | `dynamicTools` plus `item/tool/call` request/response | Tool implementation, RBAC, business approval, audit, readback |
| Managed MCP | App Server MCP catalog and `mcpToolCall` items | App-owned server config and provider adapter |
| Queue | `thread/queue/*` and `thread/queue/changed` | Capacity, product ordering commands, authorization |
| Context | `thread/tokenUsage/updated`, `thread/compact/start`, `contextCompaction` | Threshold and quota admission only |
| Skills | `skills/list`, native `skill` input item | Safe catalog projection and managed publication |
| Multi-agent | Codex collaboration tools and child-thread events | Inherited tenant policy and concurrency cap |

`npm run codex:protocol:generate` invokes the pinned App Server's `generate-ts --experimental` command before checks and builds. Gateway requests import those generated parameter types, so unsupported fields such as `thread/resume.dynamicTools` fail compilation instead of being silently ignored. The generated tree is a build artifact and is not hand-edited.

Direct model calls are limited to non-agent product utilities such as title generation. They must not own thread state, iterate tool calls, summarize conversation state, generate Agent-requested images, or continue user Turns. There is no application-authored agent loop.

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
- model-originated `request_user_input` and `serverRequest/resolved`
- thread queue, interruption, steering, compaction, and multi-agent lifecycle

The gateway must not replace App Server with a custom agent loop.

## Transport

Use `stdio://` for the first integration because it avoids exposing the experimental WebSocket transport. The backend process is the only direct App Server client. Browser UI must call the commerce gateway.

## Runtime Packaging

The web application keeps `@openai/codex` as a protocol-generation and local-development fallback. Production builds the reviewed open-source patch into a root-owned binary and sets `CODEX_BIN` to it. The adjacent manifest fixes upstream commit, patch revision and SHA-256, platform target, binary hash, version, and license/notice hashes. Production refuses to start or generate protocol bindings when that identity is absent or altered; it never falls back to npm or a global executable.

```text
./node_modules/.bin/codex
```

The managed artifact is installed at `.runtime/bin/<platform>` for development or `/opt/shueho-codex/bin` in the production image. `npm run codex:runtime:build`, `codex:runtime:install`, and `codex:runtime:verify` share the same manifest/patch verifier used by Gateway and protocol generation.

`CODEX_HOME` should point to app-owned, tenant-dedicated persistent storage, for example:

```text
/var/lib/shueho-commerce-pilot/tenants/TENANT_ID/codex
```

Provider config, auth state, durable Codex runtime state, generated images, event outbox, and per-image artifact metadata belong there or in tenant-specific mounted secret/config files. Each generated image artifact is bound to its originating `threadId` and `turnId`; BFF image reads must re-check the authenticated tenant, workspace, and thread creator before proxying bytes.

Codex App Server intentionally gates image capabilities to Codex-backed or actor-authorized Providers. Commerce Pilot therefore renders the custom Provider base URL as an actor-authenticated loopback route on the private Gateway. The Gateway verifies a tenant/provider-scoped HMAC-derived actor credential, accepts only `models`, `responses`, `responses/compact`, `images/generations`, and `images/edits`, strips the actor header, injects `COMMERCE_PROVIDER_API_KEY`, and streams the one upstream response. The `shueho.1` Harness patch also projects a completed Provider-hosted Responses `image_generation_call` into `ItemStarted`/`ItemCompleted` `imageGeneration` events and replay history. It does not execute another tool or Provider request. Gateway still persists only the native Item and never parses rollout files or fabricates protocol Items.

Threads run from `$CODEX_HOME/workspaces/default`, not `/app`, the source repository, or a browser-provided path. The generated config disables host-development tools. The capability allowlist contains the managed `commerce_web.search` MCP tool, native `image_gen`, approval-gated `commerce_skill.publish`, configured governed `commerce_data` tools, native provider Web Search when available, and bounded multi-agent collaboration; future commerce tools must be added to the application registry explicitly. `agents.max_concurrent_threads_per_session` is fixed from `COMMERCE_AGENT_MAX_THREADS_PER_SESSION` (default `4`, range `1-16`) and must not exceed the tenant contract.

For the custom CPA provider, Web Search is served by an application-owned stdio MCP server named `commerce_web`. Its only enabled tool is the read-only `search(query)` contract; the process path, cwd, forwarded environment-variable names, tool allowlist, automatic approval mode, startup timeout, and tool timeout are generated under application-owned `$CODEX_HOME`. App Server owns selection and `mcpToolCall` lifecycle, while the MCP server calls the provider's OpenAI-compatible `/v1/responses` Web Search capability and returns cited sources. This MCP boundary is used because App Server currently fixes `dynamicTools` at `thread/start`; resumed older threads cannot acquire a new dynamic tool, but they do load current managed MCP configuration. Native `web_search = "live"` stays enabled where the provider/runtime can use it, and the former dynamic handler remains fail-closed compatibility code for already-persisted definitions.

Gateway does not infer MCP readiness from generated config. Before listening, it calls App Server `config/mcpServer/reload`, which refreshes loaded threads, and requires `mcpServerStatus/list(detail=toolsAndAuthOnly)` to expose `commerce_web.search`. The same guard runs before thread start/resume after an App Server restart. `/health` returns the current App Server MCP state, tool names, dedicated search model, check time, and sanitized error; unavailable required MCP makes health and thread operations fail closed. The default sourced-search path uses `gpt-5.6-luna`, one 30-second provider attempt, and a generated MCP protocol margin. A timeout is returned as a structured failed `mcpToolCall`; the Harness may issue at most one new, shorter query instead of the MCP server invisibly repeating the same expensive request.

Agent answers remain App Server `agentMessage` Markdown. Codex 0.150.1 does not define a generic table ThreadItem; its TUI enables GFM table parsing and performs width-aware table layout in the client. Commerce Pilot follows that boundary: the browser renders semantic GFM tables and responsive overflow while App Server remains the owner of message and Turn lifecycle. Domain-specific structured `outputSchema` remains available for true product artifacts, not as a replacement for ordinary research Markdown.

The built-in arbitrary local-path `view_image` tool remains disabled. Image understanding uses the tenant-scoped attachment pipeline: the browser submits only files and later artifact ids, Gateway stores them below `$CODEX_HOME/thread_artifacts/<threadId>`, rechecks tenant/thread/request ownership, and sends App Server a native `localImage` path from the dedicated artifact volume. Browser events strip that path before SSE fan-out. Production App Server must mount only the tenant runtime/artifact volume, never the deployment host filesystem.

Hooks use an application-owned development mode and a managed-only production mode. The Gateway generates one fixed Hook runner under `$CODEX_HOME/managed-hooks` and registers it for prompt, tool, permission, compaction, stop, session, and subagent lifecycle events. `PreToolUse` permits native `image_gen` but denies tools outside the Commerce Pilot/Multi-agent allowlist, and `PermissionRequest` always denies host permission escalation. Other initial handlers record only event name, session/turn id, agent type, tool name, decision, and timestamp; they never persist prompt text, tool arguments/results, secrets, or PII.

Browser input, tenant files, project-local `.codex`, plugins, and user uploads may not define Hook commands. Production installs `/etc/codex/requirements.toml` with `allow_managed_hooks_only = true` and a fixed managed directory. Local development has no writable system requirements layer, so Gateway adds `config.bypass_hook_trust = true` only to the server-created `thread/start` request; the browser cannot supply or override thread config, and project/plugin Hook sources remain unavailable.

Interactive turns have a server-enforced deadline (`COMMERCE_AGENT_MAX_TURN_DURATION_MS`, default 10 minutes). Provider request and stream retries are both fixed to zero because a disconnected Responses request may already have executed a paid image side effect. A stream with no SSE progress for 120 seconds fails as uncertain and requires explicit user retry after authoritative readback. Long-running commerce work must use an application tool that creates a background job and returns a tenant-scoped job id; it must not keep an interactive App Server turn open indefinitely.

Managed MCP readiness has two levels. Global `mcpServerStatus/list` proves that App Server discovered the required server, while a resumed persisted thread must be verified separately with `mcpServerStatus/list.threadId` before model execution. Read-only history/status requests use `thread/read` and `thread/turns/list` directly and never call `thread/resume` or per-thread MCP reload. `turn/start` and an execution-producing direction change perform the deduplicated resume, check the existing thread MCP status first, and reload only if the thread does not naturally expose `commerce_web.search`. App Server process exit and per-thread startup failures invalidate both caches.

## Enterprise Runtime Scope

The authenticated BFF resolves the customer's organization and its one-to-one tenant, then derives tenant, workspace, and user ids from the session and active memberships. Organization is a commercial/control-plane identity; the tenant id is the runtime security selector forwarded over the authenticated internal service connection. These values are not accepted from browser input. Gateway requires tenant, workspace, and user, binds every loaded root thread to that scope, rejects scope changes as `404`, and propagates the root scope to subagent threads.

Production additionally requires `COMMERCE_RUNTIME_TENANT_ID`. A Gateway whose pin does not match the BFF tenant fails the request instead of multiplexing another company into the same App Server or `CODEX_HOME`. The current BFF has a static `COMMERCE_GATEWAY_URL`; production therefore needs a customer-specific stack/route until a tenant-aware runtime manager is implemented.

Gateway continuously polls the private `COMMERCE_AGENT_AUTHORIZATION_URL` for active root scopes. The BFF rechecks organization, tenant, workspace, memberships, contract term, creator ownership, and effective `agent.run`. Denial or callback failure interrupts every active root/subagent turn, clears queued root input, and emits `commerce/authorization/revoked`. Application-hosted commerce tools also reauthorize directly before their external call.

The Gateway enables raw experimental App Server events for metering. Each Codex 0.150.1 `rawResponse/completed` event produces one scoped Harness usage event with the exact `totalTokens`, `inputTokens`, `cachedInputTokens`, `cacheWriteInputTokens`, `outputTokens`, and `reasoningOutputTokens` fields, including native image-generation work. Managed MCP Web Search and the legacy host Web Search path produce separately attributed provider-usage rows. Missing provider usage is recorded with `usageStatus=missing`, not silently interpreted as free. `turn/completed` produces an idempotent terminal event that updates thread state and releases the application turn lease.

Events are atomically persisted to `$CODEX_HOME/commerce-runtime/agent-event-outbox.json` before delivery to `COMMERCE_AGENT_EVENT_SINK_URL`. Delivery uses `COMMERCE_GATEWAY_INTERNAL_TOKEN`, exponential backoff capped at 60 seconds, and batch acknowledgement. Permanent `400/404/409/422` sink failures move to `$CODEX_HOME/commerce-runtime/agent-event-dead-letter.json`; health exposes pending and dead-letter counts. The BFF re-checks root tenant/workspace/creator binding, while PostgreSQL deduplicates usage and terminal events. Signal shutdown waits for pending writes, flushes the files, attempts final delivery, and flushes again before exit.

See [Enterprise Tenancy Foundation](./enterprise-tenancy.md) for accounting rules, quota semantics, RLS, current limitations, and the deployment boundary.

## Context Compaction

Conversation compaction remains owned by Codex App Server. Gateway listens to `thread/tokenUsage/updated` and compares the cumulative `tokenUsage.total.totalTokens` with the model-provided context window. It does not use `last`, which represents only the most recent provider completion. Codex emits a dedicated compact turn and a `contextCompaction` item through the normal `turn/*` and `item/*` stream, while managed `PreCompact` and `PostCompact` Hooks record metadata-only lifecycle events.

Compaction is mutually exclusive per thread. Gateway rejects a new turn for that thread while its compact turn is active, but other threads remain independent. The compact turn is limited by `COMMERCE_AGENT_COMPACTION_TIMEOUT_MS` (default three minutes). The model's own default auto-compaction threshold remains enabled as a final context-window safeguard.

Independent manual and automatic compact turns are admitted as root jobs. The authenticated manual route verifies `thread.compact`, reserves a BFF lease, and maps only to App Server `thread/compact/start`; automatic compaction reserves through `COMMERCE_AGENT_ADMISSION_URL`. A Harness-initiated inline `contextCompaction` first attaches to the active root turn's existing lease; only a standalone Harness compact without such a lease reserves another slot. Denial/failure interrupts that compact turn. Terminal events carry any independent admission UUID so a completion-before-activation race can still release the lease. There is no browser-provided prompt, raw history, config override, or generic JSON-RPC method.

## Queue And Direction Changes

Running-turn submissions use the experimental App Server thread queue instead of browser-local state. Commerce Pilot maps its authenticated routes to `thread/queue/add`, `thread/queue/list`, `thread/queue/update`, and `thread/queue/delete`; `thread/queue/changed` causes clients to re-read the authoritative queue. The Gateway additionally caps each thread at 50 queued messages and 500,000 UTF-8 bytes, while the BFF applies a per-user queue-add rate bucket.

A queued row's “调整方向” action never copies or deletes the message into application state. Gateway serializes the transition per thread, verifies the queued submission and stable `clientUserMessageId`, calls `turn/interrupt`, waits for the authoritative `turn/completed`, and then passes the same queue id to `thread/queue/start`. If the Turn already ended or the queue item already started, Gateway reconciles the client id through paginated `thread/items/list` and returns `alreadyStarted`. This removes the former non-atomic `turn/steer` plus interrupt sequence and its duplicate pending-steer registry. Direction changes cannot override model, cwd, sandbox, permissions, tools, or output schema.

The BFF reserves a tenant-wide quota/concurrency lease before asking Gateway to execute the steer. The queued item's stable client UUID is the tenant-scoped request id. A released or expired waiting reservation can be replaced for this authorized retry, while a reserved/active duplicate fails closed. When Gateway returns a new turn id, BFF activates the lease and records the thread as running; a non-starting result releases it. An ambiguous upstream failure leaves the short reservation in place until expiry because releasing it could admit excess work after Gateway actually accepted the turn.

Recovery distinguishes durable input from authorization to spend. Because the selected input remains in the App Server queue until `thread/queue/start`, Gateway or network failure cannot lose it and restart recovery needs no application-owned replay file. Recovery never auto-starts queued billable work; a fresh authenticated BFF request must pass quota admission.

Outbox maintenance is single-writer. Gateway holds an exclusive process lock in its tenant `CODEX_HOME`; `npm run events:requeue-dead-letter` refuses to run while that Gateway is alive, acquires the same lock for maintenance, requeues every dead letter without truncation, persists, and releases it. Stop and drain the tenant Gateway before invoking the command.

## HTTP Surface

- `GET /health`
- `GET /api/codex/events`
- `GET /api/models`
- `GET /api/generated-images/:filename`
- `POST /api/threads`
- `GET /api/threads/:threadId`
- `GET /api/threads/:threadId/status`
- `POST /api/threads/:threadId/compact`
- `POST /api/threads/:threadId/turns`
- `GET /api/threads/:threadId/queue`
- `POST /api/threads/:threadId/queue`
- `PATCH /api/threads/:threadId/queue/:queuedSubmissionId`
- `DELETE /api/threads/:threadId/queue/:queuedSubmissionId`
- `POST /api/threads/:threadId/queue/:queuedSubmissionId/steer`
- `POST /api/threads/:threadId/turns/:turnId/interrupt`

The actor-only loopback Provider surface is separate internal infrastructure: `GET /api/internal/provider/v1/models` plus `POST` for `/responses`, `/responses/compact`, `/images/generations`, and `/images/edits`. It rejects the normal BFF token, unsupported paths, missing actor authorization, and bodies above 64 MiB.

There is intentionally no generic RPC, process, shell, filesystem, config-import, server-request response, or direct image-generation endpoint. Production clients use authenticated BFF routes, which add the service token and server-resolved Enterprise scope; images are created only inside the Harness through the namespace extension or the patched Provider-hosted Responses path. Gateway strips native base64 results and host paths before browser fan-out, stores the completed artifact, and returns only an ownership-checked URL.

The authenticated BFF keeps only a tenant/workspace/creator-owned thread index in PostgreSQL. `GET /api/threads/:threadId` reads metadata and the latest `thread/turns/list` page concurrently without resuming execution, overlaps BFF feedback/question-index reads, and returns an opaque older-history cursor. Running-task reconciliation uses `GET /api/threads/:threadId/status` with metadata plus one summary Turn. After the sidebar loads, the browser sequentially prewarms that lightweight persisted read for the twelve most recent tasks; clicking immediately switches selection and renders an explicit loading state, while stale rapid-click requests are aborted and ignored.

App Server 0.150.1 fixes dynamic tools at `thread/start`; `thread/resume` has no `dynamicTools` field. Commerce tools are therefore registered deterministically from configuration, never from transient connection status. PostgreSQL stores the dynamic-tool contract version created with each task. A task created under an older contract remains readable but the BFF refuses a new Turn with `THREAD_TOOL_CONTRACT_STALE`; the browser creates a new task rather than pretending the old App Server thread was upgraded.

Different root jobs may have active turns concurrently. Gateway tracks loaded threads and per-turn deadlines independently. The BFF runs tenant-wide contract/quota admission before a direct start, execution-producing queue steer, or manual compact; Gateway obtains BFF admission for automatic/Harness compaction. One lease counts one root job, while inherited subagent threads are bounded separately by the default four-thread Codex session cap. Closing one browser SSE subscription or switching conversations does not interrupt the root job. Open BFF SSE streams re-check Enterprise access and creator ownership every 15 seconds and fail closed after revocation.

## Approval And Server Requests

When Codex sends `item/tool/call`, the Gateway dispatches it only if its namespace and tool name exist in the Commerce Pilot dynamic-tool registry. The current handlers are `commerce_skill.publish` and the governed `commerce_data` namespace when configured; the former `commerce_web.search` handler is retained only for persisted legacy definitions. Native image generation is not a dynamic host tool and arrives as `imageGeneration` Items. Each host-tool call reauthorizes its root scope before provider access. Unknown tools are rejected.

App Server `item/tool/requestUserInput` is reserved for a question actually emitted by Codex. Gateway answers that exact JSON-RPC request and treats `serverRequest/resolved` as lifecycle authority. It does not accept the removed `tool/requestUserInput` alias and does not inject a second copy of the answer into model history.

Commerce write or paid-call approval is application policy inside an existing dynamic-tool request. Gateway emits `commerce/approval/requested` to the authenticated browser, leaves the original `item/tool/call` pending, and eventually returns exactly one dynamic-tool response. `commerce/approval/resolved` clears other browser sessions. This UI may reuse the question-panel component, but it must never be encoded as a fabricated App Server request or echoed as a user conversation message; the decision remains available through the application approval, audit and billing records. Turn completion, interruption, deletion, and authorization revocation clear pending state; un-dispatched external-data reservations are cancelled when the control plane is reachable. App Server process exit clears volatile UI state but leaves a durable reserved ledger row for operator reconciliation rather than replaying or guessing an outcome.

MCP `mcpServer/elicitation/request` is a third, distinct App Server protocol. No currently managed Commerce Pilot MCP server requires elicitation, so it remains fail-closed until a dedicated typed form/URL UI and server allowlist are implemented. It must not be translated into either of the two channels above. Other App Server requests are rejected unless explicitly implemented by application code. A generic server-request response API is prohibited.

## Per-Message Feedback Boundary

Codex App Server `feedback/upload` is a diagnostic product-report API: its protocol accepts a classification, optional reason and thread id, optional logs, extra log files, and tags. It is not a per-message thumbs-up/thumbs-down state API and must not be invoked for Commerce Pilot reply ratings, because doing so would mix user quality signals with diagnostic uploads and could include runtime logs.

Commerce Pilot owns per-message quality feedback in the BFF and Enterprise database while keeping Harness identity authoritative. Before accepting a rating, the BFF walks paginated owned Turn pages until it verifies that the supplied id identifies a non-commentary `agentMessage` in a terminal Turn. The browser submits only `positive`, `negative`, or `null`; the server derives the Turn id, SHA-256 content hash, and, when a matching root Harness usage event exists, the recorded provider model. PostgreSQL stores one current rating and one append-only event per change under forced tenant/workspace/user RLS.

Sources: [Codex feedback protocol](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server-protocol/src/protocol/v2/feedback.rs) and [App Server feedback processor](https://github.com/openai/codex/blob/rust-v0.150.1/codex-rs/app-server/src/request_processors/feedback_processor.rs).
