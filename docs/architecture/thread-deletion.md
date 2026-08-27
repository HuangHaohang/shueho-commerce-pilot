# Permanent Thread Deletion

Commerce Pilot permanently deletes tasks. It does not use archive as a substitute for deletion.

## Harness Boundary

The background worker calls the Gateway, which invokes Codex App Server `thread/delete`. App Server permanently deletes the persisted active or archived root thread, its rollout and metadata, and spawned descendant threads. If a turn is active, Gateway interrupts the root thread tree before deletion.

## Background Job

The browser never waits for filesystem deletion. It creates an RLS-scoped `commerce_thread_deletion_job` with one `commerce_thread_deletion_item` per selected task. The dedicated `jobs:thread-deletion` worker claims jobs through `commerce_claim_thread_deletion_job`, which uses `FOR UPDATE SKIP LOCKED` and an optional production tenant pin.

Job states are `queued`, `running`, `completed`, `partial`, or `failed`. Item states are `queued`, `running`, `deleted`, or `failed`. A failed worker-level operation requeues the job; stale running jobs can be reclaimed after 15 minutes. The browser polls job state and removes a task from the sidebar only after its item reaches `deleted`.

Gateway authentication failures and transient `502/503/504` responses are infrastructure failures, not proof that the user's task cannot be deleted. The worker leaves the item retryable, requeues the Job, waits five seconds, and retries after the service recovers. Codex `thread/delete` is idempotent at the Gateway boundary: if App Server reports that the rollout is already absent, Gateway still completes application artifact cleanup and lets the worker remove the PostgreSQL thread index. Permanent item failures remain visible to the user instead of silently leaving the row unchanged.

## Application Cascade

After App Server confirms deletion, Gateway deletes all generated image files and image metadata for every thread in the deleted tree. It also recursively removes each app-owned `$CODEX_HOME/thread_artifacts/<threadId>` directory. Attachments, uploaded images, generated or uploaded video, exported files, and future thread-scoped media must be stored under that directory or register an equivalent deletion adapter.

The worker then removes the Commerce Pilot thread record, active leases, turn completions, request-user-input display history, and other database rows covered by thread foreign-key cascades. Non-content usage ledger and minimal enterprise audit facts remain for billing, quota reconciliation, abuse prevention, and proof that deletion occurred; they must never contain prompt text or media payloads.

The SQL-only `commerce_external_data_archive` is an independent business dataset, not a thread artifact. It stores thread and Turn ids only as provenance text and deliberately has no thread foreign key, so deleting a task never deletes complete JustOneAPI requests or responses. Those rows follow their own retention deadline, legal hold and explicit SQL deletion process.

## Authorization

`thread.delete` is a distinct enterprise permission granted to tenant owners, workspace owners, and workspace operators. Job creation verifies that every selected thread belongs to the authenticated tenant, workspace, and creator. Job and item tables enforce tenant, workspace, and user RLS.

## UI Contract

Every task row has a permanent-delete icon. The Recent header provides batch selection. Individual and batch deletion use the same irreversible confirmation dialog and enqueue the same background job. Deleting rows show a spinner and cannot be opened or enqueued again.
