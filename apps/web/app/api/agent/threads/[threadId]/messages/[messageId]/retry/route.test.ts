import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateAgentTurnLease: vi.fn(),
  bindProductContextToTurn: vi.fn(),
  cloneProductContextSetForRetry: vi.fn(),
  enforceEnterpriseRateLimit: vi.fn(),
  getAgentThreadForUser: vi.fn(),
  hasBoundProductContextForTurn: vi.fn(),
  isSupportedAgentToolContractVersion: vi.fn(),
  markAgentThreadRunning: vi.fn(),
  releaseAgentTurnLease: vi.fn(),
  requireAgentThreadContext: vi.fn(),
  reserveAgentTurn: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/,
  gatewayHeaders: () => ({}),
  gatewayUrl: (path: string) => `http://gateway.test${path}`,
  requireAgentThreadContext: mocks.requireAgentThreadContext,
}));

vi.mock("@/lib/agent/thread-ownership", () => ({
  getAgentThreadForUser: mocks.getAgentThreadForUser,
  isSupportedAgentToolContractVersion: mocks.isSupportedAgentToolContractVersion,
  markAgentThreadRunning: mocks.markAgentThreadRunning,
}));

vi.mock("@/lib/enterprise/quota", () => ({
  activateAgentTurnLease: mocks.activateAgentTurnLease,
  releaseAgentTurnLease: mocks.releaseAgentTurnLease,
  reserveAgentTurn: mocks.reserveAgentTurn,
}));

vi.mock("@/lib/enterprise/rate-limit", () => ({
  enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit,
}));

vi.mock("@/lib/product-catalog/repository", () => ({
  bindProductContextToTurn: mocks.bindProductContextToTurn,
  cloneProductContextSetForRetry: mocks.cloneProductContextSetForRetry,
  hasBoundProductContextForTurn: mocks.hasBoundProductContextForTurn,
}));

import { POST } from "./route";

const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  permissions: new Set<string>(["product_catalog.read"]),
};

describe("native Harness reply retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId: "thread-creative-1",
      recipeId: "creative_project",
      toolContractVersion: 2,
    });
    mocks.isSupportedAgentToolContractVersion.mockReturnValue(true);
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.hasBoundProductContextForTurn.mockResolvedValue(true);
    mocks.cloneProductContextSetForRetry.mockResolvedValue({
      contextSetId: "77777777-7777-4777-8777-777777777777",
      productIds: ["33333333-3333-4333-8333-333333333333"],
    });
    mocks.reserveAgentTurn.mockResolvedValue({ ok: true, duplicate: false, leaseId: "lease-retry-1" });
    mocks.bindProductContextToTurn.mockResolvedValue(undefined);
    mocks.activateAgentTurnLease.mockResolvedValue(undefined);
    mocks.markAgentThreadRunning.mockResolvedValue(undefined);
    mocks.releaseAgentTurnLease.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("resolves the authoritative assistant Item, clones the exact product revision context, and delegates retry to Gateway", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(historyPayload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        result: { turn: { id: "turn-retry-2", status: "inProgress" } },
        retriedFromTurnId: "turn-source-1",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          effort: "high",
          clientRequestId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1", messageId: "item-8" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.cloneProductContextSetForRetry).toHaveBeenCalledWith(enterpriseContext, {
      threadId: "thread-creative-1",
      sourceTurnId: "turn-source-1",
      clientRequestId: "55555555-5555-4555-8555-555555555555",
    });
    const retryRequest = fetchMock.mock.calls[1];
    expect(String(retryRequest?.[0])).toContain("/messages/item-8/retry");
    expect(JSON.parse(String(retryRequest?.[1]?.body))).toMatchObject({
      expectedTurnId: "turn-source-1",
      productContextMode: "selected",
      productContextSetId: "77777777-7777-4777-8777-777777777777",
      productIds: ["33333333-3333-4333-8333-333333333333"],
    });
    expect(mocks.bindProductContextToTurn).toHaveBeenCalledWith(enterpriseContext, {
      contextSetId: "77777777-7777-4777-8777-777777777777",
      turnId: "turn-retry-2",
    });
    expect(mocks.activateAgentTurnLease).toHaveBeenCalledWith(enterpriseContext, "lease-retry-1", "turn-retry-2");
  });

  it("rejects a browser-selected non-assistant Item before quota admission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        thread: {
          turns: [{
            id: "turn-source-1",
            status: "completed",
            items: [{ id: "item-8", type: "agentMessage", phase: "commentary", text: "处理中" }],
          }],
        },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await POST(
      new Request("http://localhost/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          clientRequestId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1", messageId: "item-8" }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.reserveAgentTurn).not.toHaveBeenCalled();
  });

  it("preserves the quota lease when native revert succeeded but replacement admission is uncertain", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(historyPayload()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "replacement state is uncertain",
        code: "HARNESS_RETRY_START_UNCERTAIN",
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-5.6-sol",
          clientRequestId: "55555555-5555-4555-8555-555555555555",
        }),
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1", messageId: "item-8" }) },
    );

    expect(response.status).toBe(503);
    expect(mocks.releaseAgentTurnLease).not.toHaveBeenCalled();
  });
});

function historyPayload() {
  return {
    result: {
      thread: {
        turns: [{
          id: "turn-source-1",
          status: "completed",
          items: [
            { id: "user-source-1", type: "userMessage", content: [{ type: "text", text: "生成主图" }] },
            { id: "item-8", type: "agentMessage", phase: "final_answer", text: "图片未生成" },
          ],
        }],
      },
    },
  };
}
