# Commerce Skill Runtime

Commerce Pilot uses Codex Skills as reusable task methods. Skills and plugins are separate product concepts: a Skill defines how the Agent should work, while a plugin may distribute Skills, connectors, MCP configuration, and presentation assets.

## Source Alignment

The implementation follows the current `openai/codex` source behavior:

- host Skill roots include user, admin, system, plugin, and repository `.agents/skills` scopes;
- every Skill has a required `SKILL.md` and optional metadata/resources;
- App Server `skills/list` returns the effective per-`cwd` catalog and `skills/changed` invalidates cached clients;
- explicit invocation uses both the `$skill-name` marker and a `skill` input item;
- bundled system Skills include `skill-creator`.

The inspected upstream revision was `339751715c64496cb86246bfb3935f40e309dd3d` from 2026-08-24.

## Hosted Boundary

The Gateway enables bundled Skills and requests `skills/list` only for the application-owned runtime root. The browser receives a sanitized inventory containing display metadata, scope, enabled state, and dependency count. It never receives a native Skill path.

Application-managed Skills remain under:

```text
$CODEX_HOME/workspaces/default/.agents/skills
```

The globally discoverable `skill-creator` remains the Codex system Skill. In the hosted product it may guide creation, but publishing a generated Skill must go through an application-owned validator and a path-confined write operation. The browser may not select arbitrary roots, upload executable scripts, run the bundled initializer, or write directly to the deployment host.

## Native User Input

The Gateway accepts only App Server `item/tool/requestUserInput` and `tool/requestUserInput` server requests in addition to the existing application tool-call request. It persists the pending request in process memory, filters it by thread, and exposes authenticated read/respond routes through the BFF. Answers are validated against the original question ids before the Gateway calls `respondToServerRequest`.

Unknown App Server requests still fail closed. Turn completion, interruption, cancellation, or App Server restart clears stale pending input.
