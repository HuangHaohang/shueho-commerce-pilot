import { describe, expect, it } from "vitest";
import { reportQualityCases, limitedEvidenceReport } from "./fixtures/report-quality-cases";
import { assessReportOutputQuality } from "./report-output-quality";
import { isMarketResearchEnvelope, marketResearchEnvelopeNotice, MAX_MARKET_REPORT_ENVELOPE_LENGTH, parseMarketResearchResponse } from "./market-report";

describe("offline report quality evaluation", () => {
  for (const fixture of reportQualityCases) {
    it(fixture.name, () => {
      const report = fixture.build();
      const original = JSON.stringify(report);
      const result = assessReportOutputQuality(report);
      expect(result.issues.map((issue) => issue.code).sort()).toEqual([...fixture.expectedCodes].sort());
      expect(result.status).toBe(fixture.expectedCodes.length ? "needs_review" : "consistent");
      expect(JSON.stringify(report)).toBe(original);
      expect(parseMarketResearchResponse(original)).not.toBeNull();
    });
  }

  it("excludes unavailable margins instead of lowering the supported dimensions' score", () => {
    expect(assessReportOutputQuality(limitedEvidenceReport()).computedWeightedScore).toBe(60);
  });

  it("retains pre-scorecard historical reports without manufacturing a score", () => {
    const report = limitedEvidenceReport();
    report.scorecard = null;
    report.decisionGate = null;
    expect(assessReportOutputQuality(report)).toEqual({ status: "consistent", issues: [], computedWeightedScore: null });
  });

  it("detects interrupted JSON and completed invalid envelopes without treating ordinary prose as JSON", () => {
    const truncated = JSON.stringify(limitedEvidenceReport()).slice(0, -50);
    expect(parseMarketResearchResponse(truncated)).toBeNull();
    expect(isMarketResearchEnvelope(truncated)).toBe(true);
    expect(isMarketResearchEnvelope(`\`\`\`json\n${truncated}`)).toBe(true);
    expect(isMarketResearchEnvelope('报告示例：{"responseType":"report"}')).toBe(false);
    expect(isMarketResearchEnvelope('{"responseType":"draft","body":"内容"}')).toBe(false);
    expect(marketResearchEnvelopeNotice("streaming")).toContain("正在整理");
    expect(marketResearchEnvelopeNotice("completed")).toContain("格式不完整");
    expect(marketResearchEnvelopeNotice("interrupted")).toContain("格式不完整");
  });

  it("rejects field and envelope overflows before rendering, while keeping the report classification", () => {
    const report = limitedEvidenceReport();
    report.reportMarkdown = "长".repeat(80_001);
    expect(parseMarketResearchResponse(JSON.stringify(report))).toBeNull();
    expect(isMarketResearchEnvelope(JSON.stringify(report))).toBe(true);
    const oversized = '{"responseType":"report","reportMarkdown":"' + "x".repeat(MAX_MARKET_REPORT_ENVELOPE_LENGTH) + '"}';
    expect(parseMarketResearchResponse(oversized)).toBeNull();
    expect(isMarketResearchEnvelope(oversized)).toBe(true);
  });
});
