import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), load: vi.fn() }));
vi.mock("./database.js", () => ({ withScope: (_scope: unknown, fn: (client: unknown) => unknown) => fn({ query: mocks.query }) }));
vi.mock("./warehouse.js", () => ({ loadCompactResearchResult: mocks.load }));
import { loadWorkflowOrResearchResult } from "./marketplace-workflow-execution.js";

const scope = { tenantId: "tenant", workspaceId: "workspace" };
beforeEach(() => vi.clearAllMocks());
describe("read-only workflow status", () => {
  it.each(["running", "unknown"])("queries a plan id without finalizing a %s workflow and retains recovered search evidence", async (status) => {
    const execution = { id: "execution", status, workflow_id: "taobao.products", workflow_version: "1", plan_key: "plan-key",
      business_intent: { requested_metrics: ["sales_level"] }, plan_coverage: {}, created_at: new Date("2026-09-08T03:19:00Z") };
    const steps = [
      { id: "step-1", step_id: "discover", role: "discovery", state: "completed", is_template: false, research_request_id: "research-1", target_ordinal: null },
      { id: "step-2", step_id: "detail", role: "detail", state: status === "running" ? "running" : "unknown", is_template: false, research_request_id: null, target_ordinal: 0 },
    ];
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
      if (sql.includes("execution.compact_result")) {
        expect(sql).toContain("plan.id=$1");
        expect(params).toEqual(["plan-id", scope.tenantId, scope.workspaceId]);
        return { rows: [{ id: "execution", compact_result: null }] };
      }
      if (sql.includes("FROM research_workflow_execution")) return { rows: [execution] };
      if (sql.includes("FROM research_workflow_step_execution")) return { rows: steps };
      if (sql.includes("FROM research_workflow_business_evidence")) return { rows: [] };
      throw new Error("Unexpected query");
    });
    mocks.load.mockResolvedValue({ success: true, provider_completed: true, research_request_id: "research-1", raw_archive_id: "raw-1",
      observed_at: "2026-09-08T03:20:00Z", coverage: {}, metrics: {}, products: [{ item_id: "123", title: "砂锅" }],
      brands: [], properties: [], evidence: [], exclusions: {}, limitations: [] });
    const result = await loadWorkflowOrResearchResult(scope, "plan-id");
    expect(result.processing_state).toBe(status);
    expect(result.products).toEqual([expect.objectContaining({ item_id: "123", workflow_role: "discovery" })]);
    expect(result.coverage.provider_calls_completed).toBe(1);
    expect(result.coverage.retry_after_seconds).toBe(status === "running" ? 15 : null);
    expect(result.research_request_id).toBe("execution");
  });
});
