import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { JustOneApiClient } from "./justoneapi-client.js";
import { credentialForToken } from "./justoneapi-credentials.js";
import { JustOneApiError } from "./justoneapi-errors.js";
import { defaultJustOneApiResilience, parseRetryAfter } from "./justoneapi-retry-policy.js";
import type { JustOneApiTokenStore } from "./justoneapi-token-store.js";
import type { ProviderCallResult, ProviderEndpoint, ProviderTransportRequest } from "./types.js";

const endpoint = { apiPath: "/api/fixture/v1" } as ProviderEndpoint;
const request = { requestSha256: "a".repeat(64) } as ProviderTransportRequest;
const identity = { rawCallId: "raw", tenantId: "tenant", workspaceId: "workspace", userId: "user", apiPath: endpoint.apiPath, requestSha256: request.requestSha256 };
function response(code: number | null, httpStatus = 200): ProviderCallResult {
  const payload = code === null ? null : { code, data: code === 0 ? { value: "fixture" } : null };
  const rawBody = JSON.stringify(payload), rawBytes = Buffer.from(rawBody);
  return { state: code === 0 ? "succeeded" : "business_failed", httpStatus, payload, rawBody, rawBytes,
    responseSha256: createHash("sha256").update(rawBytes).digest("hex"), contentType: "application/json", responseBytes: rawBytes.length,
    providerCode: code, providerMessage: null, providerRequestId: null, providerRecordedAt: null };
}
function fixture(responses: Array<ProviderCallResult | Error>) {
  let now = 100_000, ordinal = 0;
  const credential = credentialForToken("unit-test-provider-token");
  const store = {
    register: vi.fn(async () => undefined), status: vi.fn(async () => ({})), begin: vi.fn(async () => undefined),
    reserve: vi.fn(async () => ({ id: `attempt-${++ordinal}`, tokenId: credential.id, ordinal })),
    availabilityDelay: vi.fn(async () => null), progress: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => true), cancel: vi.fn(async () => undefined), complete: vi.fn(async () => undefined),
    unknown: vi.fn(async () => undefined), finish: vi.fn(async () => undefined),
  };
  const send = vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Unexpected provider replay");
    return next;
  });
  const admission = { acquire: vi.fn(async () => ({ acquired: true, waitMs: 0, reason: null as string | null })),
    feedback: vi.fn(async () => 0), release: vi.fn(async () => undefined) };
  const transport = { prepare: vi.fn(async () => ({ proxyNodeId: "fixture", send, close: vi.fn() })) };
  const options = { ...defaultJustOneApiResilience, totalTimeoutMs: 10_000, minimumAttemptWindowMs: 1, retryBaseMs: 1 };
  const client = new JustOneApiClient({ credentials: async () => [credential], store: store as unknown as JustOneApiTokenStore,
    transport, admission, resilience: options, timeoutMs: () => 1000, configured: true,
    now: () => now, wait: async (ms) => { now += ms; } });
  return { client, store, admission, transport, send, options };
}

describe("bounded provider retries", () => {
  it.each([301, 302])("retries explicit code %s using the same governed identity and archives each result", async (code) => {
    const f = fixture([response(code, code === 302 ? 429 : 200), response(0)]);
    expect((await f.client.call(endpoint, request, identity)).providerCode).toBe(0);
    expect(f.store.begin).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.store.complete).toHaveBeenCalledTimes(2);
    expect(f.store.complete.mock.calls.map((args: unknown[]) => (args[2] as ProviderCallResult).providerCode)).toEqual([code, 0]);
    expect(f.store.finish).toHaveBeenCalledWith(identity, expect.any(String), "completed");
  });

  it("stops after three explicit rejections, preserving the final failure", async () => {
    const f = fixture([response(301), response(301), response(301), response(0)]);
    expect((await f.client.call(endpoint, request, identity)).providerCode).toBe(301);
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.store.finish).toHaveBeenCalledWith(identity, expect.any(String), "failed");
  });

  it.each([100, 201, 202, 303, 400, 600, 601, 602])("does not retry permanent/quota/resource response %s", async (code) => {
    const f = fixture([response(code, 429), response(0)]);
    expect((await f.client.call(endpoint, request, identity)).providerCode).toBe(code);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each([response(null), response(500), response(302, 503)])("never retries incomplete or uncertain responses", async (result) => {
    const f = fixture([result, response(0)]);
    await expect(f.client.call(endpoint, request, identity)).rejects.toMatchObject({ uncertain: true });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("never retries a disconnect or an archive failure after sending", async () => {
    const disconnected = fixture([new JustOneApiError("reset", "RESULT_UNKNOWN", true), response(0)]);
    await expect(disconnected.client.call(endpoint, request, identity)).rejects.toMatchObject({ uncertain: true });
    expect(disconnected.send).toHaveBeenCalledTimes(1);
    const archiveFailed = fixture([response(302), response(0)]);
    archiveFailed.store.complete.mockRejectedValueOnce(new Error("SQL unavailable"));
    await expect(archiveFailed.client.call(endpoint, request, identity)).rejects.toMatchObject({ uncertain: true });
    expect(archiveFailed.send).toHaveBeenCalledTimes(1);
  });

  it("releases an unsent reservation before retrying proxy setup", async () => {
    const f = fixture([response(0)]);
    f.transport.prepare.mockRejectedValueOnce(new JustOneApiError("no tunnel", "PROXY_UNAVAILABLE", false));
    await f.client.call(endpoint, request, identity);
    expect(f.store.cancel).toHaveBeenCalledTimes(1);
    expect(f.store.dispatch).toHaveBeenCalledTimes(1);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("does not ignore a Retry-After longer than the remaining budget", async () => {
    const f = fixture([{ ...response(302, 429), retryAfterMs: 60_000 }, response(0)]);
    expect((await f.client.call(endpoint, request, identity)).providerCode).toBe(302);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.store.progress).toHaveBeenLastCalledWith(identity, expect.any(String), 1, "rate_limited", 160_000);
  });

  it("closes admission for an unreadable 429 without replaying that uncertain request", async () => {
    const f = fixture([response(null, 429), response(0)]);
    await expect(f.client.call(endpoint, request, identity)).rejects.toMatchObject({ uncertain: true });
    expect(f.admission.feedback).toHaveBeenCalledWith(endpoint.apiPath, true, null);
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("queues before reserving quota and fails closed on queue deadline", async () => {
    const f = fixture([response(0)]);
    f.admission.acquire.mockResolvedValue({ acquired: false, waitMs: 60_000, reason: "capacity" });
    await expect(f.client.call(endpoint, request, identity)).rejects.toMatchObject({ code: "ADMISSION_TIMEOUT", uncertain: false });
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("can initialize after a transient database/configuration failure", async () => {
    const f = fixture([response(0)]);
    f.store.register.mockRejectedValueOnce(new Error("temporary outage"));
    await expect(f.client.call(endpoint, request, identity)).rejects.toMatchObject({ code: "NOT_CONFIGURED", uncertain: false });
    await expect(f.client.call(endpoint, request, identity)).resolves.toMatchObject({ providerCode: 0 });
    expect(f.store.register).toHaveBeenCalledTimes(2);
  });
});

it("parses seconds and HTTP dates without shortening a provider wait", () => {
  expect(parseRetryAfter("12", 0)).toBe(12_000);
  expect(parseRetryAfter("0", 0)).toBe(0);
  expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("2015-10-21T07:27:00Z"))).toBe(60_000);
  expect(parseRetryAfter("invalid", 0)).toBeNull();
  expect(parseRetryAfter("-1", 0)).toBeNull();
});
