import { describe, expect, it } from "vitest";

import { parseMarketResearchResponse } from "./market-report";

const base = {
  subject: {
    mode: "selected",
    title: "手工耐热砂锅",
    subjectRef: "product:33333333-3333-4333-8333-333333333333",
    snapshotSha256: "a".repeat(64),
    productCount: 1,
    factLimitations: ["产品成本字段缺失。"],
  },
  scope: {
    decisionObjective: "判断核心卖点和市场进入机会",
    platforms: ["淘宝"],
    markets: ["中国大陆"],
    period: "2026-08",
    requestedEvidence: ["价格", "评论"],
  },
  executiveSummary: "耐热和小容量场景值得优先验证。",
  reportMarkdown: "## 关键发现\n\n真实评论反复提到清洗难度。",
  claims: [{
    claimId: "claim-1",
    type: "market_signal",
    text: "清洗便利性是高频用户痛点。",
    evidenceIds: ["research-request-1:evidence-1"],
    productFactRefs: [],
    confidence: "medium",
    limitations: ["样本只覆盖一个平台。"],
  }],
  receipts: [{
    researchRequestId: "research-request-1",
    platform: "淘宝",
    observedAt: "2026-08-31T00:00:00.000Z",
    evidenceCount: 24,
    reviewEvidenceCount: 18,
    evidenceKinds: ["product", "review"],
    coverageSummary: "24 条质量检查后评论证据",
    limitations: ["不代表全部成交用户。"],
  }],
  message: "已完成产品市场调研。",
};

describe("parseMarketResearchResponse", () => {
  it("accepts the fixed Harness report schema and fenced JSON", () => {
    const response = parseMarketResearchResponse(`\`\`\`json\n${JSON.stringify({
      responseType: "report",
      ...base,
    })}\n\`\`\``);
    expect(response?.responseType).toBe("report");
    expect(response?.claims[0]?.type).toBe("market_signal");
    expect(response?.receipts[0]?.evidenceCount).toBe(24);
    expect(response?.insightType).toBe("market_research");
    expect(response?.recommendations).toEqual([]);
    expect(response?.claims[0]?.companyEvidenceRefs).toEqual([]);
    expect(response?.scorecard).toBeNull();
  });

  it("accepts the commercial scorecard, decision gate, and proposed experiment contract", () => {
    const response = parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      insightType: "new_product_development",
      ...base,
      scorecard: {
        weightedScore: 66,
        confidence: "medium",
        dimensions: [{
          dimensionId: "competition",
          label: "竞争强度",
          score: 58,
          weight: 0.25,
          evidenceState: "mixed",
          rationale: "竞品数量高，但细分规格仍有空白。",
          evidenceIds: ["research-request-1:evidence-1"],
          productFactRefs: [],
          companyEvidenceRefs: [],
          limitations: ["只覆盖一个平台"],
        }],
      },
      decisionGate: {
        status: "validate",
        summary: "进入小规模验证。",
        blockingGaps: ["供应链成本未接入"],
        requiredEvidence: ["样品成本", "真实评论"],
      },
      experiments: [{
        experimentId: "experiment-1",
        title: "价格带概念测试",
        hypothesis: "目标用户接受中高价定位。",
        method: "两版落地页意向测试",
        successSignal: "高价版有效意向不低于基准版",
        stopCondition: "连续两轮低于基准版则停止",
        evidenceNeeded: ["落地页点击与留资"],
        evidenceIds: ["research-request-1:evidence-1"],
        productFactRefs: [],
        status: "proposed",
      }],
    }));
    expect(response?.scorecard?.dimensions[0]?.weight).toBe(0.25);
    expect(response?.decisionGate?.status).toBe("validate");
    expect(response?.experiments[0]?.status).toBe("proposed");
  });

  it("fails closed on company metrics until a governed operating-data tool exists", () => {
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      insightType: "product_retrospective",
      ...base,
      claims: [{
        claimId: "company-1",
        type: "company_metric",
        text: "附件中的退货率需要与订单系统口径核验。",
        evidenceIds: [],
        productFactRefs: [],
        companyEvidenceRefs: ["attachment:return-report:return-rate"],
        confidence: "medium",
        limitations: ["未连接订单系统"],
      }],
      recommendations: [{
        recommendationId: "recommendation-1",
        priority: "high",
        title: "核对退货原因口径",
        rationale: "附件数据尚未与受控订单源完成对账。",
        evidenceIds: [],
        productFactRefs: ["product.title"],
        companyEvidenceRefs: ["attachment:return-report:return-rate"],
        validationMetric: "订单系统与附件退货率差异小于 1 个百分点",
        timeHorizon: "7 天",
      }],
    }))).toBeNull();
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      insightType: "product_retrospective",
      ...base,
      recommendations: [{
        recommendationId: "recommendation-1",
        priority: "high",
        title: "核对退货原因口径",
        rationale: "先接入受控订单数据。",
        evidenceIds: [],
        productFactRefs: ["product.title"],
        companyEvidenceRefs: ["attachment:return-report:return-rate"],
        validationMetric: "完成受控数据源对账",
        timeHorizon: "待接入后",
      }],
    }))).toBeNull();
  });

  it("accepts a conversational answer while retaining all fixed fields", () => {
    const response = parseMarketResearchResponse(JSON.stringify({
      responseType: "answer",
      ...base,
      executiveSummary: "",
      reportMarkdown: "",
      claims: [],
      receipts: [],
      message: "请先选择要研究的平台。",
    }));
    expect(response).toMatchObject({ responseType: "answer", message: "请先选择要研究的平台。" });
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "answer",
      ...base,
      executiveSummary: "",
      reportMarkdown: "",
      claims: [],
      receipts: [],
      recommendations: [],
      scorecard: { weightedScore: 0, confidence: "low", dimensions: [] },
      decisionGate: {
        status: "insufficient_evidence",
        summary: "范围不足",
        blockingGaps: ["缺少市场"],
        requiredEvidence: ["目标市场"],
      },
      experiments: [],
      message: "请先选择要研究的平台。",
    }))).toMatchObject({
      responseType: "answer",
      decisionGate: { status: "insufficient_evidence" },
    });
  });

  it("fails closed on extra fields, missing report Markdown, or malformed receipt counts", () => {
    expect(parseMarketResearchResponse(JSON.stringify({ responseType: "report", ...base, rawArchive: {} }))).toBeNull();
    expect(parseMarketResearchResponse(JSON.stringify({ responseType: "report", ...base, reportMarkdown: "" }))).toBeNull();
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      ...base,
      receipts: [{ ...base.receipts[0], evidenceCount: -1 }],
    }))).toBeNull();
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      ...base,
      receipts: [{ ...base.receipts[0], evidenceCount: 4, reviewEvidenceCount: 5 }],
    }))).toBeNull();
  });

  it("requires each confirmed claim to bind the correct fact and evidence lineage", () => {
    const invalidClaims = [
      { ...base.claims[0], type: "product_fact", evidenceIds: [], productFactRefs: [] },
      { ...base.claims[0], type: "market_signal", evidenceIds: [], productFactRefs: [] },
      { ...base.claims[0], type: "derived_comparison", evidenceIds: ["evidence-1"], productFactRefs: [] },
      { ...base.claims[0], type: "derived_comparison", evidenceIds: [], productFactRefs: ["product.title"] },
    ];
    for (const claim of invalidClaims) {
      expect(parseMarketResearchResponse(JSON.stringify({
        responseType: "report",
        ...base,
        claims: [claim],
      }))).toBeNull();
    }
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      ...base,
      claims: [{
        ...base.claims[0],
        type: "derived_comparison",
        evidenceIds: ["evidence-1"],
        productFactRefs: ["product.title"],
      }],
    }))).not.toBeNull();
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      ...base,
      claims: [{
        ...base.claims[0],
        type: "derived_comparison",
        evidenceIds: ["evidence-1", "evidence-2"],
        productFactRefs: [],
      }],
    }))).not.toBeNull();
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "report",
      ...base,
      claims: [{
        ...base.claims[0],
        type: "company_metric",
        evidenceIds: [],
        productFactRefs: [],
        companyEvidenceRefs: ["attachment:unverified"],
      }],
    }))).toBeNull();
  });

  it("rejects report payloads hidden inside a normal conversational answer", () => {
    expect(parseMarketResearchResponse(JSON.stringify({
      responseType: "answer",
      ...base,
      message: "这是普通回答。",
    }))).toBeNull();
  });
});
