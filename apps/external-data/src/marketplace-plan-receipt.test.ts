import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ plan: vi.fn(), persist: vi.fn(), load: vi.fn(), begin: vi.fn() }));
vi.mock("./pipeline.js", () => ({ ExternalDataPipeline: class {} }));
vi.mock("./marketplace-research-planner.js", async (original) => ({
  ...await original<typeof import("./marketplace-research-planner.js")>(),
  planMarketplaceProductResearch: mocks.plan,
}));
vi.mock("./marketplace-research-plan-store.js", async (original) => ({
  ...await original<typeof import("./marketplace-research-plan-store.js")>(),
  persistMarketplaceResearchPlan: mocks.persist,
  loadExecutableMarketplaceResearchPlan: mocks.load,
}));
vi.mock("./marketplace-workflow-execution.js", async (original) => ({
  ...await original<typeof import("./marketplace-workflow-execution.js")>(),
  beginMarketplaceWorkflowExecution: mocks.begin,
}));

import { createExternalDataMcpServer } from "./mcp-server.js";

const planId = "00000000-0000-4000-8000-000000000010";
const context = {
  tenant_id: "00000000-0000-4000-8000-000000000001",
  workspace_id: "00000000-0000-4000-8000-000000000002",
  user_id: "receipt-test", source: "external_mcp", source_call_id: "receipt-test-call",
  request_text: "研究商品价格与销量", top_n: 10,
};

describe("marketplace plan MCP receipts", () => {
  it.each(["taobao", "jd", "shopee"])("retains the persisted market-context object across planning and execution for %s", async (platform) => {
    const marketContext = platform === "shopee" ? { market: "TW", preferredQueryLocale: "zh-Hant-TW" } : null;
    const persistedContext = marketContext ?? {};
    const expiresAt = "2030-01-01T00:00:00.000Z";
    const plan = {
      workflow: { workflowId: `${platform}.products_by_keyword_v1`, workflowVersion: "1.0.0" },
      planKey: "a".repeat(64), marketContext, detailSampleSize: 3, estimatedProviderCalls: 7,
      businessInput: { platform, keyword: "水杯", max_results: 10 },
      businessIntent: { kind: "marketplace_product_research", requested_top_n: 10 }, coverage: {},
      steps: [{ stepId: "discover", stepOrder: 0, role: "discovery", endpoint: { endpointId: `${platform}.search_item_list_v1`, platformId: platform },
        parameterTemplate: { keyword: "水杯" }, dynamicParameterBindings: {}, outputBindings: [], required: true }],
    };
    mocks.plan.mockResolvedValue(plan);
    mocks.persist.mockResolvedValue({ planId, planKey: plan.planKey, expiresAt, marketContext: persistedContext, detailSampleSize: 3, estimatedProviderCalls: 7 });
    mocks.load.mockResolvedValue({ plan, stored: { request_text: context.request_text, expires_at: new Date(expiresAt), market_context: persistedContext } });
    mocks.begin.mockResolvedValue({ workflow_execution_id: "00000000-0000-4000-8000-000000000020", status: "planned",
      step_instances: [{ stepInstanceId: "00000000-0000-4000-8000-000000000030", stepInstanceKey: "discover", targetId: null, targetOrdinal: null,
        stepId: "discover", stepOrder: 0, instanceOrder: 0, role: "discovery", endpointId: `${platform}.search_item_list_v1`, bindings: {} }] });
    const server = createExternalDataMcpServer();
    const client = new Client({ name: "plan-receipt-contract-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    async function call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: { ...args, _commerce_context: context } });
      expect(result.isError).not.toBe(true);
      const block = (result.content as Array<{ type: string; text: string }>).find((item) => item.type === "text");
      const payload = JSON.parse(block!.text) as Record<string, unknown>;
      expect(payload.success).toBe(true);
      return payload;
    }
    try {
      const planned = await call("plan_marketplace_product_research", {
        platform, keyword: "水杯", localized_keywords: [], market: platform === "shopee" ? "TW" : null,
        tmall_only: false, min_price_yuan: null, max_price_yuan: null,
        requested_metrics: ["price_band"], max_results: 10, detail_sample_size: 3,
      });
      const executed = await call("execute_marketplace_product_research_plan", { plan_id: planId });
      expect(executed.market_context).toEqual(persistedContext);
      expect(executed.market_context).not.toBeNull();
      for (const field of ["plan_id", "request_text", "expires_at", "market_context", "detail_sample_size", "estimated_provider_calls"]) {
        expect(executed[field], field).toEqual(planned[field]);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
