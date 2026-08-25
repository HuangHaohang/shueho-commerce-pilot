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
