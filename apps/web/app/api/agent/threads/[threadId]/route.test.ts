import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeProductCatalogAction: vi.fn(),
  deleteAgentThreadRecord: vi.fn(),
  getAgentThreadForUser: vi.fn(),
  listAgentMessageFeedback: vi.fn(),
  listAgentUserInputAnswers: vi.fn(),
  listBoundProductContextsByTurnIds: vi.fn(),
  releaseAgentTurnLeaseForTurn: vi.fn(),
  requireAgentThreadContext: vi.fn(),
  updateAgentThreadStatus: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/,
  gatewayHeaders: () => new Headers(),
  gatewayUrl: (path: string) => `http://gateway.test${path}`,
  requireAgentThreadContext: mocks.requireAgentThreadContext,
}));
vi.mock("@/lib/agent/message-feedback", () => ({
  listAgentMessageFeedback: mocks.listAgentMessageFeedback,
}));
vi.mock("@/lib/agent/thread-ownership", () => ({
  deleteAgentThreadRecord: mocks.deleteAgentThreadRecord,
  getAgentThreadForUser: mocks.getAgentThreadForUser,
  updateAgentThreadStatus: mocks.updateAgentThreadStatus,
}));
vi.mock("@/lib/agent/user-input-answers", () => ({
  listAgentUserInputAnswers: mocks.listAgentUserInputAnswers,
}));
vi.mock("@/lib/enterprise/quota", () => ({
  releaseAgentTurnLeaseForTurn: mocks.releaseAgentTurnLeaseForTurn,
}));
vi.mock("@/lib/product-catalog/authorization", () => ({
  authorizeProductCatalogAction: mocks.authorizeProductCatalogAction,
}));
vi.mock("@/lib/product-catalog/repository", () => ({
  listBoundProductContextsByTurnIds: mocks.listBoundProductContextsByTurnIds,
}));

import { GET } from "./route";

const threadId = "thread-history-1";
const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  permissions: new Set(["thread.read.own", "product_catalog.read"]),
};

describe("agent thread history product context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId,
      title: "创作任务",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:01:00.000Z",
      recipeId: "creative_project",
      category: "creative",
    });
    mocks.listAgentUserInputAnswers.mockResolvedValue([]);
    mocks.listAgentMessageFeedback.mockResolvedValue([]);
    mocks.authorizeProductCatalogAction.mockResolvedValue(true);
    mocks.listBoundProductContextsByTurnIds.mockResolvedValue(new Map([
      ["turn-history-1", [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "极简双肩包",
        spu: "BAG-001",
        status: "active",
        variantCount: 2,
        sourceName: "ERP 产品库",
        updatedAt: "2026-08-30T00:00:00.000Z",
        imageUrl: "https://assets.example.com/bag.png",
        attributes: { supplierCost: 99 },
        rawSource: { password: "must-not-leak" },
        credential: "broker:secret",
      }]],
    ]));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(historyPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the exact scoped Product summary only to the default user message", async () => {
    mocks.listAgentUserInputAnswers.mockResolvedValue([{
      requestId: "request-1",
      turnId: "turn-history-1",
      answerMessage: "继续",
    }]);
    const request = new Request(`http://localhost/api/agent/threads/${threadId}`);
    const response = await GET(request, { params: Promise.resolve({ threadId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(
      { ...enterpriseContext, rootThreadId: threadId },
      "product_catalog.read",
    );
    expect(mocks.listBoundProductContextsByTurnIds).toHaveBeenCalledTimes(1);
    expect(mocks.listBoundProductContextsByTurnIds).toHaveBeenCalledWith(
      enterpriseContext,
      { threadId, turnIds: ["turn-history-1", "turn-history-2"] },
    );

    const defaultMessage = body.messages.find((message: { id: string }) => message.id === "user-default");
    const steerMessage = body.messages.find((message: { id: string }) => message.id === "user-steer");
    const answerMessage = body.messages.find((message: { id: string }) => message.id === "user-input-answer-request-1");
    expect(defaultMessage.products).toEqual([{
      id: "33333333-3333-4333-8333-333333333333",
      title: "极简双肩包",
      spu: "BAG-001",
      status: "active",
      variantCount: 2,
      sourceName: "ERP 产品库",
      updatedAt: "2026-08-30T00:00:00.000Z",
      imageUrl: "https://assets.example.com/bag.png",
    }]);
    expect(steerMessage).not.toHaveProperty("products");
    expect(answerMessage).not.toHaveProperty("products");
    expect(body.messages.find((message: { id: string }) => message.id === "user-without-products").products)
      .toEqual([]);
    expect(JSON.stringify(body)).not.toContain("supplierCost");
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(JSON.stringify(body)).not.toContain("broker:secret");
  });

  it("omits every Product projection when live read authorization is absent", async () => {
    mocks.authorizeProductCatalogAction.mockResolvedValue(false);

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}`),
      { params: Promise.resolve({ threadId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listBoundProductContextsByTurnIds).not.toHaveBeenCalled();
    expect(body.messages.find((message: { id: string }) => message.id === "user-default").products)
      .toEqual([]);
    expect(body.messages.find((message: { id: string }) => message.id === "user-steer"))
      .not.toHaveProperty("products");
  });

  it("fails closed without hiding Harness history when the Product projection is unavailable", async () => {
    mocks.listBoundProductContextsByTurnIds.mockRejectedValue(new Error("catalog unavailable"));

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}`),
      { params: Promise.resolve({ threadId }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.listBoundProductContextsByTurnIds).toHaveBeenCalledTimes(1);
    expect(body.messages.find((message: { id: string }) => message.id === "user-default").content)
      .toBe("基于这个产品生成一张产品图");
    expect(body.messages.find((message: { id: string }) => message.id === "user-default").products)
      .toEqual([]);
  });
});

function historyPayload() {
  return {
    result: {
      thread: {
        preview: "创作任务",
        turns: [
          {
            id: "turn-history-1",
            status: "completed",
            items: [
              {
                id: "user-default",
                type: "userMessage",
                content: [{ type: "text", text: "基于这个产品生成一张产品图" }],
              },
              {
                id: "user-steer",
                type: "userMessage",
                content: [{ type: "text", text: "背景改成白色" }],
              },
              {
                id: "assistant-final",
                type: "agentMessage",
                phase: "final_answer",
                text: "已经生成。",
              },
            ],
          },
          {
            id: "turn-history-2",
            status: "completed",
            items: [{
              id: "user-without-products",
              type: "userMessage",
              content: [{ type: "text", text: "继续调整" }],
            }],
          },
        ],
      },
    },
    generatedImages: [],
    attachments: [],
    nextCursor: null,
  };
}
