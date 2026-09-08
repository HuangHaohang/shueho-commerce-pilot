import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import type { ExternalDataScope } from "./types.js";
import { sha256Json } from "./canonical.js";
import { linkWorkflowResearch } from "./workflow-research-link.js";

const scope: ExternalDataScope = { tenantId: "tenant", workspaceId: "workspace", userId: "user", source: "external_mcp",
  sourceCallId: "call", requestText: "fixture", workflowExecutionId: "workflow", workflowStepId: "detail", workflowStepInstanceId: "instance" };
it("links an in-progress call only to its exact owned running step and parameter hash", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ id: "instance" }] });
  await linkWorkflowResearch({ query } as unknown as Pick<PoolClient, "query">, scope, "research", "fixture.detail", { item_id: "1" });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("research_request_id IS NULL OR research_request_id=$1"),
    ["research", "workflow", "fixture.detail", "tenant", "workspace", sha256Json({ item_id: "1" }), "instance", "detail"]);
});
it("fails before provider dispatch when a step is already bound or mismatched", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 0, rows: [] });
  await expect(linkWorkflowResearch({ query } as unknown as Pick<PoolClient, "query">, scope, "research", "fixture.detail", {})).rejects.toThrow("already bound");
});
it("does not invent workflow membership for standalone calls", async () => {
  const query = vi.fn();
  await linkWorkflowResearch({ query } as unknown as Pick<PoolClient, "query">, { ...scope, workflowExecutionId: null }, "research", "fixture.detail", {});
  expect(query).not.toHaveBeenCalled();
});
