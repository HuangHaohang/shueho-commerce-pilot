# Comate MCP client compatibility

Commerce Pilot is built on the open-source Codex Harness. This optional local
stdio client adapter changes only MCP tool-schema representation; it does not
implement an agent loop, approvals, provider dispatch, token rotation or retries.

Comate SDK 1.0.33 / pi-ai 0.82.1 coerces `anyOf` alternatives before checking
whether the original value already matches one. A nullable price schema with a
number/minimum-zero branch first can therefore turn an intentional `null` into
`0`. Reordering branches is unsafe because the opposite order can turn a real
zero into null.

`scripts/commerce-mcp-client-bridge.ts` connects to the public authenticated MCP
using `COMMERCE_MCP_AUTH_HEADER`. It exposes equivalent nullable primitive
schemas, for example `anyOf: [{ enum: [null] }, { type: "number", minimum: 0 }]`,
while retaining titles, descriptions, defaults and constraints. The first branch
has no primitive type to coerce: it accepts only an actual null, leaving zero,
false and empty strings for the original typed branch. Safe primitive type-array
schemas are converted to this same representation. Complex or enum unions remain
unchanged. Tool calls and results pass through without parameter coercion or
automatic retries; no JustOneAPI credential is held by the client.

Do not emit `type: ["number", "null"]` or `type: ["integer", "null"]` for this
client. Comate 1.6.11's custom-model request path rejects array-valued types with
`Mismatch type string with value array`. Direct MCP schemas are included even in
an ordinary greeting, so this breaks chat before any tool is called. Official
models returning `responseModel: "mock"` and a model-unavailable message are a
separate service failure, even when the run is recorded as completed.

After `npm run build`, clients with access to the repository dependencies can
run `node dist/scripts/commerce-mcp-client-bridge.js`. A self-contained bundle
may instead be installed in the client's protected support directory. Configure
the existing `shueho-commerce-pilot` entry with that Node entrypoint and retain
its MCP authorization environment and direct-tool list. Back up the existing
client configuration and reconnect the MCP client before using refreshed schemas.

Verification must distinguish `null`, explicit `0`, and positive price bounds;
exercise the installed Comate coercion function and compare JSON-schema acceptance
before and after normalization. Also send a fresh ordinary greeting through the
actual Comate custom-model path and confirm a real model response rather than a
mock or error. A provider-free planning request must retain null
price bounds and produce valid plans for both Taobao and JD. Do not convert zero
prices back to null on the server or disable platform capability checks.

Contract 7 replaces the old free-plan/execute pair with `submit_marketplace_research`, `submit_social_research`, `submit_data_request`, and `get_research_task`. The bridge retries only enumerated read tools on transient network failures (at most three attempts). It never retries submissions or paid execution, and preserves `isError=true` when transport fails. Restart Comate and create a new task after refreshing the installed bridge, directTools and Skill.

Contract 8 adds `list_research_tasks`, `cancel_research_task`, and `get_research_records`. Prefer a single `submit_data_request` with a bounded `pagination.max_pages` when the catalog supports page-number traversal. Task result records can be read by `task_id` with offset/limit; source-ID deduplication occurs on the backend. Never interpret `waiting_approval` as a failed collection, or `reconciliation_required` as safe to recollect. Clients supporting MCP 2025-11-25 may use the advertised native task-required `run_*` tools; ordinary clients need no native-task support. Native methods are not renamed into Comate selectors.

Contract 9 retains MCP sessions between HTTP requests. The bridge reinitializes a lost session only for enumerated read operations; failed submissions retain their original idempotency keys. Task-level record reads return a `snapshot_id`; send it on subsequent offset pages so newly arriving records cannot shift an ongoing export. `settlement.state` reports billing separately from research state: `pending` is being retried by the backend, `attention_required` needs reconciliation, and neither authorizes recollection. Form elicitation requires the external client to advertise and handle it; an unsupported client still receives the durable waiting state.

Contract 10 forwards downstream elicitation capabilities and accept/decline responses through the actual bridge, including after session reinitialization. A downstream client without elicitation still receives a waiting status rather than fabricated approval. The compatibility bridge omits upstream task-required tools; use ordinary submit/get tools there. For record traversal use `next_cursor` with the same task/research ID, without imposing a 10,000-row client ceiling.

The recovery patch retains the 13 ordinary tools and bridges native elicitation without translating Harness questions. Record responses expose projection_version and deduplication; unverified_records_retained means repeated appearances across pages remain possible and must not be reported as a deduplicated population. Original snapshot IDs remain readable.

Contract 11 lists tasks newest first. Pass next_cursor unchanged; do not validate it as a UUID or extract a task ID from it. Native partial failures remain failures with retained evidence. A cancellation receipt may precede financial cleanup; inspect settlement state rather than resubmitting collection.

Intermediate collecting/normalizing/enriching and transport processing acknowledgements are not final failure or completion. Read the original task; backend waits refresh the original result and retain its budget. PROCESSING_WAIT_TIMEOUT requires checking existing evidence rather than submitting another collection.
