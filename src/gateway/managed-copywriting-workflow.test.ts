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
  assert.equal(turn.outputSchema.additionalProperties, false);
  assert.deepEqual(turn.outputSchema.required, [
    "responseType",
    "title",
    "body",
    "callToAction",
    "complianceNotes",
    "message",
  ]);
  assert.match(String(turn.input[0]?.text), /^\$commerce-copywriting\n/);
});

test("rejects browser-selected workflow names and keeps the skill instruction-only", () => {
  assert.equal(isManagedWorkflowId("commerce-copywriting"), true);
  assert.equal(isManagedWorkflowId("../../host-skill"), false);

  const skill = renderManagedWorkflowSkill("commerce-copywriting");
  assert.match(skill, /Do not call shell, filesystem, process, or unmanaged network tools/);
  assert.doesNotMatch(skill, /scripts\//);
});

test("maps product insight to the application-owned skill and grounded output schema", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const turn = buildManagedWorkflowTurn(runtimeRoot, "product-insight", "产品事实：无吸管结构");

  assert.deepEqual(turn.input[1], {
    type: "skill",
    name: "product-insight",
    path: managedWorkflowSkillPath(runtimeRoot, "product-insight"),
  });
  assert.deepEqual(turn.outputSchema.required, [
    "oneLineExpression",
    "keyProof",
    "coreSellingPoints",
    "routineSellingPoints",
    "audienceScenes",
    "expressionBoundaries",
    "missingInformation",
    "conflicts",
  ]);
  assert.match(String(turn.input[0]?.text), /^\$product-insight\n/);
  assert.equal(isManagedWorkflowId("product-insight"), true);
  assert.match(renderManagedWorkflowSkill("product-insight"), /只使用输入资料中的事实/);
});
