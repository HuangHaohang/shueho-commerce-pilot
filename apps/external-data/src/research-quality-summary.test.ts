import { describe, it, expect } from "vitest";
import { researchQualitySummary, sourcePagination } from "./research-quality-summary.js";
describe("research layer diagnostics", () => {
  it("reports intact held fields independently of empty delivered evidence", () => {
    const summary = researchQualitySummary({ acceptedCount: 0, requestedCount: 50, records: [
      { metrics: { views: 0, likes: 10, comments: 2, shares: 1 }, published_at: "2026-09-01", decision: "hold", reason_codes: ["SCOPE_UNCONFIRMED"] },
      { metrics: { views: 100, likes: 20, comments: 4, shares: 2 }, published_at: "2026-07-01", decision: "reject", reason_codes: ["OUTSIDE_REQUESTED_WINDOW"] },
    ] });
    expect(summary).toMatchObject({ sourceRecords: 2, sourceRecordsWithPublishTime: 2, sampleStatus: "no_qualified_samples",
      exclusionReasons: { SCOPE_UNCONFIRMED: 1, OUTSIDE_REQUESTED_WINDOW: 1 } });
    expect(summary.sourceMetricCoverageByField.views).toMatchObject({ status: "complete", presentSamples: 2 });
    expect(summary.exclusionReasons).not.toHaveProperty("PUBLISHED_AT_MISSING");
  });
  it("does not use content-level or contradictory pagination flags to dispatch more work", () => {
    expect(sourcePagination({ data: { pagination: { has_more: true, total_count: 287, page: 1, limit: 10 } } }))
      .toMatchObject({ hasMore: true, providerReportedTotal: 287, totalBasis: "provider_reported_unfiltered" });
    expect(sourcePagination({ data: { has_more: false, pagination: { has_more: true } } }).hasMore).toBeNull();
    expect(sourcePagination({ data: { content_list: [{ has_more: true }] } }).hasMore).toBeNull();
    expect(sourcePagination({ data: { has_more: "true" } }).hasMore).toBeNull();
  });
});
