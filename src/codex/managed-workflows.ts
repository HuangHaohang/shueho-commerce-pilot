import { join } from "node:path";

import type { JsonValue } from "./generated/serde_json/JsonValue.js";
import type { UserInput } from "./generated/v2/UserInput.js";

export const MANAGED_WORKFLOW_IDS = ["commerce-copywriting", "commerce-market-research"] as const;

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

  if (workflow === "commerce-market-research") {
    return `---
name: commerce-market-research
description: Produce evidence-grounded commerce market research using approved public web and external data tools. Use for competitor, category, pricing, content, creator, channel, and consumer-signal research.
---

# Commerce Market Research

Deliver a decision-ready market research report from the user's business question.

## Scope Intake

- This is a conversational Task Recipe, not a static form and not Plan mode.
- Infer conservative defaults from the user's request, attachments, and current conversation.
- Ask one to three request_user_input questions only when category, market, platform, time range, target competitor, or decision objective is materially ambiguous.
- Continue the same Turn after answers and produce the report; do not stop at a plan.

## Evidence Workflow

- Separate the research question, scope, evidence, inference, and recommendation.
- Decide autonomously whether governed external commerce data would materially improve the answer. The user does not need to name JustOneAPI, an endpoint, or a tool.
- Do not make a paid external-data call merely because the tool is available. Prefer existing conversation evidence or public Web Search when it is sufficient for the decision.
- Before new collection, call commerce_data.search_business_data when previously curated workspace evidence may answer the question. This read-only hybrid search does not incur a provider fee; use commerce_data.get_research_result to revisit a returned research id.
- Use commerce_data.research_social_content for public social-platform content. Supply only the requested platform, concise keyword, inclusive Asia/Shanghai dates, business objective, required metrics and result limit; never choose a JustOneAPI endpoint or provider parameter.
- Use latest_content for exact date-bounded discovery and interaction_ranked for provider-ranked engagement evidence. If both are materially required, they are separate governed paid calls and each approval must be respected.
- Marketplace collection is two-phase. First call free commerce_data.plan_marketplace_research. Unless the user explicitly requested a representative count, set detail_sample_size=null so the versioned profile chooses its default; never read or infer a maximum from get_marketplace_options, and never ask about reducing coverage before the free quote runs. Execute only the returned unexpired plan_id through commerce_data.execute_marketplace_research.
- Before proposing or asking about marketplace scope, call the free commerce_data.list_marketplace_research_platforms tool. Build native request_user_input platform choices only from the exact database-returned ids and labels. Never add a familiar marketplace from general knowledge, memory, geography, language, or prior conversation. A platform absent from this catalog is unavailable and must not appear as a selectable or researched platform.
- For each selected platform, call the free commerce_data.get_marketplace_options tool with the exact catalog id. If it returns available=false, stop using that platform. If it returns requiresSelection=true and the user did not specify a market, ask through native request_user_input using exactly the returned database labels/codes; when there are two or three options, render all of them as choices. If the user named a code or site absent from the returned options, state that it is currently unsupported and do not call the paid research tool. Never memorize, hard-code, infer, or silently default a marketplace option list.
- Use only ready get_marketplace_options entries. Generate concise localized_keywords from the selected entry's preferredQueryLocale/queryLocales and keep keyword as the user's original concept; do not infer a language from the country label or ask the user to translate. If planning returns LOCALIZED_KEYWORD_REQUIRED or LOCALIZED_KEYWORD_INVALID, correct only the free plan using the returned marketContext.
- Do not silently reduce representative coverage to fit a quota. If free planning/quote returns maximumDetailSampleSize below the effective size, your immediate next action MUST be native request_user_input with one question and two choices: accept that explicit reduced coverage, or pause for an administrator policy change. Never render those choices in an assistant message or numbered list. Then create one new free plan only after the answer.
- The SHUEHO service selects the provider capability, validates parameters, archives the complete response, enforces the time window and returns curated evidence. If it reports a capability gap, zero date-valid evidence or missing metrics, preserve that result and do not silently substitute Web Search.
- A commerce_data.research_social_content or commerce_data.execute_marketplace_research request can incur a fee. Never retry a completed, stale, expired or uncertain paid plan automatically.
- Use commerce_web.search for current public-web evidence when it materially improves the answer. Cite source URLs returned by that tool.
- Do not use shell, arbitrary network requests, browser automation, host files, unmanaged MCP, or platform credentials.
- Prefer several independent evidence sources for material conclusions. Clearly label an inference when direct evidence is incomplete.

## Data And Compliance

- Treat third-party API and platform data as potentially delayed, incomplete, changed, or unavailable.
- State the platform, requested period, retrieval time or freshness indicator, and material coverage limitations.
- Never invent market size, sales volume, engagement, ranking, price, creator performance, consumer sentiment, or platform policy.
- Do not infer sensitive personal traits, identify private individuals, or recommend unlawful collection, account circumvention, deceptive reviews, fake engagement, or intellectual-property infringement.
- Use only the minimum public identifiers needed for the approved research call.

## Report

Return readable Markdown with these sections when applicable:

1. 研究范围
2. 结论摘要
3. 关键证据
4. 竞争与机会判断
5. 建议动作
6. 数据口径、时效与限制
7. 来源

Use a GitHub-Flavored Markdown table when the answer compares price bands, competitors, channels, products, metrics, or evidence across repeated fields. Keep narrative conclusions and caveats outside the table. Do not force a table for prose-only sections or put long unstructured paragraphs into cells.

For each important conclusion, distinguish confirmed evidence from analysis. A recommendation is not an external business action and must not be described as already executed.
`;
  }

  throw new Error(`Unsupported managed workflow: ${workflow}`);
}

export function buildManagedWorkflowTurn(
  runtimeRoot: string,
  workflow: ManagedWorkflowId,
  message: string,
): {
  input: UserInput[];
  outputSchema?: JsonValue;
} {
  if (workflow === "commerce-copywriting") {
    return {
      input: [
        {
          type: "text",
          text: message,
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

  if (workflow === "commerce-market-research") {
    return {
      input: [
        {
          type: "text",
          text: message,
          text_elements: [],
        },
        {
          type: "skill",
          name: workflow,
          path: managedWorkflowSkillPath(runtimeRoot, workflow),
        },
      ],
    };
  }

  throw new Error(`Unsupported managed workflow: ${workflow}`);
}
