import { describe, expect, it } from "vitest";

import type { AgentActivity } from "@/lib/agent/use-agent-thread";
import type { ResearchEvidenceReceipt } from "@/lib/agent/tool-activity";
import type { MarketResearchReceipt } from "./market-report";
import { reconcileReportEvidence } from "./report-evidence-verification";

const reported: MarketResearchReceipt = {
  researchRequestId: "research-1",
  platform: "报告平台",
  observedAt: "2026-08-01T00:00:00Z",
  evidenceCount: 99,
  reviewEvidenceCount: 88,
  evidenceKinds: ["reported"],
  coverageSummary: "模型自报覆盖",
  limitations: ["模型自报限制"],
};

function activity(overrides: Partial<ResearchEvidenceReceipt> = {}): AgentActivity {
  const research: ResearchEvidenceReceipt = {
    kind: "evidence",
    researchRequestId: "research-1",
    platform: "权威平台",
    observedAt: "2026-09-01T00:00:00Z",
    evidenceCount: 12,
    reviewEvidenceCount: 3,
    coverage: {
      acceptedProducts: 4,
      acceptedEvidence: 12,
      reviewStepsCompleted: 3,
      reviewStepAvailable: true,
      requestedMetrics: ["price"],
      missingRequestedMetrics: ["sales"],
    },
    limitations: ["权威限制"],
    ...overrides,
  };
  return {
    id: "activity-1",
    turnId: "turn-1",
    sequence: 1,
    kind: "tool",
    label: "市场证据",
    status: "completed",
    durationMs: 10,
    sources: [],
    research,
  };
}

describe("reconcileReportEvidence", () => {
  it("keeps a model-authored receipt visibly unverified without a same-turn tool receipt", () => {
    const result = reconcileReportEvidence([reported], []);
    expect(result.unverifiedCount).toBe(1);
    expect(result.receipts[0]?.verification).toBe("unverified");
    expect(result.allVerified).toBe(false);
  });

  it("uses the authoritative Harness receipt and flags a model count mismatch", () => {
    const result = reconcileReportEvidence([reported], [activity()]);
    expect(result.mismatchCount).toBe(1);
    expect(result.receipts[0]).toMatchObject({
      platform: "权威平台",
      evidenceCount: 12,
      reviewEvidenceCount: 3,
      coverageSummary: "4 个商品；12 条质量证据",
      limitations: ["权威限制"],
      missingMetrics: ["sales"],
      verification: "mismatch",
    });
  });

  it("marks exact same-turn receipt counts as verified", () => {
    const exact = { ...reported, evidenceCount: 12, reviewEvidenceCount: 3 };
    const result = reconcileReportEvidence([exact], [activity()]);
    expect(result.verifiedCount).toBe(1);
    expect(result.allVerified).toBe(true);
  });
});
