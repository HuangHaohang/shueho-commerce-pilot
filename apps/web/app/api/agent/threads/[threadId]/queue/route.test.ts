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

vi.mock("@/lib/enterprise/rate-limit", () => ({
  enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit,
}));

vi.mock("@/lib/agent/thread-ownership", () => ({
  getAgentThreadForUser: mocks.getAgentThreadForUser,
}));

import { POST } from "./route";

const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};

describe("agent queue contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId: "thread-creative-1",
      recipeId: null,
      category: "general",
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("forwards ordinary queued input without a managed workflow", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ queuedSubmission: { id: "queued-1" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      jsonRequest({
        message: "标题改得更克制",
        clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1" }) },
    );

    expect(response.status).toBe(200);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      message: "标题改得更克制",
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
  });

  it("rejects managed workflows because they must steer the active Turn", async () => {
    const response = await POST(
      jsonRequest({
        message: "切换成调研",
        workflow: "commerce-creative-project",
      }),
      { params: Promise.resolve({ threadId: "thread-creative-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Turn steering"),
    });
  });

  it("rejects queueing on a persisted managed-workflow thread even when workflow is omitted", async () => {
    mocks.getAgentThreadForUser.mockResolvedValue({
      threadId: "thread-creative-1",
      recipeId: "creative_project",
      category: "creative",
    });
    const response = await POST(
      jsonRequest({ message: "标题改得更克制" }),
      { params: Promise.resolve({ threadId: "thread-creative-1" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("Turn steering"),
    });
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/agent/threads/thread-creative-1/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
