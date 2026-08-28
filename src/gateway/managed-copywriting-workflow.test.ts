import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManagedWorkflowTurn,
  isManagedWorkflowId,
  managedWorkflowSkillPath,
  renderManagedWorkflowSkill,
} from "../codex/managed-workflows.js";

test("maps the copywriting workflow to an application-owned skill and fixed schema", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const turn = buildManagedWorkflowTurn(runtimeRoot, "commerce-copywriting", "商品：测试商品");

  assert.equal(turn.input.length, 2);
  assert.deepEqual(turn.input[1], {
    type: "skill",
    name: "commerce-copywriting",
    path: managedWorkflowSkillPath(runtimeRoot, "commerce-copywriting"),
  });
  assert.ok(turn.outputSchema);
  assert.equal(typeof turn.outputSchema, "object");
  assert.equal(Array.isArray(turn.outputSchema), false);
  const outputSchema = turn.outputSchema as Record<string, unknown>;
  assert.equal(outputSchema.additionalProperties, false);
  assert.deepEqual(outputSchema.required, [
    "responseType",
    "title",
    "body",
    "callToAction",
    "complianceNotes",
    "message",
  ]);
  assert.equal(turn.input[0]?.type, "text");
  assert.equal(turn.input[0]?.type === "text" ? turn.input[0].text : "", "商品：测试商品");
});

test("rejects browser-selected workflow names and keeps the skill instruction-only", () => {
  assert.equal(isManagedWorkflowId("commerce-copywriting"), true);
  assert.equal(isManagedWorkflowId("commerce-market-research"), true);
  assert.equal(isManagedWorkflowId("../../host-skill"), false);

  const skill = renderManagedWorkflowSkill("commerce-copywriting");
  assert.match(skill, /Do not call shell, filesystem, process, or unmanaged network tools/);
  assert.doesNotMatch(skill, /scripts\//);
});

test("maps market research to Harness tools without a parallel output loop", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const turn = buildManagedWorkflowTurn(runtimeRoot, "commerce-market-research", "研究通勤包价格带");
  assert.equal(turn.input.length, 2);
  assert.deepEqual(turn.input[1], {
    type: "skill",
    name: "commerce-market-research",
    path: managedWorkflowSkillPath(runtimeRoot, "commerce-market-research"),
  });
  assert.equal(turn.outputSchema, undefined);
  const skill = renderManagedWorkflowSkill("commerce-market-research");
  assert.match(skill, /commerce_data\.research_social_content/);
  assert.match(skill, /latest_content/);
  assert.match(skill, /interaction_ranked/);
  assert.match(skill, /commerce_data\.plan_marketplace_research/);
  assert.match(skill, /commerce_data\.execute_marketplace_research/);
  assert.match(skill, /detail_sample_size=null/);
  assert.match(skill, /immediate next action MUST be native request_user_input/);
  assert.match(skill, /Never render those choices in an assistant message or numbered list/);
  assert.match(skill, /commerce_data\.list_marketplace_research_platforms/);
  assert.match(skill, /commerce_data\.get_marketplace_options/);
  assert.match(skill, /platform choices only from the exact database-returned ids and labels/);
  assert.match(skill, /must not appear as a selectable or researched platform/);
  assert.match(skill, /native request_user_input/);
  assert.match(skill, /Never memorize, hard-code, infer, or silently default/);
  assert.match(skill, /never choose a JustOneAPI endpoint or provider parameter/);
  assert.match(skill, /do not silently substitute Web Search/);
  assert.match(skill, /user does not need to name JustOneAPI/);
  assert.match(skill, /Do not make a paid external-data call merely because the tool is available/);
  assert.match(skill, /Never retry a completed, stale, expired or uncertain paid plan automatically/);
  assert.match(skill, /Do not use shell, arbitrary network requests/);
  assert.doesNotMatch(skill, /scripts\//);
});
