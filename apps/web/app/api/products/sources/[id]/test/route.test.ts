import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceEnterpriseRateLimit: vi.fn(),
  requireAgentContext: vi.fn(),
  testProductSourceConnection: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/enterprise/rate-limit", () => ({ enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit }));
vi.mock("@/lib/product-catalog/connector-repository", () => ({
  testProductSourceConnection: mocks.testProductSourceConnection,
}));

import { POST } from "./route";

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};

describe("product source connection test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.testProductSourceConnection.mockResolvedValue({
      test: {
        id: "55555555-5555-4555-8555-555555555555",
        status: "unavailable",
        testedAt: "2026-08-30T00:00:00.000Z",
        code: "CONNECTOR_ADAPTER_NOT_CONFIGURED",
        message: "适配器未配置。",
        proof: { readOnly: false, selectAllowed: false, writePrivileges: false },
      },
      source: { id: "33333333-3333-4333-8333-333333333333" },
      duplicate: false,
    });
  });

  it("returns a real unavailable result instead of a fake success", async () => {
    const response = await POST(new Request("http://localhost/api/products/sources/source/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "44444444-4444-4444-8444-444444444444" }),
    }), { params: Promise.resolve({ id: "33333333-3333-4333-8333-333333333333" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.test).toMatchObject({ status: "unavailable", code: "CONNECTOR_ADAPTER_NOT_CONFIGURED" });
    expect(mocks.testProductSourceConnection).toHaveBeenCalledWith(context, {
      sourceId: "33333333-3333-4333-8333-333333333333",
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
    });
  });
});
