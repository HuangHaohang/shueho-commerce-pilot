import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProductImport: vi.fn(),
  enforceEnterpriseRateLimit: vi.fn(),
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/enterprise/rate-limit", () => ({ enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit }));
vi.mock("@/lib/product-catalog/repository", () => ({ createProductImport: mocks.createProductImport }));

import { POST } from "./route";

const context = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};

describe("product import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.createProductImport.mockResolvedValue({
      import: {
        id: "33333333-3333-4333-8333-333333333333",
        sourceId: "44444444-4444-4444-8444-444444444444",
        fileName: "products.csv",
        status: "ready_to_publish",
        totalRecords: 1,
        importedProducts: 0,
        importedVariants: 0,
        issueCount: 0,
        mappingRevisionId: "55555555-5555-4555-8555-555555555555",
        createdAt: "2026-08-30T00:00:00.000Z",
      },
      issues: [],
      duplicate: false,
    });
  });

  it("accepts one real CSV multipart upload", async () => {
    const form = new FormData();
    form.append("file", new File(["spu,title,sku\nP-1,水杯,SKU-1\n"], "products.csv", { type: "text/csv" }));
    form.append("sourceName", "ERP 导出");
    form.append("idempotencyKey", "66666666-6666-4666-8666-666666666666");

    const response = await POST(productImportRequest(form));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.import).toMatchObject({ status: "ready_to_publish", totalRecords: 1, importedProducts: 0 });
    expect(mocks.createProductImport).toHaveBeenCalledWith(context, expect.objectContaining({
      sourceName: "ERP 导出",
      idempotencyKey: "66666666-6666-4666-8666-666666666666",
      activateIfValid: false,
      parsed: expect.objectContaining({ contentType: "text/csv", records: [{ spu: "P-1", title: "水杯", sku: "SKU-1" }] }),
    }));
  });

  it("retains formula-like source text as an issue instead of executing it", async () => {
    const form = new FormData();
    form.append("file", new File(["spu,title\nP-1,=CMD()\n"], "products.csv", { type: "text/csv" }));
    form.append("idempotencyKey", "77777777-7777-4777-8777-777777777777");

    await POST(productImportRequest(form));

    expect(mocks.createProductImport).toHaveBeenCalledWith(context, expect.objectContaining({
      parsed: expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "FORMULA_LIKE_CELL", severity: "error" })]),
      }),
    }));
  });

  it("accepts one bounded JSON product array", async () => {
    const form = new FormData();
    form.append("file", new File([
      JSON.stringify([{ spu: "P-JSON-1", title: "玻璃杯", sku: "SKU-JSON-1", attributes: { material: "玻璃" } }]),
    ], "products.json", { type: "application/json" }));
    form.append("idempotencyKey", "88888888-8888-4888-8888-888888888888");

    const response = await POST(productImportRequest(form));

    expect(response.status).toBe(201);
    expect(mocks.createProductImport).toHaveBeenCalledWith(context, expect.objectContaining({
      parsed: expect.objectContaining({
        contentType: "application/json",
        records: [expect.objectContaining({ spu: "P-JSON-1", attributes: { material: "玻璃" } })],
      }),
    }));
  });

  it("returns the Enterprise permission denial without parsing a file", async () => {
    mocks.requireAgentContext.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
    });

    const response = await POST(new Request("http://localhost/api/products/imports", { method: "POST" }));

    expect(response.status).toBe(403);
    expect(mocks.createProductImport).not.toHaveBeenCalled();
  });
});

function productImportRequest(form: FormData): Request {
  return new Request("http://localhost/api/products/imports", {
    method: "POST",
    headers: { "content-length": "1024" },
    body: form,
  });
}
