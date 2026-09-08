import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), unknown: vi.fn() }));
vi.mock("./marketplace-workflow-execution.js", async (original) => ({
  ...await original<typeof import("./marketplace-workflow-execution.js")>(),
  startMarketplaceWorkflowStep: mocks.start,
  markMarketplaceWorkflowStepUnknown: mocks.unknown,
}));
import { JustOneApiError } from "./justoneapi-errors.js";
import { createExternalDataMcpServer } from "./mcp-server.js";
import type { ExternalDataPipeline } from "./pipeline.js";

it("keeps uncertain errors structured and returns the warehouse recovery identity", async () => {
  mocks.start.mockResolvedValue(undefined);
  mocks.unknown.mockResolvedValue(undefined);
  const error = new JustOneApiError("Provider deadline exceeded.", "RESULT_UNKNOWN", true);
  error.researchRequestId = "00000000-0000-4000-8000-000000000042";
  const execute = vi.fn().mockRejectedValue(error);
  const server = createExternalDataMcpServer({ execute } as unknown as ExternalDataPipeline);
  const client = new Client({ name: "uncertain-receipt-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "call_endpoint", arguments: { endpoint_id: "taobao.detail", params: {}, _commerce_context: {
      tenant_id: "00000000-0000-4000-8000-000000000001", workspace_id: "00000000-0000-4000-8000-000000000002", user_id: "fixture",
      source: "external_mcp", source_call_id: "fixture-call-1", request_text: "砂锅", workflow_execution_id: "00000000-0000-4000-8000-000000000010", workflow_step_id: "detail",
    } } });
    expect(result).toMatchObject({ structuredContent: { processing_state: "unknown", code: "UPSTREAM_RESULT_UNKNOWN", research_request_id: error.researchRequestId } });
    expect(mocks.unknown).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ researchRequestId: error.researchRequestId }));
    expect(execute).toHaveBeenCalledOnce();
  } finally { await client.close(); await server.close(); }
});
