import { join } from "node:path";

export const MANAGED_WORKFLOW_IDS = ["commerce-copywriting"] as const;

export type ManagedWorkflowId = (typeof MANAGED_WORKFLOW_IDS)[number];

export function isManagedWorkflowId(value: unknown): value is ManagedWorkflowId {
  return typeof value === "string" && MANAGED_WORKFLOW_IDS.includes(value as ManagedWorkflowId);
}

export function managedWorkflowSkillDirectory(runtimeRoot: string, workflow: ManagedWorkflowId): string {
  return join(runtimeRoot, ".agents", "skills", workflow);
}

export function managedWorkflowSkillPath(runtimeRoot: string, workflow: ManagedWorkflowId): string {
  return join(managedWorkflowSkillDirectory(runtimeRoot, workflow), "SKILL.md");
}

export function renderManagedWorkflowSkill(workflow: ManagedWorkflowId): string {
  if (workflow === "commerce-copywriting") {
    return `---
name: commerce-copywriting
description: Generate and revise grounded Chinese e-commerce copy from a structured product brief. Use for product titles, selling-point copy, campaign copy, social commerce posts, and product-detail copy.
---

# Commerce Copywriting

Create one polished Chinese e-commerce draft from the supplied brief.

## Conversational Intake

- This is a conversational Task Recipe, not a form wizard and not Plan mode.
- Before the first draft, identify only high-impact missing decisions that materially change the deliverable.
- When a user decision is required, call request_user_input with one to three short questions and wait for the answers. Prefer one focused question at a time; include a clear Agent-decides option.
- Do not emit a plan item or a proposed plan. After answers arrive, continue the same turn and deliver the requested copy.
- Do not ask questions merely to fill optional fields. Make conservative professional assumptions when the outcome remains safe and useful.

## Grounding

- Treat product facts, audience, channel, tone, length, required wording, and prohibited wording as hard constraints.
- Never invent certifications, prices, discounts, ingredients, test results, efficacy, inventory, shipping promises, endorsements, rankings, or platform guarantees.
- If required facts are missing, write conservatively and record the gap in complianceNotes instead of fabricating it.
- Do not call shell, filesystem, process, or unmanaged network tools. Use only application-registered commerce tools when the brief explicitly requires approved product context.
- Do not write to an external commerce system. This workflow produces a draft only.

## Channel Fit

- Adapt structure and rhythm to the named channel without imitating a real person or brand.
- Keep claims reviewable and avoid absolute or unverifiable superlatives.
- Preserve required wording exactly and exclude prohibited wording.
- Respect the requested approximate length while keeping the copy readable.

## Output

Classify each turn before returning the object required by the turn output schema:

- Use responseType=answer when the user asks a question, asks what information is missing, requests an explanation, or asks for advice. Put the complete conversational answer in message and return empty title, body, callToAction, and complianceNotes. Never create a draft merely because the turn uses this Skill.
- Use responseType=draft only for initial delivery or when the user explicitly asks to rewrite, adjust, transform, or generate copy. Fill title, body, callToAction, and complianceNotes; message may briefly describe the revision.
- Initial Recipe execution always uses responseType=draft.
`;
  }

  throw new Error(`Unsupported managed workflow: ${workflow}`);
}

export function buildManagedWorkflowTurn(
  runtimeRoot: string,
  workflow: ManagedWorkflowId,
  message: string,
): {
  input: Array<Record<string, unknown>>;
  outputSchema: Record<string, unknown>;
} {
  if (workflow === "commerce-copywriting") {
    return {
      input: [
        {
          type: "text",
          text: `$commerce-copywriting\n${message}`,
          text_elements: [],
        },
        {
          type: "skill",
          name: workflow,
          path: managedWorkflowSkillPath(runtimeRoot, workflow),
        },
      ],
      outputSchema: {
        type: "object",
        properties: {
          responseType: { type: "string", enum: ["draft", "answer"] },
          title: { type: "string" },
          body: { type: "string" },
          callToAction: { type: "string" },
          complianceNotes: {
            type: "array",
            items: { type: "string" },
          },
          message: { type: "string" },
        },
        required: ["responseType", "title", "body", "callToAction", "complianceNotes", "message"],
        additionalProperties: false,
      },
    };
  }

  throw new Error(`Unsupported managed workflow: ${workflow}`);
}
