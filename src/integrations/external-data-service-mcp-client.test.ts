import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { after, before, test } from "node:test";
import { z } from "zod";

import { ExternalDataServiceMcpClient, ExternalDataServiceMcpError } from "./external-data-service-mcp-client.js";

let origin = "";
let upstreamServer: ReturnType<typeof createServer>;
let paidDispatches = 0;

before(async () => {
  upstreamServer = createServer(async (request, response) => {
    if (request.headers.authorization !== "Bearer test-service-token") {
      response.statusCode = 401;
      response.end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const body = await readJson(request);
    const server = createMockServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(request, response, body);
  });
  await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
  const address = upstreamServer.address();
  if (!address || typeof address === "string") throw new Error("Mock MCP listener did not return an address.");
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => upstreamServer.close((error) => error ? reject(error) : resolve()));
});

test("verifies the hosted tool contract and calls catalog tools", async () => {
  const client = createClient(128_000);
  try {
    const status = await client.verify();
    assert.equal(status.connected, true);
    assert.deepEqual(status.tools, [
      "begin_marketplace_product_research",
      "call_endpoint",
      "cancel_marketplace_product_research",
      "complete_marketplace_product_research",
      "get_endpoint_schema",
      "get_marketplace_options",
      "get_research_result",
      "list_marketplace_research_platforms",
      "list_platforms",
      "preflight_endpoint",
      "preflight_marketplace_product_research",
      "preflight_social_content_research",
      "resolve_marketplace_product_bindings",
      "search_business_data",
      "search_endpoints",
    ]);
    const search = await client.searchEndpoints({ query: "通勤包", platform: "taobao", limit: 8 });
    assert.equal(search.payload.success, true);
    assert.equal(Array.isArray(search.payload.results), true);
    const business = await client.searchBusinessData({ query: "通勤包", _commerce_context: {} });
    assert.equal(business.payload.success, true);
    const platforms = await client.listMarketplaceResearchPlatforms();
    assert.deepEqual(platforms.payload.platforms, [{ platform: "taobao", label: "淘宝和天猫" }]);
    const social = await client.preflightSocialContentResearch({
      platform: "DOUYIN",
      keyword: "通勤包",
      start_date: "2026-08-21",
      end_date: "2026-08-27",
      objective: "latest_content",
      requested_metrics: [],
      max_results: 50,
    });
    assert.equal(social.payload.business_tool, "research_social_content");
    const marketplace = await client.preflightMarketplaceProductResearch({
      platform: "TAOBAO",
      keyword: "蘑菇勺",
      tmall_only: false,
      min_price_yuan: null,
      max_price_yuan: null,
      requested_metrics: ["price_band", "sales_level"],
      max_results: 50,
    });
    assert.equal(marketplace.payload.business_tool, "research_marketplace_products");
    const research = await client.getResearchResult({ research_request_id: "00000000-0000-4000-8000-000000000001" });
    assert.equal(research.payload.success, true);
  } finally {
    await client.close();
  }
});

test("dispatches a paid endpoint exactly once and marks an oversized result uncertain", async () => {
  paidDispatches = 0;
  const client = createClient(256);
  try {
    await client.verify();
    await assert.rejects(
      () => client.callEndpoint({ endpoint_id: "taobao.large_v1", params: { keyword: "通勤包" } }),
      (error: unknown) => {
        assert.equal(error instanceof ExternalDataServiceMcpError, true);
        assert.equal((error as ExternalDataServiceMcpError).code, "RESULT_TOO_LARGE");
        assert.equal((error as ExternalDataServiceMcpError).uncertain, true);
        return true;
      },
    );
    assert.equal(paidDispatches, 1);
  } finally {
    await client.close();
  }
});

test("stays disabled without a service-owned internal token", async () => {
  const client = new ExternalDataServiceMcpClient({
    url: `${origin}/mcp`,
    timeoutMs: 5_000,
    maxResultBytes: 128_000,
  });
  assert.equal(client.readStatus().configured, false);
  await assert.rejects(
    () => client.searchEndpoints({ query: "test" }),
    (error: unknown) => error instanceof ExternalDataServiceMcpError && error.code === "NOT_CONFIGURED",
  );
});

function createClient(maxResultBytes: number): ExternalDataServiceMcpClient {
  return new ExternalDataServiceMcpClient({
    url: `${origin}/mcp`,
    token: "test-service-token",
    timeoutMs: 5_000,
    maxResultBytes,
  });
}

function createMockServer(): McpServer {
  const server = new McpServer({ name: "mock-shueho-external-data", version: "2.0.0" });
  server.registerTool(
    "begin_marketplace_product_research",
    { inputSchema: { workflow_id: z.string(), research_plan_key: z.string() } },
    async () => result({ success: true, workflow_execution_id: "00000000-0000-4000-8000-000000000010" }),
  );
  server.registerTool(
    "resolve_marketplace_product_bindings",
    { inputSchema: { workflow_execution_id: z.string() } },
    async () => result({ success: true, bindings: { item_id: "1" } }),
  );
  server.registerTool(
    "complete_marketplace_product_research",
    { inputSchema: { workflow_execution_id: z.string() } },
    async ({ workflow_execution_id }) => result({ success: true, research_request_id: workflow_execution_id }),
  );
  server.registerTool(
    "cancel_marketplace_product_research",
    { inputSchema: { workflow_execution_id: z.string(), reason: z.string() } },
    async ({ workflow_execution_id }) => result({ success: true, workflow_execution_id }),
  );
  server.registerTool(
    "list_marketplace_research_platforms",
    { inputSchema: {} },
    async () => result({ success: true, platforms: [{ platform: "taobao", label: "淘宝和天猫" }] }),
  );
  server.registerTool(
    "get_marketplace_options",
    { inputSchema: { platform: z.string() } },
    async ({ platform }) => result({ success: true, platform, requiresSelection: false, options: [] }),
  );
  server.registerTool(
    "search_endpoints",
    { inputSchema: { query: z.string(), platform: z.string().optional(), limit: z.number().optional() } },
    async ({ query, platform }) => result({
      success: true,
      query,
      results: [{ endpoint_id: "taobao.search_v1", platform: platform || "taobao" }],
    }),
  );
  server.registerTool(
    "get_endpoint_schema",
    { inputSchema: { endpoint_id: z.string() } },
    async ({ endpoint_id }) => result({ success: true, endpoint_id, params: [] }),
  );
  server.registerTool(
    "list_platforms",
    { inputSchema: {} },
    async () => result({ success: true, platforms: [{ id: "taobao" }] }),
  );
  server.registerTool(
    "preflight_marketplace_product_research",
    {
      inputSchema: {
        platform: z.string(), keyword: z.string(), tmall_only: z.boolean(),
        min_price_yuan: z.number().nullable(), max_price_yuan: z.number().nullable(),
        requested_metrics: z.array(z.string()), max_results: z.number(),
      },
    },
    async ({ platform, keyword, tmall_only, min_price_yuan, max_price_yuan, requested_metrics, max_results }) => result({
      success: true,
      business_tool: "research_marketplace_products",
      research_plan_key: "b".repeat(64),
      endpoint_id: "taobao.search_item_list_v1",
      platform: "taobao",
      normalized_params: { keyword, tmall: tmall_only, startPrice: min_price_yuan, endPrice: max_price_yuan },
      business_intent: {
        kind: "marketplace_product_research",
        platform,
        target_product: keyword,
        objective: "product_market_landscape",
        requested_metrics,
        time_range: null,
        window_enforcement: null,
        requested_top_n: max_results,
      },
      coverage: {},
    }),
  );
  server.registerTool(
    "preflight_social_content_research",
    {
      inputSchema: {
        platform: z.string(), keyword: z.string(), start_date: z.string(), end_date: z.string(),
        objective: z.string(), requested_metrics: z.array(z.string()), max_results: z.number(),
      },
    },
    async ({ platform, keyword, start_date, end_date, objective, requested_metrics, max_results }) => result({
      success: true,
      business_tool: "research_social_content",
      research_plan_key: "a".repeat(64),
      endpoint_id: "search.search_v1",
      platform: "search",
      normalized_params: { keyword, source: platform, start: start_date, end: end_date },
      business_intent: {
        kind: "social_content_research",
        platform,
        target_product: keyword,
        objective,
        requested_metrics,
        time_range: null,
        window_enforcement: "provider_exact",
        requested_top_n: max_results,
      },
      coverage: {},
    }),
  );
  server.registerTool(
    "preflight_endpoint",
    { inputSchema: { endpoint_id: z.string(), params: z.record(z.unknown()).default({}) } },
    async ({ endpoint_id, params }) => result({ success: true, endpoint_id, normalized_params: params }),
  );
  server.registerTool(
    "call_endpoint",
    { inputSchema: { endpoint_id: z.string(), params: z.record(z.unknown()).default({}) } },
    async ({ endpoint_id }) => {
      paidDispatches += 1;
      return result({ success: true, code: 0, endpoint_id, data: { content: "x".repeat(2_000) } });
    },
  );
  server.registerTool(
    "get_research_result",
    { inputSchema: { research_request_id: z.string() } },
    async ({ research_request_id }) => result({ success: true, research_request_id }),
  );
  server.registerTool(
    "search_business_data",
    { inputSchema: { query: z.string() } },
    async ({ query }) => result({ success: true, query, results: [] }),
  );
  return server;
}

function result(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) raw += chunk.toString("utf8");
  return JSON.parse(raw);
}
