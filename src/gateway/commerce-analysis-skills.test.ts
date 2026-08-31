import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCommerceProductInsightOutputSchema,
  COMMERCE_INSIGHT_METHODS,
  getCommerceInsightMethodDefinition,
  renderCommerceInsightMethodSkill,
  renderCommerceInsightMethodSkillMetadata,
} from "../codex/commerce-analysis-skills.js";

test("defines the closed product-insight method and specialist Skill registry", () => {
  assert.deepEqual(COMMERCE_INSIGHT_METHODS, [
    "market_research",
    "new_product_development",
    "product_retrospective",
  ]);

  assert.equal(
    getCommerceInsightMethodDefinition("market_research").skillName,
    "commerce-market-research",
  );
  assert.equal(
    getCommerceInsightMethodDefinition("new_product_development").skillName,
    "commerce-new-product-development",
  );
  assert.equal(
    getCommerceInsightMethodDefinition("product_retrospective").skillName,
    "commerce-product-retrospective",
  );

  assert.throws(
    () => renderCommerceInsightMethodSkill("market_research"),
    /legacy managed market-research Skill/,
  );
});

test("renders instruction-only, explicit specialist Skills for product insights", () => {
  for (const method of ["new_product_development", "product_retrospective"] as const) {
    const definition = getCommerceInsightMethodDefinition(method);
    const skill = renderCommerceInsightMethodSkill(method);
    const metadata = renderCommerceInsightMethodSkillMetadata(method);

    assert.match(skill, new RegExp(`name: ${definition.skillName}`));
    assert.match(skill, /Codex App Server owns the Turn/);
    assert.match(skill, /native request_user_input/);
    assert.match(skill, /commerce_product/);
    assert.match(skill, /commerce_data/);
    assert.match(skill, /Do not use shell/);
    assert.doesNotMatch(skill, /scripts\//);
    assert.match(metadata, /allow_implicit_invocation: false/);
  }
});

test("new-product development stays evidence-backed and stops before a launch or write", () => {
  const skill = renderCommerceInsightMethodSkill("new_product_development");

  assert.match(skill, /commerce_product\.get_selected_product_context/);
  assert.match(skill, /commerce_data\.search_business_data/);
  assert.match(skill, /commerce_data\.list_marketplace_research_platforms/);
  assert.match(skill, /commerce_data\.get_marketplace_options/);
  assert.match(skill, /commerce_data\.plan_marketplace_research/);
  assert.match(skill, /commerce_data\.execute_marketplace_research/);
  assert.match(skill, /reviewEvidenceCount=0/);
  assert.match(skill, /Price evidence supports a market-position hypothesis/);
  assert.match(skill, /validation status is hypothesis only/);
  assert.match(skill, /unexplained aggregate is a prohibited black-box score/);
  assert.match(skill, /MUST use evidenceState=unavailable, score=0/);
  assert.match(skill, /decisionGate is a decision recommendation only/);
  assert.match(skill, /status=proposed/);
  assert.match(skill, /decisionGate\.status=insufficient_evidence/);
  assert.match(skill, /experiments=\[\]/);
  assert.match(skill, /must not recruit users, place orders, create products, publish listings/);
  assert.match(skill, /No governed company-performance tool is currently registered/);
  assert.match(skill, /current schema rejects company_metric/);
  assert.match(skill, /keep companyEvidenceRefs empty/);
  assert.match(skill, /category-only comparison between external competitors may use evidenceIds with empty productFactRefs/);
  assert.match(skill, /requires Product fact references only when it uses or constrains a selected company Product/);
  assert.match(skill, /Use insightType=new_product_development/);
  assert.match(skill, /Product ids, revision ids, subject refs, snapshot hashes/);
});

test("product retrospective fails honest when company performance evidence is absent", () => {
  const skill = renderCommerceInsightMethodSkill("product_retrospective");

  assert.match(skill, /requires one or more selected canonical company products/);
  assert.match(skill, /first grounding action MUST be commerce_product\.get_selected_product_context/);
  assert.match(skill, /use responseType=answer/);
  assert.match(skill, /do not provide the company's orders, units sold, GMV\/revenue/);
  assert.match(skill, /first-party performance is not connected/);
  assert.match(skill, /public marketplace sales display/);
  assert.match(skill, /reviewEvidenceCount=0/);
  assert.match(skill, /effect on conversion, traffic, or sales remains a hypothesis/);
  assert.match(skill, /unexplained aggregate is a prohibited black-box score/);
  assert.match(skill, /MUST use evidenceState=unavailable, score=0/);
  assert.match(skill, /decisionGate is a decision recommendation only/);
  assert.match(skill, /status=proposed/);
  assert.match(skill, /decisionGate\.status=insufficient_evidence/);
  assert.match(skill, /experiments=\[\]/);
  assert.match(skill, /current schema rejects company_metric/);
  assert.match(skill, /keep companyEvidenceRefs empty/);
  assert.match(skill, /do not output company-performance comparisons, ROI conclusions/);
  assert.match(skill, /core requested outcome depends only on unavailable company operating metrics/);
  assert.match(skill, /return responseType=answer immediately/);
  assert.match(skill, /do not call plan_marketplace_research, execute_marketplace_research, or research_social_content/);
  assert.match(skill, /Before any paid planning, use native request_user_input/);
  assert.match(skill, /only after explicit acceptance/);
  assert.match(skill, /every recommended action is not executed/);
  assert.match(skill, /insightType=product_retrospective/);
});

test("shares one method-fixed insight report schema without inventing a second report protocol", () => {
  const schema = buildCommerceProductInsightOutputSchema("market_research") as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, [
    "responseType",
    "insightType",
    "subject",
    "scope",
    "scorecard",
    "decisionGate",
    "experiments",
    "executiveSummary",
    "reportMarkdown",
    "claims",
    "receipts",
    "recommendations",
    "message",
  ]);

  const insightType = schema.properties.insightType as { enum: string[] };
  assert.deepEqual(insightType.enum, ["market_research"]);

  for (const method of COMMERCE_INSIGHT_METHODS) {
    const methodSchema = buildCommerceProductInsightOutputSchema(method) as {
      properties: { insightType: { enum: string[] } };
    };
    assert.deepEqual(methodSchema.properties.insightType.enum, [method]);
  }

  const claims = schema.properties.claims as {
    items: {
      required: string[];
      properties: Record<string, { enum?: string[] }>;
    };
  };
  assert.deepEqual(claims.items.properties.type.enum, [
    "product_fact",
    "market_signal",
    "derived_comparison",
    "hypothesis",
  ]);
  assert.ok(claims.items.required.includes("companyEvidenceRefs"));
  assert.deepEqual(claims.items.properties.companyEvidenceRefs, {
    type: "array",
    items: { type: "string" },
    maxItems: 0,
  });

  const recommendations = schema.properties.recommendations as {
    items: {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, unknown>;
    };
  };
  assert.equal(recommendations.items.additionalProperties, false);
  assert.deepEqual(recommendations.items.required, [
    "recommendationId",
    "priority",
    "title",
    "rationale",
    "evidenceIds",
    "productFactRefs",
    "companyEvidenceRefs",
    "validationMetric",
    "timeHorizon",
  ]);
  assert.deepEqual(recommendations.items.properties.companyEvidenceRefs, {
    type: "array",
    items: { type: "string" },
    maxItems: 0,
  });

  const scorecard = schema.properties.scorecard as {
    required: string[];
    additionalProperties: boolean;
    properties: {
      weightedScore: Record<string, unknown>;
      confidence: { enum: string[] };
      dimensions: {
        items: {
          required: string[];
          additionalProperties: boolean;
          properties: Record<string, Record<string, unknown>>;
        };
      };
    };
  };
  assert.equal(scorecard.additionalProperties, false);
  assert.deepEqual(scorecard.required, ["weightedScore", "confidence", "dimensions"]);
  assert.deepEqual(scorecard.properties.weightedScore, {
    type: "number",
    minimum: 0,
    maximum: 100,
  });
  assert.deepEqual(scorecard.properties.confidence.enum, ["high", "medium", "low"]);
  assert.equal(scorecard.properties.dimensions.items.additionalProperties, false);
  assert.deepEqual(scorecard.properties.dimensions.items.required, [
    "dimensionId",
    "label",
    "score",
    "weight",
    "evidenceState",
    "rationale",
    "evidenceIds",
    "productFactRefs",
    "companyEvidenceRefs",
    "limitations",
  ]);
  assert.deepEqual(scorecard.properties.dimensions.items.properties.score, {
    type: "number",
    minimum: 0,
    maximum: 100,
  });
  assert.deepEqual(scorecard.properties.dimensions.items.properties.weight, {
    type: "number",
    minimum: 0,
    maximum: 1,
  });
  assert.deepEqual(scorecard.properties.dimensions.items.properties.evidenceState, {
    type: "string",
    enum: ["supported", "mixed", "hypothesis", "unavailable"],
  });
  assert.deepEqual(scorecard.properties.dimensions.items.properties.companyEvidenceRefs, {
    type: "array",
    items: { type: "string" },
    maxItems: 0,
  });

  const decisionGate = schema.properties.decisionGate as {
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, Record<string, unknown>>;
  };
  assert.equal(decisionGate.additionalProperties, false);
  assert.deepEqual(decisionGate.required, [
    "status",
    "summary",
    "blockingGaps",
    "requiredEvidence",
  ]);
  assert.deepEqual(decisionGate.properties.status, {
    type: "string",
    enum: ["proceed", "validate", "hold", "insufficient_evidence"],
  });

  const experiments = schema.properties.experiments as {
    items: {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, Record<string, unknown>>;
    };
  };
  assert.equal(experiments.items.additionalProperties, false);
  assert.deepEqual(experiments.items.required, [
    "experimentId",
    "title",
    "hypothesis",
    "method",
    "successSignal",
    "stopCondition",
    "evidenceNeeded",
    "evidenceIds",
    "productFactRefs",
    "status",
  ]);
  assert.deepEqual(experiments.items.properties.status, {
    type: "string",
    enum: ["proposed"],
  });

  for (const prohibited of [
    "opportunities",
    "concepts",
    "validationExperiments",
    "rootCauseHypotheses",
    "actions",
  ]) {
    assert.equal(schema.properties[prohibited], undefined);
  }
});
