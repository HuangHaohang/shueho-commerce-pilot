import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeProductCatalogAction: vi.fn(),
  createProductImport: vi.fn(),
  isAuthorizedGatewayCallback: vi.fn(),
  recordProductCatalogManagementApprovalEvidence: vi.fn(),
}));

vi.mock("@/lib/agent/internal-auth", () => ({
  isAuthorizedGatewayCallback: mocks.isAuthorizedGatewayCallback,
}));
vi.mock("@/lib/product-catalog/authorization", () => ({
  authorizeProductCatalogAction: mocks.authorizeProductCatalogAction,
  recordProductCatalogManagementApprovalEvidence: mocks.recordProductCatalogManagementApprovalEvidence,
}));
vi.mock("@/lib/product-catalog/repository", () => ({ createProductImport: mocks.createProductImport }));

import { POST } from "./route";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  rootThreadId: "thread-product-1",
};
const artifactId = "33333333-3333-4333-8333-333333333333";
const approval = {
  approvalRequestId: "product_import_1234",
  approvalItemId: "call_import_1234",
  turnId: "turn_import_1234",
  approvedAt: "2026-08-30T10:00:00.000Z",
};

describe("internal product artifact import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedGatewayCallback.mockReturnValue(true);
    mocks.authorizeProductCatalogAction.mockResolvedValue(true);
    mocks.createProductImport.mockResolvedValue({
      import: { id: "44444444-4444-4444-8444-444444444444", status: "needs_review" },
      issues: [],
      duplicate: false,
    });
  });

  it("accepts only approved, checksum-matched CSV bytes and reauthorizes before the write", async () => {
    const bytes = Buffer.from("spu,title,sku\nP-1,通勤包,SKU-1\n");
    const metadata = {
      ...scope,
      action: "create_import_from_artifact",
      artifactId,
      artifactChecksumSha256: createHash("sha256").update(bytes).digest("hex"),
      sourceName: "ERP 导出",
      idempotencyKey: artifactId,
      ...approval,
    };

    const response = await POST(multipartRequest(metadata, bytes));

    expect(response.status).toBe(201);
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeProductCatalogAction).toHaveBeenNthCalledWith(1, scope, "product_catalog.import");
    expect(mocks.recordProductCatalogManagementApprovalEvidence).toHaveBeenCalledWith(scope, {
      action: "create_import_from_artifact",
      targetType: "thread_artifact",
      targetId: artifactId,
      idempotencyKey: artifactId,
      ...approval,
    });
    expect(mocks.createProductImport).toHaveBeenCalledWith(scope, expect.objectContaining({
      sourceName: "ERP 导出",
      idempotencyKey: artifactId,
      parsed: expect.objectContaining({
        contentType: "text/csv",
        contentSha256: metadata.artifactChecksumSha256,
        records: [{ spu: "P-1", title: "通勤包", sku: "SKU-1" }],
      }),
    }));
  });

  it("rejects a checksum mismatch before audit or repository access", async () => {
    const bytes = Buffer.from("spu,title\nP-1,通勤包\n");
    const response = await POST(multipartRequest({
      ...scope,
      action: "create_import_from_artifact",
      artifactId,
      artifactChecksumSha256: "a".repeat(64),
      sourceName: null,
      idempotencyKey: artifactId,
      ...approval,
    }, bytes));

    expect(response.status).toBe(409);
    expect(mocks.recordProductCatalogManagementApprovalEvidence).not.toHaveBeenCalled();
    expect(mocks.createProductImport).not.toHaveBeenCalled();
  });

  it("rejects callbacks without the private Gateway credential", async () => {
    mocks.isAuthorizedGatewayCallback.mockReturnValue(false);
    const response = await POST(new Request(
      "http://localhost/api/internal/product-catalog/import-artifact",
      { method: "POST" },
    ));
    expect(response.status).toBe(401);
    expect(mocks.authorizeProductCatalogAction).not.toHaveBeenCalled();
  });
});

function multipartRequest(metadata: Record<string, unknown>, bytes: Buffer): Request {
  const form = new FormData();
  form.append("metadata", JSON.stringify(metadata));
  form.append("file", new File([new Uint8Array(bytes)], "products.csv", { type: "text/csv" }));
  return new Request("http://localhost/api/internal/product-catalog/import-artifact", {
    method: "POST",
    headers: { "X-Commerce-Gateway-Token": "test", "content-length": "1024" },
    body: form,
  });
}
