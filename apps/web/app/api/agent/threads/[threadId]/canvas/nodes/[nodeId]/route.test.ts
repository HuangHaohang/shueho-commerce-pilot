import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readCreativeCanvasState: vi.fn(),
  requireAgentThreadContext: vi.fn(),
  saveCreativeCanvasNodeLayout: vi.fn(),
  saveCreativeCanvasNodeRevision: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({
  AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/,
  requireAgentThreadContext: mocks.requireAgentThreadContext,
}));
vi.mock("@/lib/creative/creative-canvas-repository", () => ({
  CreativeCanvasRepositoryError: class extends Error {},
  readCreativeCanvasState: mocks.readCreativeCanvasState,
  saveCreativeCanvasNodeLayout: mocks.saveCreativeCanvasNodeLayout,
  saveCreativeCanvasNodeRevision: mocks.saveCreativeCanvasNodeRevision,
}));

import { PATCH } from "./route";

const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};
const threadId = "thread-creative-1";
const nodeId = "33333333-3333-4333-8333-333333333333";
const imageContent = {
  kind: "image" as const,
  title: "商品主图",
  description: "原始说明",
  image: { artifactId: "image-1", url: "/image-1.png", filename: "image-1.png", model: "gpt-image-2" },
  textLayers: [],
  complianceNotes: [],
};
const node = {
  id: nodeId,
  nodeType: "image",
  revision: { id: "revision-1", number: 1, origin: "harness", content: imageContent },
  layout: { x: 10, y: 20, width: 440, height: 420, zIndex: 0, locked: false },
};

describe("creative canvas node route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentThreadContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.readCreativeCanvasState.mockResolvedValue({ nodes: [node] });
    mocks.saveCreativeCanvasNodeRevision.mockResolvedValue({
      ...node,
      revision: { ...node.revision, id: "revision-2", number: 2, origin: "user" },
    });
  });

  it("edits image text layers without accepting a replacement artifact", async () => {
    const request = jsonRequest({
      content: {
        kind: "image",
        title: "商品主图第二版",
        description: "文字已调整",
        textLayers: [{ id: "headline", text: "轻量通勤", x: 8, y: 9, width: 40, fontSize: 28, align: "left" }],
        complianceNotes: [],
      },
    });
    const response = await PATCH(request, { params: Promise.resolve({ threadId, nodeId }) });

    expect(response.status).toBe(200);
    expect(mocks.requireAgentThreadContext).toHaveBeenCalledWith(request, threadId, "agent.run");
    expect(mocks.saveCreativeCanvasNodeRevision).toHaveBeenCalledWith(
      enterpriseContext,
      threadId,
      nodeId,
      expect.objectContaining({ image: imageContent.image, textLayers: [expect.objectContaining({ text: "轻量通勤" })] }),
    );
  });

  it("rejects browser attempts to replace the native image artifact", async () => {
    const response = await PATCH(jsonRequest({
      content: {
        kind: "image",
        title: "伪造主图",
        description: "",
        image: { artifactId: "forged", url: "https://evil.invalid/image.png", filename: "x.png", model: "x" },
        textLayers: [],
        complianceNotes: [],
      },
    }), { params: Promise.resolve({ threadId, nodeId }) });

    expect(response.status).toBe(400);
    expect(mocks.saveCreativeCanvasNodeRevision).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new Request(`http://localhost/api/agent/threads/${threadId}/canvas/nodes/${nodeId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
