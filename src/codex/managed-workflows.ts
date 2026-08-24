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

Return only the object required by the turn output schema:

- title: a concise working title for the draft.
- body: the complete copy, ready for the user to edit.
- callToAction: a separate CTA; use an empty string when the brief does not need one.
- complianceNotes: short review notes for missing facts or risky claims; otherwise an empty array.
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
          title: { type: "string" },
          body: { type: "string" },
          callToAction: { type: "string" },
          complianceNotes: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["title", "body", "callToAction", "complianceNotes"],
        additionalProperties: false,
      },
    };
  }

  throw new Error(`Unsupported managed workflow: ${workflow}`);
}
