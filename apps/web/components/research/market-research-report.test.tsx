import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MarketResearchResponse } from "@/lib/research/market-report";
import type { AgentActivity } from "@/lib/agent/use-agent-thread";

import { MarketResearchReportView } from "./market-research-report";

function report(overrides: Partial<MarketResearchResponse> = {}): MarketResearchResponse {
  return {
    responseType: "report",
    insightType: "market_research",
    subject: {
      mode: "selected",
      title: "手工耐热砂锅",
      subjectRef: "product:33333333-3333-4333-8333-333333333333",
      snapshotSha256: "a".repeat(64),
      productCount: 1,
      factLimitations: [],
    },
    scope: {
      decisionObjective: "验证卖点与用户痛点",
      platforms: ["淘宝"],
      markets: ["中国大陆"],
      period: "2026-08",
      requestedEvidence: ["评论"],
    },
    executiveSummary: "耐热是产品事实，清洗困难仍需市场证据验证。",
    reportMarkdown: "## 卖点与痛点\n\n报告正文。",
    claims: [
      {
        claimId: "fact-1",
        type: "product_fact",
        text: "产品标注为耐热材质。",
        evidenceIds: [],
        productFactRefs: ["product.attributes.material"],
        companyEvidenceRefs: [],
        confidence: "high",
        limitations: [],
      },
      {
        claimId: "hypothesis-1",
        type: "hypothesis",
        text: "用户可能关注清洗便利性。",
        evidenceIds: [],
        productFactRefs: [],
        companyEvidenceRefs: [],
        confidence: "low",
        limitations: ["没有评论证据"],
      },
    ],
    receipts: [{
      researchRequestId: "research-request-1",
      platform: "淘宝",
      observedAt: "2026-08-31T00:00:00.000Z",
      evidenceCount: 8,
      reviewEvidenceCount: 0,
      evidenceKinds: ["product"],
      coverageSummary: "8 条商品证据",
      limitations: ["本次工作流未提供评论步骤。"],
    }],
    recommendations: [],
    scorecard: null,
    decisionGate: null,
    experiments: [],
    message: "报告已完成。",
    ...overrides,
  };
}

describe("MarketResearchReportView", () => {
  it("renders a Harness report projection with explicit fact, evidence and inference boundaries", () => {
    const html = renderToStaticMarkup(<MarketResearchReportView response={report({
      claims: [
        ...report().claims,
        {
          claimId: "signal-1",
          type: "market_signal",
          text: "评论中出现清洗困难。",
          evidenceIds: ["research-request-1:evidence-1"],
          productFactRefs: [],
          companyEvidenceRefs: [],
          confidence: "medium",
          limitations: [],
        },
      ],
    })} />);
    expect(html).toContain("产品事实");
    expect(html).toContain("市场证据");
    expect(html).toContain("AI 推断");
    expect(html).toContain("数据回执与证据");
    expect(html).toContain("研究回执：research-request-1");
    expect(html).toContain("依据 · 产品事实 1 · 市场证据 0");
    expect(html).toContain("product.attributes.material");
    expect(html).toContain("报告引用待核对");
  });

  it("renders an explainable scorecard, decision gate, experiments, and authoritative receipt status", () => {
    const activities: AgentActivity[] = [{
      id: "activity-1",
      sequence: 3,
      turnId: "turn-1",
      kind: "tool",
      label: "获取市场证据",
      status: "completed",
      research: {
        kind: "evidence",
        researchRequestId: "research-request-1",
        platform: "淘宝",
        observedAt: "2026-08-31T00:00:00.000Z",
        evidenceCount: 8,
        reviewEvidenceCount: 0,
        coverage: {
          acceptedProducts: 8,
          acceptedEvidence: 8,
          reviewStepsCompleted: 0,
          reviewStepAvailable: false,
          requestedMetrics: ["price"],
          missingRequestedMetrics: ["review"],
        },
        limitations: ["没有评论步骤"],
      },
    }];
    const html = renderToStaticMarkup(<MarketResearchReportView
      activities={activities}
      response={report({
        scorecard: {
          weightedScore: 68,
          confidence: "medium",
          dimensions: [{
            dimensionId: "demand",
            label: "需求信号",
            score: 72,
            weight: 0.3,
            evidenceState: "supported",
            rationale: "已获得价格和商品覆盖证据。",
            evidenceIds: ["research-request-1:evidence-1"],
            productFactRefs: [],
            companyEvidenceRefs: [],
            limitations: [],
          }],
        },
        decisionGate: {
          status: "validate",
          summary: "先做小规模验证。",
          blockingGaps: ["缺少评论证据"],
          requiredEvidence: ["真实买家评论"],
        },
        experiments: [{
          experimentId: "experiment-1",
          title: "验证清洗便利性",
          hypothesis: "易清洁是高价值差异点。",
          method: "小样盲测",
          successSignal: "目标用户能明确感知差异",
          stopCondition: "差异不可感知则停止",
          evidenceNeeded: ["盲测记录"],
          evidenceIds: [],
          productFactRefs: ["product.title"],
          status: "proposed",
        }],
      })}
    />);
    expect(html).toContain("决策 Gate · 小规模验证");
    expect(html).toContain("可解释机会 Scorecard");
    expect(html).toContain("需求信号");
    expect(html).toContain("权重 30%");
    expect(html).toContain("验证实验");
    expect(html).toContain("已核验 1 / 1 份市场回执");
    expect(html).toContain("已与本任务 Harness 工具回执核对");
  });

  it("renders product-development recommendations with verification metrics", () => {
    const html = renderToStaticMarkup(<MarketResearchReportView response={report({
      insightType: "new_product_development",
      recommendations: [{
        recommendationId: "rec-1",
        priority: "high",
        title: "验证易清洁内壁方案",
        rationale: "评论证据反复出现清洗困难。",
        evidenceIds: ["research-request-1:evidence-1"],
        productFactRefs: [],
        companyEvidenceRefs: [],
        validationMetric: "样品盲测中清洗满意率达到 80%",
        timeHorizon: "4 周",
      }],
    })} />);
    expect(html).toContain("新品开发方案");
    expect(html).toContain("建议动作");
    expect(html).toContain("验证易清洁内壁方案");
    expect(html).toContain("样品盲测中清洗满意率达到 80%");
  });

  it("labels a product retrospective without implying company metrics are connected", () => {
    const html = renderToStaticMarkup(<MarketResearchReportView response={report({
      insightType: "product_retrospective",
    })} />);
    expect(html).toContain("产品复盘报告");
    expect(html).toContain("企业经营指标尚未接入");
    expect(html).not.toContain("attachment:sales-report:repeat-rate");
  });

  it("warns that pain points are unconfirmed when accepted review evidence is zero", () => {
    const html = renderToStaticMarkup(<MarketResearchReportView response={report()} />);
    expect(html).toContain("没有买家评论证据");
    expect(html).toContain("不能标记为已证实");
  });

  it("renders a normal Harness answer without creating a report surface", () => {
    const answer = report({
      responseType: "answer",
      reportMarkdown: "",
      executiveSummary: "",
      claims: [],
      receipts: [],
      message: "请先选择一个市场。",
    });
    const html = renderToStaticMarkup(<MarketResearchReportView response={answer} />);
    expect(html).toContain("请先选择一个市场");
    expect(html).not.toContain("市场调研报告");
  });
});
