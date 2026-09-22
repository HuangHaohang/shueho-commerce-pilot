import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), rate: vi.fn(), stop: vi.fn() }));
vi.mock("@/lib/agent/http", () => ({ AGENT_ID_PATTERN: /^[A-Za-z0-9_-]{8,128}$/, gatewayHeaders: () => ({}), gatewayUrl: (path: string) => `http://gateway.test${path}`, requireAgentThreadContext: mocks.access }));
vi.mock("@/lib/agent/thread-ownership", () => ({ isAgentThreadOwner: vi.fn() }));
vi.mock("@/lib/enterprise/context", () => ({ requireEnterprisePermission: vi.fn(), resolveEnterpriseContext: vi.fn() }));
vi.mock("@/lib/enterprise/rate-limit", () => ({ enforceEnterpriseRateLimit: mocks.rate }));
vi.mock("@/lib/agent/sse-authorization-scheduler", () => ({ scheduleSseAuthorizationChecks: () => mocks.stop }));
import { GET } from "./route";
const request = () => new Request("http://localhost/api/agent/events?threadId=owned-thread");

describe("native SSE handshake deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.access.mockResolvedValue({ ok: true, context: { tenantId: "tenant", userId: "user" } });
    mocks.rate.mockResolvedValue(null);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("aborts a stalled handshake and releases the stream quota", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    // More attempts than the live-stream cap prove timeout cleanup releases slots.
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = GET(request());
      await vi.advanceTimersByTimeAsync(10_001);
      expect((await response).status).toBe(503);
    }
  });

  it("does not apply the handshake timeout to an established native stream", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      signal = options.signal;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(": connected\n\n")); } }));
    }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(signal?.aborted).toBe(false);
    await response.body?.cancel();
    expect(signal?.aborted).toBe(true);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
