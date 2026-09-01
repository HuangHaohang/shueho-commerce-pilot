import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceEnterpriseRateLimit: vi.fn(),
  requireAgentThreadContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/,
  gatewayHeaders: (initial?: HeadersInit) => new Headers(initial),
  gatewayUrl: (path: string) => new URL(path, "http://gateway.test"),
  requireAgentThreadContext: mocks.requireAgentThreadContext,
}));
vi.mock("@/lib/enterprise/rate-limit", () => ({
  enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit,
}));

import { POST } from "./route";

const threadId = "thread-creative-1";
const context = { tenantId: "tenant-1", workspaceId: "workspace-1", userId: "user-1" };

describe("creative canvas asset upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("uploads a bounded image as a canvas-only tenant artifact", async () => {
    const artifactId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      artifact: {
        id: artifactId,
        threadId,
        originalName: "brand-logo.png",
        mimeType: "image/png",
        size: 128,
        kind: "image",
        purpose: "canvas_asset",
      },
    }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.set("file", new File([new Uint8Array(128)], "brand-logo.png", { type: "image/png" }));
    const response = await POST(new Request(`http://localhost/api/agent/threads/${threadId}/canvas/assets`, {
      method: "POST",
      body: formData,
    }), { params: Promise.resolve({ threadId }) });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      asset: { id: artifactId, name: "brand-logo.png", mimeType: "image/png" },
    });
    const forwardedHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(forwardedHeaders.get("X-Commerce-Artifact-Purpose")).toBe("canvas_asset");
  });

  it("rejects non-image design assets before Gateway dispatch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const formData = new FormData();
    formData.set("file", new File(["logo"], "logo.svg", { type: "image/svg+xml" }));
    const response = await POST(new Request(`http://localhost/api/agent/threads/${threadId}/canvas/assets`, {
      method: "POST",
      body: formData,
    }), { params: Promise.resolve({ threadId }) });

    expect(response.status).toBe(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
