import { afterEach, describe, expect, it, vi } from "vitest";

import { getLatestProductImport, getProductCatalog } from "./catalog";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getLatestProductImport", () => {
  it("reads the authenticated latest-import evidence contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      latest: {
        import: {
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "44444444-4444-4444-8444-444444444444",
          fileName: "products.csv",
          status: "ready_to_publish",
          totalRecords: 2,
          importedProducts: 0,
          importedVariants: 0,
          issueCount: 0,
          mappingRevisionId: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-08-30T00:00:00.000Z",
        },
        fields: [{ path: "/spu", observedTypes: ["string"], presentCount: 2 }],
        issues: [],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLatestProductImport();

    expect(result.latest?.import.status).toBe("ready_to_publish");
    expect(result.latest?.fields).toEqual([{ path: "/spu", observedTypes: ["string"], presentCount: 2 }]);
    expect(fetchMock).toHaveBeenCalledWith("/api/products/imports/latest", expect.objectContaining({ cache: "no-store" }));
  });
});

describe("getProductCatalog", () => {
  it("requests the tenant-scoped catalog with bounded query parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      products: [],
      total: 0,
      nextCursor: null,
      catalogStatus: { status: "idle", latestImportId: null, updatedAt: null },
      permission: { canRead: true, canImport: false, canReview: false, canManageSources: false },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getProductCatalog({ query: "背包", limit: 500 });

    expect(result.total).toBe(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/products?query=%E8%83%8C%E5%8C%85&limit=100",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("preserves a 403 as a permission error for explicit UI handling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "没有产品库查看权限",
      code: "PRODUCT_READ_FORBIDDEN",
      requestId: "req-403",
    }), { status: 403, headers: { "Content-Type": "application/json" } })));

    await expect(getProductCatalog()).rejects.toMatchObject({
      status: 403,
      code: "PRODUCT_READ_FORBIDDEN",
      requestId: "req-403",
    });
  });
});
