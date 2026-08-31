import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProducts: vi.fn(),
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/product-catalog/repository", () => ({ listProducts: mocks.listProducts }));

import { GET } from "./route";

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  permissions: new Set(["product_catalog.read", "product_catalog.import"]),
};

describe("product list route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context });
    mocks.listProducts.mockResolvedValue({
      products: [{
        id: "33333333-3333-4333-8333-333333333333",
        title: "通勤包",
        spu: "BAG-1",
        status: "active",
        variantCount: 2,
        sourceName: "ERP 导出",
        updatedAt: "2026-08-30T00:00:00.000Z",
        imageUrl: null,
      }],
      total: 1,
      nextCursor: null,
      catalogStatus: { status: "idle", latestImportId: null, updatedAt: null },
    });
  });

  it("returns the stable product-library wrapper and permission state", async () => {
    const response = await GET(new Request("http://localhost/api/products?query=通勤包&limit=20"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products[0]).toMatchObject({ title: "通勤包", spu: "BAG-1", variantCount: 2 });
    expect(body.permission).toEqual({ canRead: true, canImport: true, canReview: false, canManageSources: false });
    expect(mocks.listProducts).toHaveBeenCalledWith(context, { query: "通勤包", limit: 20, cursor: null });
  });

  it("rejects an invalid page size before querying SQL", async () => {
    const response = await GET(new Request("http://localhost/api/products?limit=1000"));

    expect(response.status).toBe(400);
    expect(mocks.listProducts).not.toHaveBeenCalled();
  });
});
