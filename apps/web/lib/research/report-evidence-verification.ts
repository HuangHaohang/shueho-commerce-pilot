import type { AgentActivity } from "@/lib/agent/use-agent-thread";
import type { ResearchEvidenceReceipt } from "@/lib/agent/tool-activity";
import type { MarketResearchReceipt } from "./market-report";

export type ReportReceiptVerification = "verified" | "mismatch" | "unverified";

export type ReconciledMarketResearchReceipt = MarketResearchReceipt & {
  verification: ReportReceiptVerification;
  missingMetrics: string[];
};

export type ReportEvidenceVerificationSummary = {
  receipts: ReconciledMarketResearchReceipt[];
  verifiedCount: number;
  mismatchCount: number;
  unverifiedCount: number;
  allVerified: boolean;
};

export function reconcileReportEvidence(
  reportReceipts: readonly MarketResearchReceipt[],
  activities: readonly AgentActivity[],
): ReportEvidenceVerificationSummary {
  const authoritative = new Map<string, ResearchEvidenceReceipt>();
  for (const activity of activities) {
    if (activity.research?.kind !== "evidence") continue;
    authoritative.set(activity.research.researchRequestId, activity.research);
  }

  const receipts = reportReceipts.map((reported): ReconciledMarketResearchReceipt => {
    const actual = authoritative.get(reported.researchRequestId);
    if (!actual) {
      return { ...reported, verification: "unverified", missingMetrics: [] };
    }
    const verification =
      reported.evidenceCount === actual.evidenceCount &&
      reported.reviewEvidenceCount === actual.reviewEvidenceCount
        ? "verified"
        : "mismatch";
    return {
      ...reported,
      platform: actual.platform || reported.platform,
      observedAt: actual.observedAt,
      evidenceCount: actual.evidenceCount,
      reviewEvidenceCount: actual.reviewEvidenceCount,
      evidenceKinds: [
        actual.coverage.acceptedProducts && actual.coverage.acceptedProducts > 0 ? "product" : null,
        actual.reviewEvidenceCount > 0 ? "review" : null,
      ].filter((value): value is string => Boolean(value)),
      coverageSummary: [
        actual.coverage.acceptedProducts === null
          ? null
          : `${actual.coverage.acceptedProducts} 个商品`,
        actual.coverage.acceptedEvidence === null
          ? null
          : `${actual.coverage.acceptedEvidence} 条质量证据`,
      ].filter(Boolean).join("；"),
      limitations: actual.limitations,
      verification,
      missingMetrics: actual.coverage.missingRequestedMetrics,
    };
  });
  const verifiedCount = receipts.filter((receipt) => receipt.verification === "verified").length;
  const mismatchCount = receipts.filter((receipt) => receipt.verification === "mismatch").length;
  const unverifiedCount = receipts.filter((receipt) => receipt.verification === "unverified").length;
  return {
    receipts,
    verifiedCount,
    mismatchCount,
    unverifiedCount,
    allVerified: receipts.length > 0 && verifiedCount === receipts.length,
  };
}
