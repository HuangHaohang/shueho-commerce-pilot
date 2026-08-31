import assert from "node:assert/strict";
import test from "node:test";

import {
  buildManagedWorkflowTurn,
  managedWorkflowSkillPath,
  renderManagedWorkflowSkill,
} from "../codex/managed-workflows.js";

test("product onboarding remains a native Harness skill Turn without an application-authored agent loop", () => {
  const runtimeRoot = "C:/commerce-runtime";
  const message = "帮我把公司的 CSV 产品数据接入产品库";
  const turn = buildManagedWorkflowTurn(runtimeRoot, "commerce-product-onboarding", message);

  assert.deepEqual(turn.input, [
    { type: "text", text: message, text_elements: [] },
    {
      type: "skill",
      name: "commerce-product-onboarding",
      path: managedWorkflowSkillPath(runtimeRoot, "commerce-product-onboarding"),
    },
  ]);
  assert.equal(turn.outputSchema, undefined);
});

test("product onboarding skill requires scoped discovery, secure credential handoff, validation, approval and readback", () => {
  const skill = renderManagedWorkflowSkill("commerce-product-onboarding");

  assert.match(skill, /list_connectors/);
  assert.match(skill, /list_sources/);
  assert.match(skill, /list_imports/);
  assert.match(skill, /create_import_from_artifact/);
  assert.match(skill, /request_user_input/);
  assert.match(skill, /Never ask the user to paste a password, Token, DSN/);
  assert.match(skill, /activate_import is a governed Commerce write/);
  assert.match(skill, /import_status for authoritative readback/);
  assert.match(skill, /Never ask.*arbitrary SQL/);
});
