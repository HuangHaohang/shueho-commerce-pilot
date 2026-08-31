import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activateProductImport: vi.fn(),
  authorizeProductCatalogAction: vi.fn(),
  createProductSource: vi.fn(),
  getProduct: vi.fn(),
  getProductImport: vi.fn(),
  inspectProductImport: vi.fn(),
  isAuthorizedGatewayCallback: vi.fn(),
  listProductConnectors: vi.fn(),
  listProductImports: vi.fn(),
  listProductSources: vi.fn(),
  listProducts: vi.fn(),
  proposeProductMapping: vi.fn(),
  recordProductCatalogApprovalEvidence: vi.fn(),
  recordProductCatalogManagementApprovalEvidence: vi.fn(),
  resolveProductsByIds: vi.fn(),
  resolveProductResearchSubject: vi.fn(),
  testProductSourceConnection: vi.fn(),
  validateProductMapping: vi.fn(),
}));

vi.mock("@/lib/agent/internal-auth", () => ({
  isAuthorizedGatewayCallback: mocks.isAuthorizedGatewayCallback,
}));
vi.mock("@/lib/product-catalog/authorization", () => ({
  authorizeProductCatalogAction: mocks.authorizeProductCatalogAction,
  recordProductCatalogApprovalEvidence: mocks.recordProductCatalogApprovalEvidence,
  recordProductCatalogManagementApprovalEvidence: mocks.recordProductCatalogManagementApprovalEvidence,
}));
vi.mock("@/lib/product-catalog/connector-repository", () => ({
  createProductSource: mocks.createProductSource,
  listProductConnectors: mocks.listProductConnectors,
  listProductSources: mocks.listProductSources,
  testProductSourceConnection: mocks.testProductSourceConnection,
}));
vi.mock("@/lib/product-catalog/repository", () => ({
  activateProductImport: mocks.activateProductImport,
  getProduct: mocks.getProduct,
  getProductImport: mocks.getProductImport,
  inspectProductImport: mocks.inspectProductImport,
  listProductImports: mocks.listProductImports,
  listProducts: mocks.listProducts,
  proposeProductMapping: mocks.proposeProductMapping,
  resolveProductsByIds: mocks.resolveProductsByIds,
  resolveProductResearchSubject: mocks.resolveProductResearchSubject,
  validateProductMapping: mocks.validateProductMapping,
}));

import { POST } from "./route";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  rootThreadId: "thread-product-1",
};
const productId = "33333333-3333-4333-8333-333333333333";

describe("internal product catalog actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAuthorizedGatewayCallback.mockReturnValue(true);
    mocks.authorizeProductCatalogAction.mockResolvedValue(true);
  });

  it("rejects a callback for a tenant outside the configured Web runtime pin", async () => {
    const previous = process.env.COMMERCE_RUNTIME_TENANT_ID;
    process.env.COMMERCE_RUNTIME_TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    try {
      const response = await POST(jsonRequest({ ...scope, action: "list_sources" }));
      expect(response.status).toBe(404);
      expect(mocks.authorizeProductCatalogAction).not.toHaveBeenCalled();
      expect(mocks.listProductSources).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.COMMERCE_RUNTIME_TENANT_ID;
      else process.env.COMMERCE_RUNTIME_TENANT_ID = previous;
    }
  });

  it("scope-resolves selected products only after a live read permission check", async () => {
    mocks.resolveProductsByIds.mockResolvedValue({ products: [{ id: productId }], limitations: [] });
    const response = await POST(jsonRequest({ ...scope, action: "resolve_context", productIds: [productId] }));
    expect(response.status).toBe(200);
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(scope, "product_catalog.read");
    expect(mocks.resolveProductsByIds).toHaveBeenCalledWith(scope, { productIds: [productId] });
  });

  it("resolves a server-fixed research subject only inside the owned root thread", async () => {
    const contextSetId = "44444444-4444-4444-8444-444444444444";
    mocks.resolveProductResearchSubject.mockResolvedValue({
      products: [{ id: productId, revisionId: "55555555-5555-4555-8555-555555555555" }],
      first_party_subject: {
        version: 1,
        subject_ref: contextSetId,
        snapshot_sha256: "a".repeat(64),
        product_count: 1,
        products: [{
          product_id: productId,
          product_revision_id: "55555555-5555-4555-8555-555555555555",
        }],
      },
    });
    const response = await POST(jsonRequest({
      ...scope,
      action: "resolve_research_subject",
      contextSetId,
    }));
    expect(response.status).toBe(200);
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(scope, "product_catalog.read");
    expect(mocks.resolveProductResearchSubject).toHaveBeenCalledWith(scope, {
      contextSetId,
      threadId: scope.rootThreadId,
    });
  });

  it("rechecks import permission and forwards the idempotency key for activation", async () => {
    const importId = "44444444-4444-4444-8444-444444444444";
    const mappingRevisionId = "55555555-5555-4555-8555-555555555555";
    const idempotencyKey = "66666666-6666-4666-8666-666666666666";
    const approval = {
      approvalRequestId: "product_call-12345678",
      approvalItemId: "call_12345678",
      turnId: "turn_12345678",
      approvedAt: "2026-08-30T10:00:00.000Z",
    };
    mocks.activateProductImport.mockResolvedValue({ id: importId, status: "completed" });
    const response = await POST(jsonRequest({
      ...scope,
      action: "activate_import",
      importId,
      mappingRevisionId,
      idempotencyKey,
      ...approval,
    }));
    expect(response.status).toBe(200);
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(scope, "product_catalog.import");
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledWith(scope, "product_catalog.review");
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(4);
    expect(mocks.recordProductCatalogApprovalEvidence).toHaveBeenCalledWith(scope, {
      importId,
      mappingRevisionId,
      idempotencyKey,
      ...approval,
    });
    expect(mocks.activateProductImport).toHaveBeenCalledWith(scope, {
      importId,
      mappingRevisionId,
      idempotencyKey,
    });
  });

  it("lists connector, source, and import state through live tenant-scoped reads", async () => {
    mocks.listProductConnectors.mockResolvedValue([{ key: "file_upload", adapterAvailability: "ready" }]);
    mocks.listProductSources.mockResolvedValue([{ id: productId, name: "商品中心" }]);
    mocks.listProductImports.mockResolvedValue({ imports: [{ id: productId, status: "needs_review" }] });

    const connectorResponse = await POST(jsonRequest({ ...scope, action: "list_connectors" }));
    const sourceResponse = await POST(jsonRequest({ ...scope, action: "list_sources" }));
    const importResponse = await POST(jsonRequest({ ...scope, action: "list_imports", limit: 10 }));

    expect(await connectorResponse.json()).toEqual({ result: { connectors: [expect.objectContaining({ key: "file_upload" })] } });
    expect(await sourceResponse.json()).toEqual({ result: { sources: [expect.objectContaining({ name: "商品中心" })] } });
    expect(await importResponse.json()).toEqual({ result: { imports: [expect.objectContaining({ status: "needs_review" })] } });
    expect(mocks.listProductImports).toHaveBeenCalledWith(scope, { limit: 10 });
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(3);
  });

  it("records approval, reauthorizes, and preserves an unavailable real source test", async () => {
    const sourceId = "44444444-4444-4444-8444-444444444444";
    const idempotencyKey = "55555555-5555-4555-8555-555555555555";
    const approval = {
      approvalRequestId: "product_test_1234",
      approvalItemId: "call_test_1234",
      turnId: "turn_test_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    };
    mocks.testProductSourceConnection.mockResolvedValue({
      test: { status: "unavailable", code: "CONNECTOR_ADAPTER_NOT_CONFIGURED" },
      source: { id: sourceId, connectionState: "unavailable" },
      duplicate: false,
    });

    const response = await POST(jsonRequest({
      ...scope,
      action: "test_source",
      sourceId,
      idempotencyKey,
      ...approval,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { test: { status: "unavailable", code: "CONNECTOR_ADAPTER_NOT_CONFIGURED" } },
    });
    expect(mocks.recordProductCatalogManagementApprovalEvidence).toHaveBeenCalledWith(scope, {
      action: "test_source",
      targetType: "product_source",
      targetId: sourceId,
      idempotencyKey,
      ...approval,
    });
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(2);
    expect(mocks.testProductSourceConnection).toHaveBeenCalledWith(scope, { sourceId, idempotencyKey });
  });

  it("creates a source only from closed public config and a redacted secret reference after approval", async () => {
    const idempotencyKey = "55555555-5555-4555-8555-555555555555";
    const approval = {
      approvalRequestId: "product_source_1234",
      approvalItemId: "call_source_1234",
      turnId: "turn_source_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    };
    mocks.createProductSource.mockResolvedValue({
      source: { id: productId, connectionState: "untested", adapterAvailability: "ready" },
      duplicate: false,
    });

    const response = await POST(jsonRequest({
      ...scope,
      action: "create_source_draft",
      name: "只读产品库",
      connectorKey: "postgres_readonly",
      connectorVersion: "1.0.0",
      publicConfig: { schema: "public", table: "products" },
      secretReference: "broker:psh_12345678901234567890123456789012",
      idempotencyKey,
      ...approval,
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordProductCatalogManagementApprovalEvidence).toHaveBeenCalledWith(scope, {
      action: "create_source_draft",
      targetType: "product_source_request",
      targetId: idempotencyKey,
      idempotencyKey,
      connectorKey: "postgres_readonly",
      connectorVersion: "1.0.0",
      ...approval,
    });
    expect(mocks.createProductSource).toHaveBeenCalledWith(scope, {
      name: "只读产品库",
      connectorKey: "postgres_readonly",
      connectorVersion: "1.0.0",
      publicConfig: { schema: "public", table: "products" },
      secretReference: "broker:psh_12345678901234567890123456789012",
      idempotencyKey,
    });
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(2);
  });

  it("records approval, reauthorizes, and forwards UUID idempotency for a mapping proposal", async () => {
    const importId = "44444444-4444-4444-8444-444444444444";
    const idempotencyKey = "55555555-5555-4555-8555-555555555555";
    const proposal = {
      fields: [{
        sourcePath: "/spu",
        targetField: "product.key",
        transform: "trim",
        required: true,
        confidence: 1,
        evidence: "SPU field",
        transformOptions: {},
      }],
    };
    const approval = {
      approvalRequestId: "product_mapping_1234",
      approvalItemId: "call_mapping_1234",
      turnId: "turn_mapping_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    };
    mocks.proposeProductMapping.mockResolvedValue({ mappingRevisionId: productId, validation: { valid: true } });

    const response = await POST(jsonRequest({
      ...scope,
      action: "propose_mapping",
      importId,
      proposal,
      idempotencyKey,
      ...approval,
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordProductCatalogManagementApprovalEvidence).toHaveBeenCalledWith(scope, {
      action: "propose_mapping",
      targetType: "product_import",
      targetId: importId,
      idempotencyKey,
      ...approval,
    });
    expect(mocks.proposeProductMapping).toHaveBeenCalledWith(scope, {
      importId,
      idempotencyKey,
      proposal,
      proposalSource: "harness",
      rootThreadId: scope.rootThreadId,
      turnId: approval.turnId,
      toolCallId: approval.approvalItemId,
    });
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(2);
  });

  it("records approval and UUID idempotency before persisting validation state", async () => {
    const importId = "44444444-4444-4444-8444-444444444444";
    const mappingRevisionId = "55555555-5555-4555-8555-555555555555";
    const idempotencyKey = "66666666-6666-4666-8666-666666666666";
    const approval = {
      approvalRequestId: "product_validate_1234",
      approvalItemId: "call_validate_1234",
      turnId: "turn_validate_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    };
    mocks.validateProductMapping.mockResolvedValue({ valid: true, mappingRevisionId });

    const response = await POST(jsonRequest({
      ...scope,
      action: "validate_mapping",
      importId,
      mappingRevisionId,
      idempotencyKey,
      ...approval,
    }));

    expect(response.status).toBe(200);
    expect(mocks.recordProductCatalogManagementApprovalEvidence).toHaveBeenCalledWith(scope, {
      action: "validate_mapping",
      targetType: "product_mapping",
      targetId: mappingRevisionId,
      idempotencyKey,
      ...approval,
    });
    expect(mocks.validateProductMapping).toHaveBeenCalledWith(scope, {
      importId,
      mappingRevisionId,
      idempotencyKey,
      rootThreadId: scope.rootThreadId,
      turnId: approval.turnId,
      toolCallId: approval.approvalItemId,
    });
    expect(mocks.authorizeProductCatalogAction).toHaveBeenCalledTimes(2);
  });

  it("fails closed before repository access when the live role denies an action", async () => {
    mocks.authorizeProductCatalogAction.mockResolvedValue(false);
    const response = await POST(jsonRequest({ ...scope, action: "get", productId }));
    expect(response.status).toBe(403);
    expect(mocks.getProduct).not.toHaveBeenCalled();
  });

  it("rejects unknown fields in the closed action contract", async () => {
    const response = await POST(jsonRequest({ ...scope, action: "get", productId, tenantOverride: "forbidden" }));
    expect(response.status).toBe(400);
    expect(mocks.authorizeProductCatalogAction).not.toHaveBeenCalled();
  });

  it("rejects raw connection strings at the private control boundary", async () => {
    const response = await POST(jsonRequest({
      ...scope,
      action: "create_source_draft",
      name: "危险数据源",
      connectorKey: "postgres_readonly",
      connectorVersion: "1.0.0",
      publicConfig: { schema: "public", table: "products" },
      secretReference: "postgres://user:password@example.com/products",
      idempotencyKey: "55555555-5555-4555-8555-555555555555",
      approvalRequestId: "product_source_1234",
      approvalItemId: "call_source_1234",
      turnId: "turn_source_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    }));
    expect(response.status).toBe(400);
    expect(mocks.authorizeProductCatalogAction).not.toHaveBeenCalled();
    expect(mocks.createProductSource).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/internal/product-catalog", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Commerce-Gateway-Token": "test" },
    body: JSON.stringify(body),
  });
}
