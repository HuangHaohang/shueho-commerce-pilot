# Commerce Copywriting Workflow

Commerce Pilot's copywriting workspace is built on the open-source Codex App Server harness. It does not implement a parallel prompt loop.

## Product Model

- Copywriting is a Task Recipe inside the unified commerce Agent, not an isolated form application.
- The browser does not declare or hard-code Recipe questions. The `commerce-copywriting` Skill decides which high-impact information is actually missing and calls Codex `request_user_input` from the active turn.
- One copywriting job is one persisted Codex thread.
- Initial goal, dynamic questions, answers, and first delivery stay in one turn. Later user follow-ups each start another turn in that thread.
- App Server owns streamed item events, interruption, history, recovery, and compaction.
- The fixed workflow output distinguishes `answer` from `draft`, but both render as ordinary assistant messages in the unified conversation timeline. The product does not switch to a parallel version editor.

## Managed Skill

`ensureAppOwnedCodexConfig` writes an instruction-only `commerce-copywriting` Skill under the application runtime root:

```text
$CODEX_HOME/workspaces/default/.agents/skills/commerce-copywriting/SKILL.md
```

The browser can request only the fixed workflow id `commerce-copywriting`. The BFF and Gateway validate that id, and the Gateway resolves the application-owned Skill path. Browser requests cannot supply a path, raw Skill content, developer instructions, an output schema, tools, `cwd`, sandbox settings, or permission policy.

When the user submits the entry composer, the Gateway calls App Server `turn/start` with:

- a normal text input containing the original user goal and the conversational-intake contract;
- a `skill` input item for `commerce-copywriting`;
- a fixed output schema containing `responseType`, `title`, `body`, `callToAction`, `complianceNotes`, and `message`.

The generated runtime enables Codex's `default_mode_request_user_input` feature. This exposes `request_user_input` in Default collaboration mode without entering Plan mode. The Skill may pause the active turn with one to three model-generated questions; the BFF returns the answers through `respondToServerRequest`, and the same turn continues to final delivery. No `plan` item or proposed plan is generated.

`responseType=answer` requires a complete conversational answer in `message`. `responseType=draft` carries a polished copy delivery for initial output or an explicit rewrite request. Legacy persisted draft objects without `responseType` remain readable as copy deliveries.

This follows App Server's native Skill invocation and structured-output protocol. It also keeps the Skill in the persisted thread history so a later revision remains grounded in the original Brief.

## Tool Boundary

The Skill is instruction-only. It cannot call host shell, filesystem, process, or unmanaged network tools.

Future product-context reads should use an application-owned, tenant-authorized tool such as `commerce_product_context.resolve`. Saving a draft should use a separate application-owned artifact tool with authorization, idempotency, audit, and readback. Neither concern belongs in Hooks, and neither may be implemented through host commands.

The Gateway also supports App Server's native `item/tool/requestUserInput` server request for questions that arise dynamically during a running turn. Pending requests are bound to a thread, exposed only through the authenticated BFF, restored after reconnect, validated against the original question ids, and answered with `respondToServerRequest`. Unknown server requests still fail closed.

App Server treats question answers as the canonical tool output and does not return them as ordinary user-message items during `thread/read`. Commerce Pilot therefore formats one server-authoritative, secret-redacted `我的选择` summary and stores it only in the RLS-protected `commerce_agent_user_input_answer` display index. The browser appends it optimistically as a user bubble, and thread reads merge the display index before the final assistant answer so refresh preserves the conversation order. The summary is not injected into Harness model history, because doing so would duplicate the same answer as both tool output and a second user instruction. Raw question payloads and secret answers are not stored in the display index.

## UI State

- The first screen is a natural-language task composer, not a configuration form.
- The first screen renders the shared `AgentComposer`; after submission, the thread immediately uses the normal `ConversationWorkspace` rather than a Recipe-specific result page.
- Model-generated questions appear in a bottom-docked Harness question overlay while the ordinary conversation timeline remains visible above it. Each question includes mutually exclusive choices, a recommended first option, and free-form clarification.
- Submitting the overlay immediately appends a right-aligned `我的选择` user message containing each question header and selected value. This message remains visible after refresh.
- Answering the final question resumes the same turn and produces the requested copy instead of a plan.
- Running state uses the App Server turn clock and interrupt route.
- Commentary, activity, elapsed time, user messages, dynamic questions, answers, and final copy all remain in the standard conversation timeline.
- Structured copy output is rendered as readable title, body, CTA, and compliance notes inside the assistant message; JSON is not exposed.
- The first persisted turn stores the original goal and Harness question/answer flow so history can restore the task.
- A copywriting thread is recognized by the application-owned title prefixes `文案任务 ·` and legacy `文案生成 ·`; the title is not an authorization boundary.
