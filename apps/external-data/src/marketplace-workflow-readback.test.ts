import { expect, it, vi } from "vitest";

const { query, loadChild } = vi.hoisted(() => ({ query: vi.fn(), loadChild: vi.fn() }));
vi.mock("./database.js", () => ({
  withScope: (_scope: unknown, operation: (client: unknown) => unknown) => operation({ query }),
}));
vi.mock("./warehouse.js", () => ({ loadCompactResearchResult: loadChild }));

import { loadWorkflowOrResearchResult } from "./marketplace-workflow-execution.js";

it.each(["running", "unknown", "completed"])("reads current child assessments instead of cached products for a %s workflow", async (status) => {
  query.mockReset();
  const cached = { products: [{ item_id: "superseded-product", confidence: 0.99 }] };
  query.mockImplementation(async (sql: string) => {
    if (/LEFT JOIN marketplace_research_plan/.test(sql)) return { rows: [{ id: "workflow", compact_result: cached }] };
    if (/FROM research_workflow_execution/.test(sql)) return { rows: [{
      id: "workflow", workflow_id: "fixture", workflow_version: "1", plan_key: "plan", status,
      compact_result: cached, business_intent: { requested_metrics: ["price_band", "sales_level"] },
      plan_coverage: {}, created_at: new Date("2026-09-08T00:00:00Z"),
    }] };
    if (/FROM research_workflow_step_execution/.test(sql)) return { rows: [{
      id: "step", step_id: "discovery", role: "discovery", is_template: false, state: "completed",
      research_request_id: "research", target_ordinal: null,
    }] };
    if (/FROM research_workflow_business_evidence/.test(sql)) return { rows: [] };
    throw new Error("Unexpected SQL; reads must not finalize or dispatch a workflow.");
  });
  loadChild.mockResolvedValue({
    success: true, provider_completed: true, research_request_id: "research", raw_archive_id: "raw", observed_at: "2026-09-08T00:00:00Z",
    coverage: { availableMetrics: ["price_band"] }, metrics: { price_band: { sampleCount: 1 } },
    products: [{ item_id: "current-product", price_amount: 10, currency: "CNY", confidence: null,
      evidence_assessment: { version: "commerce-relevance-v4" } }],
    brands: [], properties: [], evidence: [], limitations: [], exclusions: {},
  });
  const result = await loadWorkflowOrResearchResult({ tenantId: "tenant", workspaceId: "workspace" }, "plan");
  expect(result.products.map((product) => product.item_id)).toEqual(["current-product"]);
  expect(result.processing_state).toBe(status);
  expect(result.coverage.analysisReadiness).toMatchObject({
    requestedMetricCoverage: "partial", missingRequestedMetrics: ["sales_level"], productsWithUsableSales: 0,
  });
  expect(query.mock.calls.every(([sql]) => !/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
});
