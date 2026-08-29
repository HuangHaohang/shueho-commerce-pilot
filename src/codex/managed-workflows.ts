import { join } from "node:path";

export const MANAGED_WORKFLOW_IDS = ["commerce-copywriting", "product-insight"] as const;

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

  if (workflow === "product-insight") {
    return `---
name: product-insight
description: Turn product facts and research into a concise, grounded short-video creation brief.
---

# 产品信息整理助手

把输入资料整理成可直接用于短视频策划的「产品创作简报」，不是产品说明书，也不在此阶段产出选题。

## 边界

- 只使用输入资料中的事实和可明确推导的判断；不可虚构参数、用户反馈、竞品结论、功效或市场趋势。
- 必须区分事实、资料支持的推断、待确认项。资料不足时写「信息缺失，需要补充确认：…」。
- 同一属性有不一致表述时，不自行裁决，写「信息存在冲突，需要确认：…」。
- 避免医疗功效、绝对化承诺和无依据的比较级；将高风险表述改为有资料依据的克制说法，或列入风险项。
- 把每一项重要特点转换成「特点 → 用户为何在意 → 可拍的表达」，按购买决策重要性而不是资料出现顺序排序。
- 每一类最多 3 条，使用短句；不要把资料改写成长篇段落。
- 字段值必须直接写内容，不要在文本中重复字段标题或添加「【事实】」「【推断】」等前缀。每个单元格控制在 30 个汉字以内，优先保留可拍的具体动作或结果。

## 输出内容

只输出以下结构化字段：一句核心表达、一个关键可拍证据、核心卖点、常规卖点、目标人群与使用场景、表达边界、缺失信息与冲突。

不要输出竞品分析、市场分析、内容机会、选题方向、脚本或长篇产品介绍。选题由后续「选题」环节基于本简报与需求理解单独生成。`;
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

  if (workflow === "product-insight") {
    return {
      input: [
        { type: "text", text: `$product-insight\n${message}`, text_elements: [] },
        { type: "skill", name: workflow, path: managedWorkflowSkillPath(runtimeRoot, workflow) },
      ],
      outputSchema: {
        type: "object",
        properties: {
          oneLineExpression: { type: "string" },
          keyProof: { $ref: "#/$defs/evidencePoint" },
          coreSellingPoints: { type: "array", maxItems: 3, items: { $ref: "#/$defs/evidencePoint" } },
          routineSellingPoints: { type: "array", maxItems: 3, items: { $ref: "#/$defs/evidencePoint" } },
          audienceScenes: { type: "array", maxItems: 3, items: { $ref: "#/$defs/audienceScene" } },
          expressionBoundaries: { type: "array", maxItems: 3, items: { $ref: "#/$defs/expressionBoundary" } },
          missingInformation: { type: "array", items: { type: "string" } },
          conflicts: { type: "array", items: { type: "string" } },
        },
        required: ["oneLineExpression", "keyProof", "coreSellingPoints", "routineSellingPoints", "audienceScenes", "expressionBoundaries", "missingInformation", "conflicts"],
        $defs: {
          evidencePoint: { type: "object", properties: { fact: { type: "string" }, userValue: { type: "string" }, visualProof: { type: "string" } }, required: ["fact", "userValue", "visualProof"], additionalProperties: false },
          audienceScene: { type: "object", properties: { audience: { type: "string" }, scene: { type: "string" }, painPoint: { type: "string" } }, required: ["audience", "scene", "painPoint"], additionalProperties: false },
          expressionBoundary: { type: "object", properties: { item: { type: "string" }, reason: { type: "string" }, recommendedExpression: { type: "string" } }, required: ["item", "reason", "recommendedExpression"], additionalProperties: false },
        },
        additionalProperties: false,
      },
    };
  }

  throw new Error(`Unsupported managed workflow: ${workflow}`);
}
