import type { MarketResearchResponse } from "../market-report";
import type { ReportQualityIssue } from "../report-output-quality";

/** Offline release fixtures: synthetic business facts, no provider call or customer data. */
export function limitedEvidenceReport(): MarketResearchResponse {
  return {
    responseType: "report",
    insightType: "new_product_development",
    subject: { mode: "none", title: "便携收纳盒机会验证", subjectRef: "", snapshotSha256: "", productCount: 0, factLimitations: ["成本与利润数据未接入"] },
    scope: { decisionObjective: "判断是否值得做小样验证", platforms: ["示例市场"], markets: ["示例站点"], period: "2026-09", requestedEvidence: ["商品规格"] },
    executiveSummary: "有限规格样本支持开展验证，不能据此预测销量。",
    reportMarkdown: "## 有限样本观察\n\n部分样本具备可叠放设计。缺少买家评论，不形成买家痛点结论。",
    claims: [{ claimId: "claim-1", type: "market_signal", text: "样本中存在可叠放规格。", evidenceIds: ["research-1:evidence-1"], productFactRefs: [], companyEvidenceRefs: [], confidence: "low", limitations: ["仅为有限样本"] }],
    receipts: [{ researchRequestId: "research-1", platform: "示例市场", observedAt: "2026-09-01T00:00:00Z", evidenceCount: 3, reviewEvidenceCount: 0, evidenceKinds: ["product"], coverageSummary: "3 条商品规格观察", limitations: ["无买家评论"] }],
    recommendations: [],
    scorecard: { weightedScore: 60, confidence: "low", dimensions: [
      { dimensionId: "specification", label: "规格差异", score: 60, weight: 0.4, evidenceState: "mixed", rationale: "有差异信号，但样本很小。", evidenceIds: ["research-1:evidence-1"], productFactRefs: [], companyEvidenceRefs: [], limitations: ["需要扩大样本"] },
      { dimensionId: "margin", label: "利润空间", score: 0, weight: 0.6, evidenceState: "unavailable", rationale: "尚未接入成本。", evidenceIds: [], productFactRefs: [], companyEvidenceRefs: [], limitations: ["缺少受控成本数据"] },
    ] },
    decisionGate: { status: "validate", summary: "建议验证，不代表已执行。", blockingGaps: ["缺少成本与买家评论"], requiredEvidence: ["小样反馈"] },
    experiments: [],
    message: "已形成有限证据下的验证建议。",
  };
}

type QualityCase = {
  name: string;
  build: () => MarketResearchResponse;
  expectedCodes: ReportQualityIssue["code"][];
};

function mutate(change: (report: MarketResearchResponse) => void): () => MarketResearchResponse {
  return () => { const report = limitedEvidenceReport(); change(report); return report; };
}

export const reportQualityCases: QualityCase[] = [
  { name: "有限、低置信证据保留为可用验证建议", build: limitedEvidenceReport, expectedCodes: [] },
  { name: "没有引用的高置信评分与推进结论", build: mutate((report) => {
    report.scorecard!.confidence = "high";
    report.scorecard!.dimensions[0]!.evidenceIds = [];
    report.decisionGate!.status = "proceed";
  }), expectedCodes: ["missing_basis", "unsupported_confidence", "unsupported_decision"] },
  { name: "错误加权总分不冒充正确结果", build: mutate((report) => {
    report.scorecard!.weightedScore = 92;
  }), expectedCodes: ["score_mismatch"] },
  { name: "空评分不能高置信推进", build: mutate((report) => {
    report.scorecard = { weightedScore: 0, confidence: "high", dimensions: [] };
    report.decisionGate!.status = "proceed";
  }), expectedCodes: ["unsupported_confidence", "unsupported_decision"] },
  { name: "全部未接入的证据诚实返回不足", build: mutate((report) => {
    report.scorecard!.dimensions = [report.scorecard!.dimensions[1]!];
    report.scorecard!.weightedScore = 0;
    report.decisionGate!.status = "insufficient_evidence";
  }), expectedCodes: [] },
  { name: "未接入利润数据不能被模型打分", build: mutate((report) => {
    report.scorecard!.dimensions[1]!.score = 90;
  }), expectedCodes: ["unavailable_score"] },
  { name: "单一引用重复两次不成为可比样本", build: mutate((report) => {
    report.claims[0]!.type = "derived_comparison";
    report.claims[0]!.evidenceIds = ["evidence-1", "evidence-1"];
  }), expectedCodes: ["missing_basis"] },
  { name: "无证据的假设不能高置信", build: mutate((report) => {
    report.claims[0]!.type = "hypothesis";
    report.claims[0]!.evidenceIds = [];
    report.claims[0]!.confidence = "high";
  }), expectedCodes: ["unsupported_confidence"] },
  { name: "重复结论标识待复核", build: mutate((report) => {
    report.claims.push({ ...report.claims[0]! });
  }), expectedCodes: ["duplicate_id"] },
  { name: "允许整数四舍五入", build: mutate((report) => {
    report.scorecard!.dimensions[0]!.score = 59.6;
  }), expectedCodes: [] },
  { name: "允许两位小数精度，不错误拒绝有效加权结果", build: mutate((report) => {
    report.scorecard!.weightedScore = 61.33;
    report.scorecard!.dimensions[0]!.score = 61.333333333;
  }), expectedCodes: [] },
  { name: "半分容差不能跨越显示取整边界", build: mutate((report) => {
    report.scorecard!.weightedScore = 60.7;
    report.scorecard!.dimensions[0]!.score = 60.2;
  }), expectedCodes: ["score_mismatch"] },
  { name: "纯假设保留为低置信待验证提案", build: mutate((report) => {
    report.scorecard!.dimensions[0]!.evidenceState = "hypothesis";
    report.scorecard!.dimensions[0]!.evidenceIds = [];
  }), expectedCodes: [] },
];
