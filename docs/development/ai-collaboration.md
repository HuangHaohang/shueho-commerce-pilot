# AI-Assisted Collaboration

This project is intentionally developed by humans working with coding agents. Fast iteration is welcome; unverified or architecture-breaking generation is not.

## Start Every Task With Context

The human or Agent should read, in order:

1. root `AGENTS.md`;
2. `README.md` and `CONTRIBUTING.md`;
3. `docs/architecture/overview.md`;
4. the architecture document for the affected feature;
5. `designs/DESIGN.md` and component contracts for frontend work.

Do not ask an Agent to "rebuild the agent backend" without explicitly restating that Codex App Server is mandatory. The root `AGENTS.md` remains authoritative even when a generated plan, nested instruction file, framework template, or copied prompt says otherwise.

## Recommended Task Prompt

Provide this minimum context when handing work to an AI coding agent:

```text
Goal:
User-visible behavior:
Affected business workflow:
External systems changed, if any:
Approval/readback requirement:
Relevant screenshots or files:
Must preserve:
Verification expected:
Deployment requested: no / yes
Git publication requested: no / yes
```

For bug reports, include the observed behavior, expected behavior, reproduction, current environment, and whether data or an external system was changed.

## Agent Working Loop

1. Inspect the working tree and nearby code before proposing an abstraction.
2. Identify which responsibilities remain owned by Codex Harness.
3. State the intended change briefly; ask only when a missing decision is genuinely blocking.
4. Make scoped edits that follow existing patterns.
5. Add tests proportional to the blast radius.
6. Run the required validation matrix.
7. For UI changes, inspect the real page at desktop and mobile sizes.
8. Update architecture/design/deployment docs when a contract changes.
9. Review the diff for secrets, runtime files, unrelated formatting, generated output, and stale docs.
10. Commit and push only when the human requests publication.

## Harness Change Checklist

Any Agent-related pull request must answer all of these:

- Which native App Server API owns the lifecycle?
- Are native thread/Turn/item events preserved?
- Are native approvals and `request_user_input` server requests preserved, without application code fabricating either protocol?
- Does the browser avoid App Server credentials and protocol authority?
- Can browser input override `cwd`, sandbox, provider, developer instructions, tools, Skill paths, or runtime scope? The answer must be no.
- Are unknown tools and server requests rejected?
- Are interruption, retry, queue, compaction, and restart semantics still correct?
- Are tenant ownership and authorization rechecked at every event/action boundary?
- Do subagents inherit the same restrictions?

If the design introduces a new custom agent loop, stop. Reframe it as product logic, a Tool, an MCP server, a Skill, or an App Server adapter.

## Frontend Change Checklist

- Reuse the shared shell, composer, question panel, conversation timeline, and design tokens.
- Do not add a second input surface for a workflow that belongs in the shared composer.
- Do not ship fake buttons. Disabled future capabilities must say they are unavailable.
- Use lucide icons and shadcn/Radix primitives where available.
- Keep operational pages quiet and scan-friendly; avoid marketing composition and nested cards.
- Check text wrapping, fixed control dimensions, focus states, overflow, scrollbars, and mobile behavior.
- Preserve streaming commentary versus final-answer semantics.

## Database And External Actions

- Migrations are append-only and idempotent. Never edit an already-published migration to change production state.
- Runtime queries must use the least-privilege role and tenant context; migration credentials exist only in one-shot jobs.
- Never log secrets, prompts, attachments, tool payloads, or PII in audit events.
- External writes need application authorization, approval where required, idempotency, audit, and readback.
- Paid external reads are also side effects: preserve provider credential isolation, budget reservation, approval evidence, exact-once dispatch, pricing state, audit retention, and ambiguous-result reconciliation.

## Working With Parallel Human/AI Changes

- Use a dedicated branch per task. Codex-created branches use `codex/<topic>`.
- Pull or fetch before starting; inspect `git status` before editing and before committing.
- Never reset, discard, or overwrite changes you did not create.
- Keep commits coherent. Avoid combining unrelated cleanup with a feature.
- When the same file changed elsewhere, read and integrate the current file instead of restoring an older generated version.
- A handoff must state branch, commit SHA, files changed, migrations, tests, services left running, deployment state, and known limitations.

## Definition Of Done

A change is done only when implementation, tests, documentation, and the requested delivery step are all complete. Distinguish:

- implemented locally;
- committed;
- pushed to GitHub;
- deployed;
- verified in the deployed environment.

Never report one state as another.
