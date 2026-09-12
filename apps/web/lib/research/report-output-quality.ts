import type { MarketResearchResponse } from "./market-report";

export type ReportQualityIssue = {
  code: "duplicate_id" | "missing_basis" | "unavailable_score" | "score_mismatch" | "unsupported_confidence" | "unsupported_decision";
  message: string;
};

/** Checks consistency, not factual truth. Original Harness content stays intact. */
export function assessReportOutputQuality(response: MarketResearchResponse): {
  status: "consistent" | "needs_review";
  issues: ReportQualityIssue[];
  computedWeightedScore: number | null;
} {
  const issues: ReportQualityIssue[] = [];
  const add = (code: ReportQualityIssue["code"], message: string) => {
    if (!issues.some((issue) => issue.code === code)) issues.push({ code, message });
  };
  const hasBasis = (value: { evidenceIds: string[]; productFactRefs: string[] }) =>
    [...value.evidenceIds, ...value.productFactRefs].some((reference) => reference.trim().length > 0);
  const checkIds = (ids: string[]) => {
    if (new Set(ids.map((id) => id.trim())).size !== ids.length) {
      add("duplicate_id", "报告存在重复标识，结论与依据需要重新核对。");
    }
  };

  checkIds(response.claims.map((claim) => claim.claimId));
  checkIds(response.receipts.map((receipt) => receipt.researchRequestId));
  checkIds(response.recommendations.map((recommendation) => recommendation.recommendationId));
  checkIds(response.experiments.map((experiment) => experiment.experimentId));
  for (const claim of response.claims) {
    const evidenceCount = new Set(claim.evidenceIds.map((reference) => reference.trim()).filter(Boolean)).size;
    const factCount = new Set(claim.productFactRefs.map((reference) => reference.trim()).filter(Boolean)).size;
    if ((claim.type === "product_fact" && factCount === 0) ||
      (claim.type === "market_signal" && evidenceCount === 0) ||
      (claim.type === "derived_comparison" && (evidenceCount === 0 || evidenceCount + factCount < 2))) {
      add("missing_basis", "结论缺少有效的独立依据，空白或重复引用不能充当比较证据。");
    }
    if (claim.type === "hypothesis" && claim.confidence === "high" && !hasBasis(claim)) {
      add("unsupported_confidence", "缺少依据的假设被标为高置信，尚不能作为可靠结论。");
    }
  }

  const scorecard = response.scorecard;
  let computedWeightedScore: number | null = null;
  if (scorecard) {
    checkIds(scorecard.dimensions.map((dimension) => dimension.dimensionId));
    for (const dimension of scorecard.dimensions) {
      if (["supported", "mixed"].includes(dimension.evidenceState) && !hasBasis(dimension)) {
        add("missing_basis", "已支持或混合证据的评分维度缺少事实或市场证据引用。");
      }
      if (dimension.evidenceState === "unavailable" && dimension.score !== 0) {
        add("unavailable_score", "未接入证据的维度不能产生分数，也不能计入总分。");
      }
    }
    const included = scorecard.dimensions.filter((dimension) =>
      dimension.evidenceState !== "unavailable" && dimension.weight > 0,
    );
    const totalWeight = included.reduce((total, dimension) => total + dimension.weight, 0);
    computedWeightedScore = totalWeight > 0
      ? included.reduce((total, dimension) => total + dimension.score * dimension.weight, 0) / totalWeight
      : 0;
    // Accept two-decimal arithmetic precision or exact integer rounding. A
    // blanket half-point tolerance could incorrectly change the displayed score.
    const roundedToInteger = Number.isInteger(scorecard.weightedScore) &&
      scorecard.weightedScore === Math.round(computedWeightedScore);
    if (Math.abs(computedWeightedScore - scorecard.weightedScore) > 0.010001 && !roundedToInteger) {
      add("score_mismatch", "总分与所列维度的加权计算不一致，暂不展示总分。");
    }
    const supported = included.some((dimension) =>
      ["supported", "mixed"].includes(dimension.evidenceState) && hasBasis(dimension),
    );
    if ((!supported && scorecard.confidence === "high") || (totalWeight === 0 && scorecard.confidence !== "low")) {
      add("unsupported_confidence", "当前评分依据不足以支持所标注的整体置信度。");
    }
    if (totalWeight === 0 && response.decisionGate && response.decisionGate.status !== "insufficient_evidence") {
      add("unsupported_decision", "没有可计分维度时，应先补充证据再形成决策建议。");
    } else if (!supported && response.decisionGate?.status === "proceed") {
      add("unsupported_decision", "只有假设的评分不能支持直接推进，需先完成验证。");
    }
  }
  return { status: issues.length ? "needs_review" : "consistent", issues, computedWeightedScore };
}
