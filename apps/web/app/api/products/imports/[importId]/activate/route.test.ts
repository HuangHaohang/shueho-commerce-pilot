import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateProductImport: vi.fn(),
  authorizeProductCatalogAction: vi.fn(),
  enforceEnterpriseRateLimit: vi.fn(),
  inspectProductImport: vi.fn(),
  requireAgentContext: vi.fn(),
}));

vi.mock("@/lib/agent/http", () => ({ requireAgentContext: mocks.requireAgentContext }));
vi.mock("@/lib/enterprise/rate-limit", () => ({ enforceEnterpriseRateLimit: mocks.enforceEnterpriseRateLimit }));
vi.mock("@/lib/product-catalog/authorization", () => ({
  authorizeProductCatalogAction: mocks.authorizeProductCatalogAction,
}));
vi.mock("@/lib/product-catalog/repository", () => ({
  activateProductImport: mocks.activateProductImport,
  inspectProductImport: mocks.inspectProductImport,
}));

import { POST } from "./route";

const importId = "33333333-3333-4333-8333-333333333333";
const mappingRevisionId = "55555555-5555-4555-8555-555555555555";
const idempotencyKey = "66666666-6666-4666-8666-666666666666";
const enterpriseContext = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
};

describe("product import activation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAgentContext.mockResolvedValue({ ok: true, context: enterpriseContext });
    mocks.enforceEnterpriseRateLimit.mockResolvedValue(null);
    mocks.authorizeProductCatalogAction.mockResolvedValue(true);
    mocks.activateProductImport.mockResolvedValue({
      id: importId,
      sourceId: "44444444-4444-4444-8444-444444444444",
      fileName: "products.csv",
      status: "completed",
      totalRecords: 2,
      importedProducts: 2,
      importedVariants: 3,
      issueCount: 0,
      mappingRevisionId,
      createdAt: "2026-08-30T00:00:00.000Z",
    });
    mocks.inspectProductImport.mockResolvedValue({ issues: [] });
  });

  it("requires an explicit browser publish confirmation and performs live authorization plus readback", async () => {
    const response = await POST(request({ confirmation: "publish" }), {
      params: Promise.resolve({ importId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.import).toMatchObject({ status: "completed", importedProducts: 2, importedVariants: 3 });
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(enterpriseContext, "product_catalog.import");
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(enterpriseContext, "product_catalog.review");
    expect(mocks.activateProductImport).toHaveBeenCalledWith(enterpriseContext, {
      importId,
      mappingRevisionId,
      idempotencyKey,
    });
    expect(mocks.inspectProductImport).toHaveBeenCalledWith(enterpriseContext, importId);
  });

  it("rejects a missing confirmation before any canonical write", async () => {
    const response = await POST(request({ confirmation: "preview" }), {
      params: Promise.resolve({ importId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.activateProductImport).not.toHaveBeenCalled();
  });

  it("fails closed when live product permission is revoked", async () => {
    mocks.authorizeProductCatalogAction.mockResolvedValue(false);
    const response = await POST(request({ confirmation: "publish" }), {
      params: Promise.resolve({ importId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.activateProductImport).not.toHaveBeenCalled();
  });
});

function request(input: { confirmation: string }): Request {
  return new Request(`http://localhost/api/products/imports/${importId}/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mappingRevisionId,
      idempotencyKey,
      confirmation: input.confirmation,
    }),
  });
}
