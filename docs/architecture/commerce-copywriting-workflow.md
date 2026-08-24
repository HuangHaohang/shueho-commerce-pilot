# Commerce Copywriting Workflow

Commerce Pilot's copywriting workspace is built on the open-source Codex App Server harness. It does not implement a parallel prompt loop.

## Product Model

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

For every managed copywriting turn, the Gateway calls App Server `turn/start` with:

- a normal text input containing the human-readable structured Brief or revision request;
- a `skill` input item for `commerce-copywriting`;
- a fixed output schema containing `title`, `body`, `callToAction`, and `complianceNotes`.

This follows App Server's native Skill invocation and structured-output protocol. It also keeps the Skill in the persisted thread history so a later revision remains grounded in the original Brief.

## Tool Boundary

The Skill is instruction-only. It cannot call host shell, filesystem, process, or unmanaged network tools.

Future product-context reads should use an application-owned, tenant-authorized tool such as `commerce_product_context.resolve`. Saving a draft should use a separate application-owned artifact tool with authorization, idempotency, audit, and readback. Neither concern belongs in Hooks, and neither may be implemented through host commands.

## UI State

- The Brief panel and document canvas are internal workbench regions.
- The submit control remains pinned while the Brief scrolls.
- Running state uses the App Server turn clock and interrupt route.
- Completed outputs become version tabs.
- The first persisted user turn restores the structured Brief when history is opened.
- A copywriting thread is recognized by the application-owned title prefix `文案生成 ·`; the title is not an authorization boundary.
