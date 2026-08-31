import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMERCE_INSIGHT_METHODS,
  getCommerceInsightMethodDefinition,
  renderCommerceInsightMethodSkill,
  renderCommerceInsightMethodSkillMetadata,
} from "../codex/commerce-analysis-skills.js";
import {
  buildManagedWorkflowTurn,
  commerceInsightMethodRequiresSelectedProduct,
  commerceInsightMethodSkillPath,
  isAppOwnedManagedSkillName,
  isCommerceInsightMethod,
  isManagedWorkflowId,
  managedWorkflowSkillPath,
  renderManagedWorkflowSkill,
} from "../codex/managed-workflows.js";

test("maps every product-insight method to one orchestrator and one native specialist Skill", () => {
  const runtimeRoot = "/srv/commerce-runtime";
  const message = "基于真实证据给出下一步商品决策";

  for (const method of COMMERCE_INSIGHT_METHODS) {
    const specialist = getCommerceInsightMethodDefinition(method);
    const turn = buildManagedWorkflowTurn(
      runtimeRoot,
      "commerce-product-insight",
      message,
      null,
      method,
    );

    assert.deepEqual(turn.input, [
      { type: "text", text: message, text_elements: [] },
      {
        type: "skill",
        name: "commerce-product-insight",
        path: managedWorkflowSkillPath(runtimeRoot, "commerce-product-insight"),
      },
      {
        type: "skill",
        name: specialist.skillName,
        path: commerceInsightMethodSkillPath(runtimeRoot, method),
      },
    ]);
  }
});

test("uses one fixed structured insight schema while retaining explicit evidence lineage", () => {
  const turn = buildManagedWorkflowTurn(
    "/srv/commerce-runtime",
    "commerce-product-insight",
    "复盘这个产品",
    null,
    "product_retrospective",
  );
  assert.ok(turn.outputSchema);
  const schema = turn.outputSchema as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assert.ok(schema.required.includes("insightType"));
  assert.ok(schema.required.includes("recommendations"));
  const insightType = schema.properties.insightType as { enum: string[] };
  assert.deepEqual(insightType.enum, ["product_retrospective"]);
  assert.ok(schema.properties.subject);
  assert.ok(schema.properties.scope);
  assert.ok(schema.properties.claims);
  assert.ok(schema.properties.receipts);

  const claims = schema.properties.claims as {
    items: { properties: Record<string, unknown>; required: string[] };
  };
  const claimType = claims.items.properties.type as { enum: string[] };
  assert.equal(claimType.enum.includes("company_metric"), false);
  assert.ok(claims.items.required.includes("companyEvidenceRefs"));

  const recommendations = schema.properties.recommendations as {
    items: { properties: Record<string, unknown>; required: string[] };
  };
  assert.ok(recommendations.items.required.includes("companyEvidenceRefs"));
  assert.ok(recommendations.items.required.includes("validationMetric"));
  assert.ok(recommendations.items.required.includes("timeHorizon"));
});

test("pins a selected Product subject into the native Harness output schema", () => {
  const turn = buildManagedWorkflowTurn(
    "/srv/commerce-runtime",
    "commerce-product-insight",
    "复盘已选产品",
    null,
    "product_retrospective",
    {
      mode: "selected",
      subjectRef: "2c03d4d8-1d9d-4435-bf0b-86f5c4658c61",
      snapshotSha256: "a".repeat(64),
      productCount: 2,
    },
  );
  const schema = turn.outputSchema as {
    properties: {
      subject: { properties: Record<string, unknown> };
    };
  };
  assert.deepEqual(schema.properties.subject.properties.mode, {
    type: "string",
    enum: ["selected"],
  });
  assert.deepEqual(schema.properties.subject.properties.subjectRef, {
    type: "string",
    enum: ["2c03d4d8-1d9d-4435-bf0b-86f5c4658c61"],
  });
  assert.deepEqual(schema.properties.subject.properties.snapshotSha256, {
    type: "string",
    enum: ["a".repeat(64)],
  });
  assert.deepEqual(schema.properties.subject.properties.productCount, {
    type: "integer",
    enum: [2],
  });
});

test("pins non-selected Product context mode without inventing a subject identity", () => {
  const turn = buildManagedWorkflowTurn(
    "/srv/commerce-runtime",
    "commerce-product-insight",
    "分析新品机会",
    null,
    "new_product_development",
    { mode: "auto" },
  );
  const schema = turn.outputSchema as {
    properties: {
      subject: { properties: Record<string, unknown> };
    };
  };
  assert.deepEqual(schema.properties.subject.properties.mode, {
    type: "string",
    enum: ["auto"],
  });
  assert.deepEqual(schema.properties.subject.properties.subjectRef, { type: "string" });
});

test("upgrades future legacy market-research Turns to the shared Harness report contract", () => {
  const legacy = buildManagedWorkflowTurn(
    "/srv/commerce-runtime",
    "commerce-market-research",
    "继续之前的市场调研",
  );
  assert.equal(legacy.input.length, 3);
  assert.deepEqual(legacy.input.slice(1), [
    {
      type: "skill",
      name: "commerce-product-insight",
      path: managedWorkflowSkillPath("/srv/commerce-runtime", "commerce-product-insight"),
    },
    {
      type: "skill",
      name: "commerce-market-research",
      path: commerceInsightMethodSkillPath("/srv/commerce-runtime", "market_research"),
    },
  ]);
  const schema = legacy.outputSchema as { properties: { insightType: { enum: string[] } } };
  assert.deepEqual(schema.properties.insightType.enum, ["market_research"]);
});

test("rejects browser-authored workflow and method combinations outside the closed registry", () => {
  assert.equal(isManagedWorkflowId("commerce-product-insight"), true);
  assert.equal(isManagedWorkflowId("commerce-product-insight-custom"), false);
  assert.equal(isCommerceInsightMethod("market_research"), true);
  assert.equal(isCommerceInsightMethod("../../custom-skill"), false);
  assert.equal(commerceInsightMethodRequiresSelectedProduct("product_retrospective"), true);
  assert.equal(commerceInsightMethodRequiresSelectedProduct("market_research"), false);
  assert.equal(commerceInsightMethodRequiresSelectedProduct("new_product_development"), false);

  assert.throws(
    () => buildManagedWorkflowTurn(
      "/srv/commerce-runtime",
      "commerce-product-insight",
      "分析",
    ),
    /requires one allowlisted product insight method/,
  );
  assert.throws(
    () => buildManagedWorkflowTurn(
      "/srv/commerce-runtime",
      "commerce-market-research",
      "分析",
      null,
      "new_product_development",
    ),
    /only with commerce-product-insight/,
  );
  assert.throws(
    () => buildManagedWorkflowTurn(
      "/srv/commerce-runtime",
      "commerce-copywriting",
      "分析",
      null,
      null,
      { mode: "none" },
    ),
    /requires a product insight workflow/,
  );
});

test("renders application-owned specialist Skills with Harness and enterprise evidence gates", () => {
  const orchestrator = renderManagedWorkflowSkill("commerce-product-insight");
  assert.match(orchestrator, /persisted Codex thread is the complete method conversation/);
  assert.match(orchestrator, /never create a parallel Agent loop/);
  assert.match(orchestrator, /insightType must match the attached specialist method/);
  assert.match(orchestrator, /actual governed commerce_data receipt whose reviewEvidenceCount is greater than zero/);
  assert.match(orchestrator, /return responseType=answer/);
  assert.match(orchestrator, /Never use Web Search, product details, prices, sales displays, review counts, social content/);

  for (const method of ["new_product_development", "product_retrospective"] as const) {
    const definition = getCommerceInsightMethodDefinition(method);
    const skill = renderCommerceInsightMethodSkill(method);
    const metadata = renderCommerceInsightMethodSkillMetadata(method);
    assert.match(skill, new RegExp(`name: ${definition.skillName}`));
    assert.match(skill, /commerce_product/);
    assert.match(skill, /commerce_data/);
    assert.match(skill, /native request_user_input/);
    assert.match(skill, /Do not create a parallel Agent loop/);
    assert.match(metadata, /allow_implicit_invocation: false/);
    assert.equal(isAppOwnedManagedSkillName(definition.skillName), true);
  }

  const retrospective = renderCommerceInsightMethodSkill("product_retrospective");
  assert.match(retrospective, /orders, units sold, GMV\/revenue/);
  assert.match(retrospective, /do not claim.*ROI|Never.*ROI/is);
  assert.match(retrospective, /Immediately after reading the selected Product/);
  assert.match(retrospective, /return responseType=answer immediately/);
  assert.match(retrospective, /do not call plan_marketplace_research, execute_marketplace_research, or research_social_content/);
  assert.match(retrospective, /Before any paid planning, use native request_user_input/);
  assert.match(retrospective, /Proceed with marketplace planning only after explicit acceptance/);
});
