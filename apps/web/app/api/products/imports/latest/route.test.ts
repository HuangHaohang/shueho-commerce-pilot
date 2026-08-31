import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectProductImport: vi.fn(),
  listProductImports: vi.fn(),
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/product-catalog/repository", () => ({
  inspectProductImport: mocks.inspectProductImport,
  listProductImports: mocks.listProductImports,
}));

import { GET } from "./route";

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};
const latestImport = {
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
};

describe("latest product import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context });
    mocks.listProductImports.mockResolvedValue({ imports: [latestImport] });
    mocks.inspectProductImport.mockResolvedValue({
      import: latestImport,
      schemaHash: "private-schema-hash",
      fields: [{
        path: "/spu",
        observedTypes: ["string"],
        presentCount: 2,
        sampleValues: ["SPU-SECRET"],
      }],
      issues: [],
    });
  });

  it("returns the latest same-scope import inspection without raw samples", async () => {
    const response = await GET(new Request("http://localhost/api/products/imports/latest"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireAgentContext).toHaveBeenCalledWith(expect.any(Request), "product_catalog.read");
    expect(mocks.listProductImports).toHaveBeenCalledWith(context, { limit: 1 });
    expect(mocks.inspectProductImport).toHaveBeenCalledWith(context, latestImport.id);
    expect(body.latest.import).toMatchObject({ id: latestImport.id, status: "ready_to_publish" });
    expect(body.latest.fields).toEqual([{ path: "/spu", observedTypes: ["string"], presentCount: 2 }]);
    expect(JSON.stringify(body)).not.toContain("SPU-SECRET");
    expect(JSON.stringify(body)).not.toContain("private-schema-hash");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns an explicit empty state without inspecting an arbitrary id", async () => {
    mocks.listProductImports.mockResolvedValue({ imports: [] });

    const response = await GET(new Request("http://localhost/api/products/imports/latest"));

    expect(await response.json()).toEqual({ latest: null });
    expect(mocks.inspectProductImport).not.toHaveBeenCalled();
  });

  it("fails closed before querying repository when read permission is denied", async () => {
    const denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    mocks.requireAgentContext.mockResolvedValue({ ok: false, response: denied });

    const response = await GET(new Request("http://localhost/api/products/imports/latest"));

    expect(response.status).toBe(403);
    expect(mocks.listProductImports).not.toHaveBeenCalled();
    expect(mocks.inspectProductImport).not.toHaveBeenCalled();
  });
});
