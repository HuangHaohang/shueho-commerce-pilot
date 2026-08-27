# Commerce Skill Runtime

Commerce Pilot uses Codex Skills as reusable task methods. Skills and plugins are separate product concepts: a Skill defines how the Agent should work, while a plugin may distribute Skills, connectors, MCP configuration, and presentation assets.

## Source Alignment

The implementation follows the current `openai/codex` source behavior:

- host Skill roots include user, admin, system, plugin, and repository `.agents/skills` scopes;
- every Skill has a required `SKILL.md` and optional metadata/resources;
- App Server `skills/list` returns the effective per-`cwd` catalog and `skills/changed` invalidates cached clients;
- explicit invocation uses both the `$skill-name` marker and a `skill` input item;
- bundled system Skills include `skill-creator`.

The inspected runtime baseline is `@openai/codex` `0.149.0`, matching `openai/codex` tag `rust-v0.149.0` at `758ef40f50c1a458425c7cfbf1eb12cbc07af0b0`.

## Hosted Boundary

The Gateway enables bundled Skills and requests `skills/list` only for the application-owned runtime root. The browser receives a sanitized inventory containing display metadata, scope, enabled state, and dependency count. It never receives a native Skill path.

Application-managed Skills remain under:

```text
$CODEX_HOME/workspaces/default/.agents/skills
```

The globally discoverable `skill-creator` remains the Codex system Skill. In the hosted product it may guide creation, but publishing a generated Skill must go through an application-owned validator and a path-confined write operation. The browser may not select arbitrary roots, upload executable scripts, run the bundled initializer, or write directly to the deployment host.

## Managed Publication

Skill creation uses the Harness rather than a parallel prompt wizard:

1. The bundled `skill-creator` Skill gathers the purpose, trigger boundaries, and required workflow details. It defaults to instruction-only authoring.
2. The Agent calls the application-registered dynamic tool `commerce_skill.publish` with a bounded `commerce-*` name, display metadata, description, and Markdown instructions. The tool schema does not accept a path, script, asset, secret, command, or permission setting.
3. Gateway holds the App Server `item/tool/call` request and emits the application notification `commerce/approval/requested`. The browser renders that business approval through the same visual question panel, but it is not represented as a Codex `request_user_input` server request and its answer is not echoed as a user conversation message.
4. Only an authenticated approval from the bound tenant, workspace, user, thread, and turn allows publication. Because the current runtime catalog is tenant-shared, the BFF additionally requires `tenant.manage`; cancellation returns a completed cancellation result and writes nothing.
5. Gateway writes the instruction-only Skill atomically below `$CODEX_HOME/workspaces/default/.agents/skills`, rejects symlink targets and unmanaged collisions, and binds updates to the original Commerce Pilot principal.
6. Gateway calls `skills/list` with `forceReload: true` and reports success only after the App Server returns the new enabled Skill. `skills/changed` remains the native invalidation signal.
7. The event outbox records only the Skill name, create/update outcome, content hash, thread/turn ids, and principal scope. Raw instructions are not copied into the enterprise audit log.

This publisher does not enable shell, App Server filesystem RPC, process control, arbitrary workspace writes, or executable Skill scripts. A future script-bearing Skill flow requires a separate administrator review and isolated build pipeline.

The first release caps application-managed Skills at 100 per tenant runtime. Personal or workspace-private Skills require distinct per-principal runtime roots before they can be exposed safely; they must not be simulated by placing all users' Skill folders under one shared App Server `cwd`.

## Explicit Invocation

The product uses `@` as the browser interaction for choosing a Skill while preserving Codex App Server's native invocation contract:

1. The Skill detail action `立即使用`, the composer Skill icon, and an `@` mention all update the same selected-Skill state on the existing shared composer.
2. Selecting a Skill replaces the typed `@query` token with a distinct Skill chip. The user's task text remains ordinary conversation content and is not replaced by a fixed prompt template.
3. The browser submits only `skillName`; it cannot submit a native path, Skill body, developer instruction, tool definition, output schema, or runtime root.
4. Gateway validates the name, rejects workflow-and-Skill combinations, calls `skills/list(forceReload)` for the application runtime root, and accepts only an enabled Skill with an absolute path returned by App Server.
5. Gateway starts the Turn with both the `$skill-name` text marker and the native `{ type: "skill", name, path }` input item. This matches Codex explicit Skill invocation semantics.
6. The marker remains an execution detail. Live events and restored history render the user's original task text plus an independent Skill chip, and title generation excludes the marker.

Explicit Skill submissions cannot be downgraded into plain `thread/queue/add` messages behind an active Turn because that queue shape would lose the native Skill item. The user must wait for or interrupt the active Turn before invoking another Skill.

## Native User Input And Business Approval

The Gateway accepts the Codex 0.149 App Server method `item/tool/requestUserInput` for model-originated questions. It persists the pending request in process memory, filters it by thread, exposes authenticated read/respond routes through the BFF, validates answers against the original question ids, and calls `respondToServerRequest`. App Server's `serverRequest/resolved` notification is authoritative for lifecycle cleanup. The removed legacy alias `tool/requestUserInput` is not accepted.

Skill publication is different: it is an application policy decision inside the already-running `item/tool/call`. Commerce Pilot emits `commerce/approval/requested`, keeps the original dynamic-tool request pending, and returns one success, cancellation, or failure response to that original App Server request. It never fabricates a Codex server request. Turn completion, interruption, deletion, or App Server restart clears stale application approvals; unknown App Server requests still fail closed.
