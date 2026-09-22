import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const mocks = vi.hoisted(() => ({ access: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.access, gatewayHeaders: () => ({}) }));
vi.mock("@/lib/agent/thread-ownership", () => ({ isAgentThreadOwner: mocks.owner }));
import { GET } from "./route";

const filename = "1789000000000-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.png";
const route = { params: Promise.resolve({ filename }) };
const url = `http://localhost/api/provider/generated-images/${filename}`;
const metadata = () => Response.json({ artifact: { threadId: "owned-thread" } });

describe("authorized generated image previews", () => {
  beforeEach(() => {
    mocks.access.mockResolvedValue({ ok: true, context: {} });
    mocks.owner.mockResolvedValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("returns a bounded WebP preview without generating another image", async () => {
    const original = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#ddd" } }).png().toBuffer();
    const fetchMock = vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response(new Uint8Array(original)));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request(`${url}?preview=1`), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    const result = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    expect(result.width).toBe(640);
    expect(result.height).toBeLessThanOrEqual(640);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/api/generated-images/${filename}`);
  });

  it("rechecks authorization and ownership before serving a 304", async () => {
    const etag = `"${filename}-preview-webp-640-v1"`;
    const fetchMock = vi.fn().mockImplementation(async () => metadata());
    vi.stubGlobal("fetch", fetchMock);
    const request = () => new Request(`${url}?preview=1`, { headers: { "if-none-match": etag } });
    expect((await GET(request(), route)).status).toBe(304);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    mocks.owner.mockResolvedValue(false);
    expect((await GET(request(), route)).status).toBe(404);
    mocks.access.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(request(), route)).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("downloads the exact original even with preview and cache headers", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response(bytes, { headers: { "content-type": "image/png", "content-length": "4" } })));
    const response = await GET(new Request(`${url}?preview=1&download=1`, { headers: { "if-none-match": `"${filename}-original"` } }), route);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(filename);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("fails safely when image decode fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(metadata()).mockResolvedValueOnce(new Response("broken image")));
    expect((await GET(new Request(`${url}?preview=1`), route)).status).toBe(503);
  });
});
