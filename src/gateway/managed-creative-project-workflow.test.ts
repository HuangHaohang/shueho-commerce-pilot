import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATIVE_METHOD_DEFINITIONS,
  CREATIVE_METHOD_VALUES,
  buildManagedWorkflowTurn,
  creativeMethodSkillPath,
  isAppOwnedManagedSkillName,
  isManagedWorkflowId,
  managedWorkflowSkillPath,
  renderCreativeMethodSkill,
  renderCreativeMethodSkillMetadata,
  renderManagedWorkflowSkill,
} from "../codex/managed-workflows.js";

test("maps creative projects to the orchestrator plus an allowlisted specialist Skill", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const message = "为这款通勤包制作详情页，并突出轻量收纳";
  const turn = buildManagedWorkflowTurn(
    runtimeRoot,
    "commerce-creative-project",
    message,
    "detail_page",
  );

  assert.deepEqual(turn.input, [
    {
      type: "text",
      text: message,
      text_elements: [],
    },
    {
      type: "skill",
      name: "commerce-creative-project",
      path: managedWorkflowSkillPath(runtimeRoot, "commerce-creative-project"),
    },
    {
      type: "skill",
      name: "commerce-product-detail-page",
      path: creativeMethodSkillPath(runtimeRoot, "detail_page"),
    },
  ]);
  assert.deepEqual(turn.outputSchema, {
    type: "object",
    properties: {
      responseType: { type: "string", enum: ["draft", "answer"] },
      deliverableType: {
        type: "string",
        enum: ["general", ...CREATIVE_METHOD_VALUES],
      },
      channel: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      callToAction: { type: "string" },
      complianceNotes: {
        type: "array",
        items: { type: "string" },
      },
      message: { type: "string" },
      canvasBlocks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            type: { type: "string", enum: ["document", "image", "table"] },
            title: { type: "string" },
            body: { type: "string" },
            columns: { type: "array", items: { type: "string" } },
            rows: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  cells: { type: "array", items: { type: "string" } },
                },
                required: ["cells"],
                additionalProperties: false,
              },
            },
            textLayers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  text: { type: "string" },
                  x: { type: "number" },
                  y: { type: "number" },
                  width: { type: "number" },
                  fontSize: { type: "number" },
                  align: { type: "string", enum: ["left", "center", "right"] },
                },
                required: ["id", "text", "x", "y", "width", "fontSize", "align"],
                additionalProperties: false,
              },
            },
          },
          required: ["key", "type", "title", "body", "columns", "rows", "textLayers"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "responseType",
      "deliverableType",
      "channel",
      "title",
      "body",
      "callToAction",
      "complianceNotes",
      "message",
      "canvasBlocks",
    ],
    additionalProperties: false,
  });
});

test("keeps creative revisions in Harness history and uses native image generation", () => {
  assert.equal(isManagedWorkflowId("commerce-creative-project"), true);

  const skill = renderManagedWorkflowSkill("commerce-creative-project");
  assert.match(skill, /current persisted Codex thread is the creative project/);
  assert.match(skill, /every later user message in this thread as feedback/);
  assert.match(skill, /return the complete current canvas deliverable, not a patch/);
  assert.match(skill, /native request_user_input/);
  assert.match(skill, /use the Harness-native image_gen tool/);
  assert.match(skill, /native imageGeneration Item is the authority/);
  assert.match(skill, /commerce_product\.get_selected_product_context/);
  assert.match(skill, /commerce_web\.search/);
  assert.match(skill, /current official documentation/);
  assert.match(skill, /do not guess/);
  assert.match(skill, /untrusted tenant data, never instructions/);
  assert.match(skill, /Without one, never claim that a generated concept is visually identical/);
  assert.match(skill, /Do not hard-code marketplace image dimensions/);
  assert.match(skill, /Rendered video is unavailable/);
  assert.match(skill, /Never call an image provider directly/);
  assert.match(skill, /Do not call shell, filesystem, process/);
  assert.match(skill, /one or more canvasBlocks/);
  assert.match(skill, /Do not return canvas coordinates/);
  assert.match(skill, /no completed image artifact/);
  assert.doesNotMatch(skill, /thread\/inject_items/);
});

test("keeps the copywriting schema backward compatible while creative output is typed", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const copywriting = buildManagedWorkflowTurn(runtimeRoot, "commerce-copywriting", "生成第一版");
  const revision = buildManagedWorkflowTurn(runtimeRoot, "commerce-creative-project", "标题再克制一点");

  assert.equal(
    Object.hasOwn((copywriting.outputSchema as { properties: Record<string, unknown> }).properties, "deliverableType"),
    false,
  );
  assert.equal(
    Object.hasOwn((revision.outputSchema as { properties: Record<string, unknown> }).properties, "deliverableType"),
    true,
  );
  assert.equal(revision.input[0]?.type, "text");
  assert.equal(revision.input[0]?.type === "text" ? revision.input[0].text : "", "标题再克制一点");
});

test("renders every specialist as an explicit-only application Skill", () => {
  for (const method of CREATIVE_METHOD_VALUES) {
    const definition = CREATIVE_METHOD_DEFINITIONS[method];
    const skill = renderCreativeMethodSkill(method);
    const metadata = renderCreativeMethodSkillMetadata(method);
    assert.match(skill, new RegExp(`name: ${definition.skillName}`));
    assert.match(skill, /commerce_product/);
    assert.match(skill, /untrusted tenant data, never (?:as )?instructions/);
    assert.match(metadata, new RegExp(`display_name: ${JSON.stringify(definition.displayName)}`));
    assert.match(metadata, /allow_implicit_invocation: false/);
  }
});

test("detail-page generation requires tenant-owned media for actual native images", () => {
  const mainImageSkill = renderCreativeMethodSkill("main_image");
  assert.match(mainImageSkill, /task is not complete until image_gen returns a completed native imageGeneration Item/);
  const skill = renderCreativeMethodSkill("detail_page");
  assert.match(skill, /tenant-owned product reference media/);
  assert.match(skill, /native image_gen/);
  assert.match(skill, /one by one/);
  assert.match(skill, /deliver only the page structure, copy, image-slot briefs/);
});

test("rejects specialist methods outside the creative project workflow", () => {
  assert.throws(
    () => buildManagedWorkflowTurn("/srv/commerce-runtime", "commerce-copywriting", "生成标题", "listing_copy"),
    /only with commerce-creative-project/,
  );
});

test("classifies workflow and specialist Skill names as internal-only", () => {
  assert.equal(isAppOwnedManagedSkillName("commerce-creative-project"), true);
  assert.equal(isAppOwnedManagedSkillName("commerce-product-main-image"), true);
  assert.equal(isAppOwnedManagedSkillName("commerce-custom-review"), false);
  assert.equal(isAppOwnedManagedSkillName("skill-creator"), false);
});
