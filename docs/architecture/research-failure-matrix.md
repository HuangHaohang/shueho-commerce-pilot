# Research reliability acceptance matrix

Commerce Pilot uses the open-source Codex Harness for conversations, reasoning, tool lifecycle, permission interaction and continuation. This matrix concerns deterministic external-data delivery, not a second agent runtime. Passing it does not establish zero defects or supplier availability.

| Boundary / fault | Required invariant | Executable evidence |
| --- | --- | --- |
| Read transport resets while a provider request is outstanding | The provider stream is not closed; one supplier dispatch | `external-data-service-mcp-client.test.ts`: concurrent slow supplier and reset read |
| Provider result lost after dispatch | Read original warehouse identity; never replay the supplier | `research-task-runtime.test.ts`: lost supplier response recovery |
| Duplicate task submission / lost claim reply | One task, one claim identity; empty claim retry cannot claim new work | `research-tasks.integration.test.ts` |
| Worker/page loses lease | All child pages observe the same loss; replacement ownership is fenced | `research-task-runtime.test.ts`, PostgreSQL task tests |
| Role/token/policy/price changes | Revalidate before fresh dispatch; deny without provider bytes | `external-data-revalidation.test.ts`, runtime admission tests |
| Cancellation while reservation response is outstanding | Persist release intent from pre-call identity; block late reservation and release only reserved calls | `research-delivery.integration.test.ts`, `external-budget-release.integration.test.ts` |
| Cancellation after provider dispatch | Do not refund dispatched/unknown calls; settlement continues independently | budget release database test and settlement tests |
| Settlement service unavailable / reply lost | Exact immutable payload remains queued; idempotent delivery with lease fencing | `research-settlement-worker.test.ts`, PostgreSQL settlement tests |
| Settlement intent cannot be stored | Task remains recoverable; no false billing completion or recollection | `research-service.test.ts` |
| External approval across HTTP requests | Retain client capabilities, session identity and pending server request | `mcp-session-pool.test.ts` |
| Actual compatibility bridge / server restart | Forward accept/decline by native elicitation; renegotiate lost session without resubmitting collection | `commerce-client-bridge.test.ts` |
| Native MCP task client | Negotiated create/get/result/list/cancel use durable task IDs | `research-task-protocol.test.ts` |
| New pages arrive while results are read | Previous snapshot membership/order remains fixed | `research-delivery.integration.test.ts` |
| More than 10,000 records | Traverse all records using snapshot-bound cursors, without duplicates or omissions | 10,050-record PostgreSQL traversal built from observations (not a prefilled index), and cursor tests |
| Empty queue over time | Exponential idle backoff; bounded v2 receipt retention with expired request rejection | `idle-backoff.test.ts`, PostgreSQL claim-expiry tests |
| Cross-tenant/user/session attempts | RLS, owner checks and session identity prevent access | SQL task/record tests, MCP session test |

## Production verification

Before release, inspect active provider calls, task states and financial states. Apply append-only migrations, stop/drain old workers before changing internal claim contracts, deploy control/warehouse/public MCP/worker from the same revision, then inspect readiness and actual tool contracts. Read existing source-backed results and compare raw hashes, provider attempts and token counters before/after. No paid supplier calls are needed for release smoke tests. Safe invalid-input tasks may test queue lifecycle but must not bypass governance.

## Explicit operating limits

- No retry can prove the outcome of a supplier request that timed out after dispatch; those calls require provider evidence or reconciliation.
- Stateful public MCP replicas require session affinity. Reinitialization replaces transport state only; durable task IDs remain valid.
- Page-number traversal is supported where declared by the catalog. Unsupported provider cursor flows are reported explicitly.
- Settlement/release jobs enter `attention_required` after 20 failed deliveries. Their original immutable intent remains available for reconciliation.
- Legacy empty-claim receipts without a timestamp are retained. New issued-at claims expire after ten minutes and their operational receipts are cleaned after one day; raw/business records are not cleaned by this mechanism.
- Historical pending approvals are not cancelled merely because they are old. Only task-terminal cleanup or explicit cancellation releases known unissued reservations.

Recovery acceptance also covers different reviews sharing itemId, null rateId, old snapshot readback, native Tasks input_required with related-task elicitation, concurrent result readers, approval response loss, stale approval reservation rejection, and financial response loss before provider execution. Verified source records are preserved when cross-page entity identity is unknown.

Contract 11 acceptance exercises the real research entrypoint through financial reply loss and later provider checkpoint loss; the task must finish with one supplier call, no plan cancellation and one settlement intent. Failed structured RPC receipts must fail closed. Native cancellation succeeds without synchronous financial release, cross-session approval races return current state, native terminal result flags match status, and task listing preserves microsecond boundaries and legacy cursors.

Nonterminal provider acknowledgements (executing/running/queued/processing) never mark a task completed; the worker reconciles the original checkpoint within its existing bounded recovery policy.
