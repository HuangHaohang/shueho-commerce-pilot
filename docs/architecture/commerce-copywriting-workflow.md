# Commerce Copywriting Workflow

Commerce Pilot's copywriting workspace is built on the open-source Codex App Server harness. It does not implement a parallel prompt loop.

## Product Model

- Copywriting is a Task Recipe inside the unified commerce Agent, not an isolated form application.
- The browser collects only high-impact decisions declared by the Recipe. It uses the same question shape and progressive interaction as Codex `request_user_input`, including free-form input and question progress.
- Fixed Recipe questions are resolved before starting a model turn, so ordinary users do not wait for the model to rediscover required slots.
- One copywriting job is one persisted Codex thread.
- Initial generation and every revision are separate turns in that thread.
- App Server owns streamed item events, interruption, history, recovery, and compaction.
- The browser renders completed structured outputs as editable versions; it does not replace or delete earlier versions.

## Managed Skill

`ensureAppOwnedCodexConfig` writes an instruction-only `commerce-copywriting` Skill under the application runtime root:

```text
$CODEX_HOME/workspaces/default/.agents/skills/commerce-copywriting/SKILL.md
```

The browser can request only the fixed workflow id `commerce-copywriting`. The BFF and Gateway validate that id, and the Gateway resolves the application-owned Skill path. Browser requests cannot supply a path, raw Skill content, developer instructions, an output schema, tools, `cwd`, sandbox settings, or permission policy.

After Recipe answers are complete, the Gateway calls App Server `turn/start` with:

- a normal text input containing the original user goal plus the selected answers;
- a `skill` input item for `commerce-copywriting`;
- a fixed output schema containing `title`, `body`, `callToAction`, and `complianceNotes`.

This follows App Server's native Skill invocation and structured-output protocol. It also keeps the Skill in the persisted thread history so a later revision remains grounded in the original Brief.

## Tool Boundary

The Skill is instruction-only. It cannot call host shell, filesystem, process, or unmanaged network tools.

Future product-context reads should use an application-owned, tenant-authorized tool such as `commerce_product_context.resolve`. Saving a draft should use a separate application-owned artifact tool with authorization, idempotency, audit, and readback. Neither concern belongs in Hooks, and neither may be implemented through host commands.

The Gateway also supports App Server's native `item/tool/requestUserInput` server request for questions that arise dynamically during a running turn. Pending requests are bound to a thread, exposed only through the authenticated BFF, restored after reconnect, validated against the original question ids, and answered with `respondToServerRequest`. Unknown server requests still fail closed.

## UI State

- The first screen is a natural-language task composer, not a configuration form.
- The first screen and completed artifact view render the same shared `AgentComposer` used by normal conversations. The Recipe owns submission semantics, not a second input implementation.
- Missing channel and expression direction are collected one question at a time; each question offers an Agent-decides option.
- Answering the final Recipe question starts generation immediately instead of showing a plan.
- Running state uses the App Server turn clock and interrupt route.
- Completed outputs become version tabs.
- The first persisted user turn stores the original goal and selected answers so history can restore the task.
- A copywriting thread is recognized by the application-owned title prefixes `文案任务 ·` and legacy `文案生成 ·`; the title is not an authorization boundary.
