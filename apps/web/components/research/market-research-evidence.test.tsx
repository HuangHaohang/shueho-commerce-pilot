import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AgentActivity } from "@/lib/agent/use-agent-thread";

import { ResearchEvidencePanel, ResearchToolReceiptView } from "./market-research-evidence";

const plan = {
  kind: "plan" as const,
  productCount: 1,
  snapshotSha256: "a".repeat(64),
  estimatedProviderCalls: 7,
  quote: {
    currency: "CNY",
    providerCallCount: 7,
    priced: true,
    billableAmountMicros: 350000,
  },
  coverage: {
    platform: "TAOBAO",
    market: "CN",
    plannedProducts: 3,
    reviewStepsPlanned: 3,
    requestedMetrics: ["price", "reviews"],
  },
  expiresAt: "2026-08-31T01:00:00.000Z",
};

const evidence = {
  kind: "evidence" as const,
  researchRequestId: "research-request-1",
  platform: "TAOBAO",
  observedAt: "2026-08-31T00:00:00.000Z",
  evidenceCount: 24,
  reviewEvidenceCount: 18,
  coverage: {
    acceptedProducts: 3,
    acceptedEvidence: 24,
    reviewStepsCompleted: 3,
    reviewStepAvailable: true,
    requestedMetrics: ["price", "reviews"],
    missingRequestedMetrics: ["sales"],
  },
  limitations: ["样本只覆盖本次实际完成的调用。"],
};

describe("market research evidence projections", () => {
  it("shows the plan scope, sample, quote, snapshot and expiry", () => {
    const html = renderToStaticMarkup(<ResearchToolReceiptView receipt={plan} />);
    expect(html).toContain("TAOBAO");
    expect(html).toContain("CN");
    expect(html).toContain("代表商品");
    expect(html).toContain("CNY 0.3500");
    expect(html).toContain("产品快照");
    expect(html).toContain("计划有效期");
  });

  it("shows only the safe evidence receipt, counts, missing metrics and limitations", () => {
    const activity: AgentActivity = {
      id: "activity-1",
      sequence: 1,
      kind: "tool",
      label: "工具调用完成",
      status: "completed",
      research: evidence,
    };
    const html = renderToStaticMarkup(
      <ResearchEvidencePanel activities={[activity]} reportReceipts={[]} webSources={[]} />,
    );
    expect(html).toContain("research-request-1");
    expect(html).toContain("24 条证据");
    expect(html).toContain("评论 18 条");
    expect(html).toContain("缺失指标：sales");
    expect(html).toContain("样本只覆盖本次实际完成的调用");
    expect(html).not.toMatch(/endpoint|raw_archive|author/);
  });

  it("lets the authoritative Harness tool receipt override a conflicting report projection", () => {
    const activity: AgentActivity = {
      id: "activity-authoritative",
      sequence: 2,
      kind: "tool",
      label: "工具调用完成",
      status: "completed",
      research: evidence,
    };
    const html = renderToStaticMarkup(
      <ResearchEvidencePanel
        activities={[activity]}
        reportReceipts={[{
          researchRequestId: "research-request-1",
          platform: "伪造平台",
          observedAt: "2020-01-01T00:00:00.000Z",
          evidenceCount: 999,
          reviewEvidenceCount: 999,
          evidenceKinds: ["unverified"],
          coverageSummary: "模型声明的冲突回执",
          limitations: [],
        }]}
        webSources={[]}
      />,
    );
    expect(html).toContain("TAOBAO");
    expect(html).toContain("24 条证据");
    expect(html).not.toContain("伪造平台");
    expect(html).not.toContain("999 条证据");
    expect(html).not.toContain("模型声明的冲突回执");
    expect(html).not.toContain("尚未与本任务的 Harness 工具回执核对");
  });

  it("labels a report-only receipt as unverified instead of presenting it as tool readback", () => {
    const html = renderToStaticMarkup(
      <ResearchEvidencePanel
        activities={[]}
        reportReceipts={[{
          researchRequestId: "report-only-receipt",
          platform: "淘宝",
          observedAt: "2026-08-31T00:00:00.000Z",
          evidenceCount: 3,
          reviewEvidenceCount: 0,
          evidenceKinds: ["product"],
          coverageSummary: "报告声明的三条证据",
          limitations: [],
        }]}
        webSources={[]}
      />,
    );
    expect(html).toContain("报告引用 · 尚未与本任务的 Harness 工具回执核对");
    expect(html).toContain("report-only-receipt");
  });
});
