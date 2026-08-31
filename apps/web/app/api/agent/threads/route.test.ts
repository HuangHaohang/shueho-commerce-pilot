import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteAgentThreadRecord: vi.fn(),
  enforceEnterpriseRateLimit: vi.fn(),
  listAgentThreadsForUser: vi.fn(),
  registerAgentThreadOwner: vi.fn(),
  releaseAgentTurnLeaseForTurn: vi.fn(),
  requireAgentContext: vi.fn(),
  updateAgentThreadStatus: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  gatewayHeaders: () => ({}),
  gatewayUrl: (path: string) => `http://gateway.test${path}`,
  requireAgentContext: mocks.requireAgentContext,
}));

vi.mock("@/lib/agent/thread-ownership", () => ({
  deleteAgentThreadRecord: mocks.deleteAgentThreadRecord,
  listAgentThreadsForUser: mocks.listAgentThreadsForUser,
  registerAgentThreadOwner: mocks.registerAgentThreadOwner,
  updateAgentThreadStatus: mocks.updateAgentThreadStatus,
}));

vi.mock("@/lib/enterprise/quota", () => ({
  releaseAgentTurnLeaseForTurn: mocks.releaseAgentTurnLeaseForTurn,
}));

vi.mock("@/lib/enterprise/rate-limit", () => ({
  enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit,
}));

import { POST } from "./route";

const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};

describe("agent thread creation workflow contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.registerAgentThreadOwner.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the fixed creative-project workflow to owned thread metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { thread: { id: "thread-creative-1" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      workflow: "commerce-creative-project",
    }));

    expect(response.status).toBe(200);
    expect(mocks.registerAgentThreadOwner).toHaveBeenCalledWith(
      "thread-creative-1",
      enterpriseContext,
      "新任务",
      "creative_project",
      "creative",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: "gpt-5.6-luna",
    });
  });

  it("maps product onboarding to an operations Recipe while keeping workflow metadata server-owned", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { thread: { id: "thread-products-1" } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      workflow: "commerce-product-onboarding",
    }));

    expect(response.status).toBe(200);
    expect(mocks.registerAgentThreadOwner).toHaveBeenCalledWith(
      "thread-products-1",
      enterpriseContext,
      "新任务",
      "product_onboarding",
      "operations",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: "gpt-5.6-luna",
    });
  });

  it.each([
    ["market_research", "market_research", "research"],
    ["new_product_development", "new_product_development", "research"],
    ["product_retrospective", "product_retrospective", "research"],
  ] as const)("binds insight method %s to its persisted Recipe", async (insightMethod, recipeId, category) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { thread: { id: `thread-${insightMethod}` } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      workflow: "commerce-product-insight",
      insightMethod,
    }));

    expect(response.status).toBe(200);
    expect(mocks.registerAgentThreadOwner).toHaveBeenCalledWith(
      `thread-${insightMethod}`,
      enterpriseContext,
      "新任务",
      recipeId,
      category,
    );
  });

  it("rejects a missing or unknown product insight method before creating a Harness thread", async () => {
    const missing = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      workflow: "commerce-product-insight",
    }));
    const unknown = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      workflow: "commerce-product-insight",
      insightMethod: "../../custom-skill",
    }));

    expect(missing.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(mocks.registerAgentThreadOwner).not.toHaveBeenCalled();
  });

  it("rejects direct Recipe metadata and unknown workflow values", async () => {
    const directRecipe = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      recipeId: "creative_project",
    }));
    const unknownWorkflow = await POST(jsonRequest({
      model: "gpt-5.6-luna",
      workflow: "commerce-user-defined-workflow",
    }));

    expect(directRecipe.status).toBe(400);
    expect(unknownWorkflow.status).toBe(400);
    expect(mocks.registerAgentThreadOwner).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/agent/threads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
