import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceEnterpriseRateLimit: vi.fn(),
  getAgentThreadForUser: vi.fn(),
  requireAgentThreadContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/,
  gatewayHeaders: () => ({}),
  gatewayUrl: (path: string) => `http://gateway.test${path}`,
  requireAgentThreadContext: mocks.requireAgentThreadContext,
}));

vi.mock("@/lib/agent/thread-ownership", () => ({
  getAgentThreadForUser: mocks.getAgentThreadForUser,
  isSupportedAgentToolContractVersion: () => true,
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

describe("managed workflow Turn steering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId: "thread-creative-1",
      recipeId: "creative_project",
      category: "creative",
      toolContractVersion: 2,
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("forwards creative direction changes to the dedicated Harness steer route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { turnId: "turn-active-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        message: "标题改得更克制",
        workflow: "commerce-creative-project",
        expectedTurnId: "turn-active-1",
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1" }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gateway.test/api/threads/thread-creative-1/steer",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      message: "标题改得更克制",
      workflow: "commerce-creative-project",
      expectedTurnId: "turn-active-1",
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("keeps active product onboarding changes in the same Harness workflow", async () => {
    mocks.getAgentThreadForUser.mockResolvedValueOnce({
      threadId: "thread-products-1",
      recipeId: "product_onboarding",
      category: "operations",
      toolContractVersion: 4,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { turnId: "turn-products-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        message: "产品编码字段是 spu_code",
        workflow: "commerce-product-onboarding",
        expectedTurnId: "turn-products-1",
        clientRequestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
      { params: Promise.resolve({ threadId: "thread-products-1" }) },
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      workflow: "commerce-product-onboarding",
      expectedTurnId: "turn-products-1",
    });
  });

  it("keeps product insight steering bound to the persisted Skill Recipe", async () => {
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId: "thread-retro-1",
      recipeId: "product_retrospective",
      category: "research",
      toolContractVersion: 4,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: { turnId: "turn-retro-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const accepted = await POST(
      jsonRequest({
        message: "把复盘周期改为最近 90 天",
        workflow: "commerce-product-insight",
        insightMethod: "product_retrospective",
        expectedTurnId: "turn-retro-1",
      }),
      { params: Promise.resolve({ threadId: "thread-retro-1" }) },
    );
    const switched = await POST(
      jsonRequest({
        message: "切换新品开发",
        workflow: "commerce-product-insight",
        insightMethod: "new_product_development",
        expectedTurnId: "turn-retro-1",
      }),
      { params: Promise.resolve({ threadId: "thread-retro-1" }) },
    );

    expect(accepted.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      workflow: "commerce-product-insight",
      insightMethod: "product_retrospective",
    });
    expect(switched.status).toBe(409);
    expect(await switched.json()).toMatchObject({ code: "THREAD_INSIGHT_METHOD_MISMATCH" });
  });

  it("rejects a workflow that conflicts with the persisted Recipe", async () => {
    const response = await POST(
      jsonRequest({
        message: "切换为市场调研",
        workflow: "commerce-market-research",
        expectedTurnId: "turn-active-1",
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "THREAD_WORKFLOW_MISMATCH" });
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/agent/threads/thread-creative-1/steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
