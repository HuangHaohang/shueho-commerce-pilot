import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentThreadForUser: vi.fn(),
  reconcileCreativeCanvasState: vi.fn(),
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
}));
vi.mock("@/lib/creative/creative-canvas-repository", () => ({
  CreativeCanvasRepositoryError: class extends Error {},
  reconcileCreativeCanvasState: mocks.reconcileCreativeCanvasState,
}));

import { GET } from "./route";

const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};
const threadId = "thread-creative-1";

describe("creative infinite canvas route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.getAgentThreadForUser.mockResolvedValue({ threadId, recipeId: "creative_project", category: "creative" });
    mocks.reconcileCreativeCanvasState.mockResolvedValue({
      threadId,
      nodes: [],
      messageRefs: [],
      viewport: null,
      resolvedAt: "2026-08-31T00:00:00.000Z",
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("re-reads authoritative Harness items before materializing canvas nodes", async () => {
    const message = JSON.stringify({
      responseType: "draft",
      deliverableType: "listing_copy",
      channel: "天猫",
      title: "轻装出发",
      body: "通勤更轻松。",
      callToAction: "现在查看",
      complianceNotes: [],
      message: "已生成",
      canvasBlocks: [{
        key: "listing",
        type: "document",
        title: "轻装出发",
        body: "通勤更轻松。",
        columns: [],
        rows: [],
        textLayers: [],
      }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        thread: {
          turns: [{
            id: "turn-creative-1",
            items: [{ id: "message-creative-1", type: "agentMessage", phase: "final_answer", text: message }],
          }],
        },
      },
      generatedImages: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request(`http://localhost/api/agent/threads/${threadId}/canvas`);
    const response = await GET(request, { params: Promise.resolve({ threadId }) });

    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({ sourceHistoryComplete: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://gateway.test/api/threads/${threadId}?limit=100`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(mocks.reconcileCreativeCanvasState).toHaveBeenCalledWith(
      enterpriseContext,
      threadId,
      [expect.objectContaining({
        sourceKind: "agent_message",
        sourceItemId: "message-creative-1",
        sourceBlockKey: "listing",
        messageItemId: "message-creative-1",
        nodeType: "document",
      })],
      { sourceHistoryComplete: true },
    );
  });

  it("holds destructive reconciliation when Harness history still has an older cursor after the page cap", async () => {
    let page = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      page += 1;
      return Promise.resolve(new Response(JSON.stringify({
        result: { thread: { turns: [] } },
        generatedImages: [],
        nextCursor: `cursor-${page}`,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}/canvas`),
      { params: Promise.resolve({ threadId }) },
    );

    expect(response.status).toBe(200);
    expect(await response.clone().json()).toMatchObject({ sourceHistoryComplete: false });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `http://gateway.test/api/threads/${threadId}?limit=100&cursor=cursor-4`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(mocks.reconcileCreativeCanvasState).toHaveBeenCalledWith(
      enterpriseContext,
      threadId,
      [],
      { sourceHistoryComplete: false },
    );
  });

  it("rejects non-creative recipes before reading Gateway history", async () => {
    mocks.getAgentThreadForUser.mockResolvedValue({ threadId, recipeId: "market_research", category: "research" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}/canvas`),
      { params: Promise.resolve({ threadId }) },
    );

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.reconcileCreativeCanvasState).not.toHaveBeenCalled();
  });

  it("fails before Gateway access when thread authorization is denied", async () => {
    const denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: false, response: denied });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}/canvas`),
      { params: Promise.resolve({ threadId }) },
    );

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
