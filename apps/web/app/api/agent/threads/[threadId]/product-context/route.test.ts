import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAgentThreadForUser: vi.fn(),
  getLatestBoundProductContext: vi.fn(),
  requireAgentThreadContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/,
  requireAgentThreadContext: mocks.requireAgentThreadContext,
}));
vi.mock("@/lib/agent/thread-ownership", () => ({
  getAgentThreadForUser: mocks.getAgentThreadForUser,
}));
vi.mock("@/lib/product-catalog/repository", () => ({
  getLatestBoundProductContext: mocks.getLatestBoundProductContext,
}));

import { GET } from "./route";

const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  permissions: new Set(["product_catalog.read"]),
};
const threadId = "thread-creative-1";

describe("creative project product context route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId,
      recipeId: "creative_project",
      category: "creative",
    });
    mocks.getLatestBoundProductContext.mockResolvedValue({
      turnId: "turn-products-1",
      products: [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "轻量通勤包",
        spu: "BAG-1",
        status: "active",
        variantCount: 2,
        sourceName: "ERP 产品库",
        updatedAt: "2026-08-30T00:00:00.000Z",
        imageUrl: "https://assets.example.com/bag.png",
        rawRecord: { password: "must-not-leak" },
        mapping: { source: "/private" },
        credential: "broker:secret",
      }],
      resolvedAt: "2026-08-30T01:00:00.000Z",
    });
  });

  it("returns only the latest bound Turn and bounded product summaries", async () => {
    const request = new Request(`http://localhost/api/agent/threads/${threadId}/product-context`);
    const response = await GET(request, { params: Promise.resolve({ threadId }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.requireAgentThreadContext).toHaveBeenCalledWith(
      request,
      threadId,
      "product_catalog.read",
    );
    expect(mocks.getAgentThreadForUser).toHaveBeenCalledWith(threadId, enterpriseContext);
    expect(mocks.getLatestBoundProductContext).toHaveBeenCalledWith(enterpriseContext, threadId);
    expect(body).toEqual({
      turnId: "turn-products-1",
      products: [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "轻量通勤包",
        spu: "BAG-1",
        status: "active",
        variantCount: 2,
        sourceName: "ERP 产品库",
        updatedAt: "2026-08-30T00:00:00.000Z",
        imageUrl: "https://assets.example.com/bag.png",
      }],
      resolvedAt: "2026-08-30T01:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(JSON.stringify(body)).not.toContain("broker:secret");
    expect(JSON.stringify(body)).not.toContain("/private");
  });

  it("returns an explicit empty state when no bound product Turn exists", async () => {
    mocks.getLatestBoundProductContext.mockResolvedValue({
      turnId: null,
      products: [],
      resolvedAt: "2026-08-30T01:00:00.000Z",
    });

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}/product-context`),
      { params: Promise.resolve({ threadId }) },
    );

    expect(await response.json()).toEqual({
      turnId: null,
      products: [],
      resolvedAt: "2026-08-30T01:00:00.000Z",
    });
  });

  it("fails before the repository when thread authorization is denied", async () => {
    const denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: false, response: denied });

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}/product-context`),
      { params: Promise.resolve({ threadId }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.getAgentThreadForUser).not.toHaveBeenCalled();
    expect(mocks.getLatestBoundProductContext).not.toHaveBeenCalled();
  });

  it("rechecks the scoped thread index before reading product context", async () => {
    mocks.getAgentThreadForUser.mockResolvedValue(null);

    const response = await GET(
      new Request(`http://localhost/api/agent/threads/${threadId}/product-context`),
      { params: Promise.resolve({ threadId }) },
    );

    expect(response.status).toBe(404);
    expect(mocks.getLatestBoundProductContext).not.toHaveBeenCalled();
  });

  it("rejects an unsafe thread id before authentication", async () => {
    const response = await GET(
      new Request("http://localhost/api/agent/threads/x/product-context"),
      { params: Promise.resolve({ threadId: "x" }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.requireAgentThreadContext).not.toHaveBeenCalled();
  });
});
