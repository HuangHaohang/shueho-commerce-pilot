import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/lib/agent/http", () => ({ AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/, gatewayHeaders: () => ({}), gatewayUrl: (path: string) => `http://gateway.test${path}`, requireAgentThreadContext: mocks.access }));
import { GET } from "./route";
const threadId = "thread-owned123";
const route = { params: Promise.resolve({ threadId }) };
describe("owned image inventory without conversation replay", () => {
  beforeEach(() => { mocks.access.mockResolvedValue({ ok: true, context: {} }); });
  afterEach(() => vi.unstubAllGlobals());
  it("does not call Gateway when ownership is denied", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    mocks.access.mockResolvedValue({ ok: false, response: new Response(null, { status: 404 }) });
    expect((await GET(new Request("http://localhost"), route)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("only projects owned safe artifacts, never paths or base64", async () => {
    const artifact = { filename: "1789000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png", threadId, turnId: "turn-owned", model: "image-model", sourceFilenames: [], path: "/private/image", base64: "private" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ generatedImages: [artifact, { ...artifact, threadId: "thread-foreign" }, { ...artifact, filename: "../secret" }] }))));
    const response = await GET(new Request("http://localhost"), route);
    const body = await response.json(); expect(body.images).toHaveLength(1);
    expect(body.images[0]).not.toHaveProperty("path"); expect(body.images[0]).not.toHaveProperty("base64");
    expect(fetch).toHaveBeenCalledWith(`http://gateway.test/api/threads/${threadId}/images`, expect.anything());
  });
});
