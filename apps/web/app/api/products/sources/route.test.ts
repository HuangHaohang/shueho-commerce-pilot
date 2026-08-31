import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProductSource: vi.fn(),
  enforceEnterpriseRateLimit: vi.fn(),
  listProductSources: vi.fn(),
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/enterprise/rate-limit", () => ({ enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit }));
vi.mock("@/lib/product-catalog/connector-repository", () => ({
  createProductSource: mocks.createProductSource,
  listProductSources: mocks.listProductSources,
}));

import { GET, POST } from "./route";

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  permissions: new Set(["product_catalog.read", "product_catalog.sources.manage"]),
};

const source = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "商品只读库",
  connectorKey: "postgres_readonly",
  connectorVersion: "1.0.0",
  kind: "database",
  status: "active",
  connectionState: "untested",
  adapterAvailability: "ready",
  publicConfig: { schema: "public", table: "products" },
  secretReference: { configured: true, scheme: "env", displayHint: "COMMERCE_PRODUCT_SOURCE_DB…" },
  lastTest: null,
  lastSync: null,
  sync: { available: false, reason: "同步尚未启用。" },
  updatedAt: "2026-08-30T00:00:00.000Z",
};

describe("product sources route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.listProductSources.mockResolvedValue([source]);
    mocks.createProductSource.mockResolvedValue({ source, duplicate: false });
  });

  it("lists redacted workspace source state", async () => {
    const response = await GET(new Request("http://localhost/api/products/sources"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sources[0].secretReference).toEqual(source.secretReference);
    expect(JSON.stringify(body)).not.toContain("postgresql://");
  });

  it("creates a source only from connector identity, public config, and secret reference", async () => {
    const request = new Request("http://localhost/api/products/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        name: "商品只读库",
        connectorKey: "postgres_readonly",
        connectorVersion: "1.0.0",
        publicConfig: { schema: "public", table: "products" },
        secretReference: "broker:psh_12345678901234567890123456789012",
      }),
    });
    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.createProductSource).toHaveBeenCalledWith(context, expect.objectContaining({
      secretReference: "broker:psh_12345678901234567890123456789012",
      publicConfig: { schema: "public", table: "products" },
    }));
  });

  it("rejects raw credential fields at the route boundary", async () => {
    const response = await POST(new Request("http://localhost/api/products/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        name: "unsafe",
        connectorKey: "postgres_readonly",
        connectorVersion: "1.0.0",
        publicConfig: {},
        secretReference: null,
        password: "do-not-accept",
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createProductSource).not.toHaveBeenCalled();
  });

  it("rejects a guessed environment name instead of treating it as a secret handle", async () => {
    const response = await POST(new Request("http://localhost/api/products/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: "44444444-4444-4444-8444-444444444444",
        name: "guessed-env",
        connectorKey: "postgres_readonly",
        connectorVersion: "1.0.0",
        publicConfig: { schema: "public", table: "products" },
        secretReference: "env:COMMERCE_PRODUCT_SOURCE_OTHER_TENANT",
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createProductSource).not.toHaveBeenCalled();
  });
});
