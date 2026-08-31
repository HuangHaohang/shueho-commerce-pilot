import assert from "node:assert/strict";
import test from "node:test";

import {
  ProductCatalogControlClient,
  ProductCatalogControlError,
  parseFirstPartyResearchSubject,
  type ProductCatalogPrincipal,
} from "./product-catalog-control-client.js";

const principal: ProductCatalogPrincipal = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  userId: "user-1",
  rootThreadId: "thread-product-1",
};

test("posts a closed product action with the bound principal", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ result: { products: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const client = new ProductCatalogControlClient({
      controlUrl: "http://127.0.0.1:3000/api/internal/product-catalog",
      internalToken: "test-internal-token",
    });
    const result = await client.resolveContext(principal, ["33333333-3333-4333-8333-333333333333"]);
    assert.deepEqual(result, { products: [] });
    assert.deepEqual(capturedBody, {
      ...principal,
      action: "resolve_context",
      productIds: ["33333333-3333-4333-8333-333333333333"],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolves a research subject by a server-owned context UUID without product payloads", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ result: { first_party_subject: { version: 1 } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const client = new ProductCatalogControlClient({
      controlUrl: "http://127.0.0.1:3000/api/internal/product-catalog",
      internalToken: "test-internal-token",
    });
    const contextSetId = "44444444-4444-4444-8444-444444444444";
    await client.resolveResearchSubject(principal, contextSetId);
    assert.deepEqual(capturedBody, {
      ...principal,
      action: "resolve_research_subject",
      contextSetId,
    });
    assert.doesNotMatch(JSON.stringify(capturedBody), /productIds|description|attributes|sku/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validates exact research-subject identity and ordered product revisions", () => {
  const subjectRef = "44444444-4444-4444-8444-444444444444";
  const productId = "33333333-3333-4333-8333-333333333333";
  const revisionId = "55555555-5555-4555-8555-555555555555";
  const parsed = parseFirstPartyResearchSubject({
    first_party_subject: {
      version: 1,
      subject_ref: subjectRef,
      snapshot_sha256: "a".repeat(64),
      product_count: 1,
      products: [{ product_id: productId, product_revision_id: revisionId }],
    },
  }, subjectRef, [productId]);
  assert.equal(parsed.products[0]?.product_revision_id, revisionId);
  assert.throws(
    () => parseFirstPartyResearchSubject({ first_party_subject: parsed }, subjectRef, [
      "66666666-6666-4666-8666-666666666666",
    ]),
    (error: unknown) => error instanceof ProductCatalogControlError &&
      error.code === "PRODUCT_RESEARCH_SUBJECT_INVALID",
  );
});

test("uploads a tenant-bound product artifact through the dedicated multipart control route", async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedForm: FormData | null = null;
  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedForm = init?.body instanceof FormData ? init.body : null;
    return new Response(JSON.stringify({ result: { import: { id: "import-1" }, duplicate: false } }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const client = new ProductCatalogControlClient({
      controlUrl: "http://127.0.0.1:3000/api/internal/product-catalog",
      internalToken: "test-internal-token",
    });
    const result = await client.createImportFromArtifact(principal, {
      artifactId: "33333333-3333-4333-8333-333333333333",
      artifactChecksumSha256: "a".repeat(64),
      fileName: "products.csv",
      contentType: "text/csv",
      bytes: Buffer.from("spu,title,sku\nP-1,通勤包,SKU-1\n"),
      sourceName: "ERP 导出",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      approvalRequestId: "product_approval_1234",
      approvalItemId: "call_product_1234",
      turnId: "turn_product_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    });
    assert.deepEqual(result, { import: { id: "import-1" }, duplicate: false });
    assert.equal(capturedUrl, "http://127.0.0.1:3000/api/internal/product-catalog/import-artifact");
    const form = capturedForm as unknown as FormData;
    assert.ok(form instanceof FormData);
    const metadata = JSON.parse(String(form.get("metadata"))) as Record<string, unknown>;
    assert.deepEqual(metadata, {
      ...principal,
      action: "create_import_from_artifact",
      artifactId: "33333333-3333-4333-8333-333333333333",
      artifactChecksumSha256: "a".repeat(64),
      sourceName: "ERP 导出",
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      approvalRequestId: "product_approval_1234",
      approvalItemId: "call_product_1234",
      turnId: "turn_product_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    });
    assert.doesNotMatch(JSON.stringify(metadata), /SKU-1|通勤包/);
    const file = form.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "products.csv");
    assert.equal(file.type, "text/csv");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards approved mapping writes with UUID idempotency and original tool lineage", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ result: { valid: true } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const client = new ProductCatalogControlClient({
      controlUrl: "http://127.0.0.1:3000/api/internal/product-catalog",
      internalToken: "test-internal-token",
    });
    const evidence = {
      idempotencyKey: "44444444-4444-4444-8444-444444444444",
      approvalRequestId: "product_mapping_1234",
      approvalItemId: "call_mapping_1234",
      turnId: "turn_mapping_1234",
      approvedAt: "2026-08-30T10:00:00.000Z",
    };
    await client.validateMapping(principal, {
      importId: "55555555-5555-4555-8555-555555555555",
      mappingRevisionId: "66666666-6666-4666-8666-666666666666",
      ...evidence,
    });
    assert.deepEqual(bodies[0], {
      ...principal,
      action: "validate_mapping",
      importId: "55555555-5555-4555-8555-555555555555",
      mappingRevisionId: "66666666-6666-4666-8666-666666666666",
      ...evidence,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fails closed when the product control service rejects authorization", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: "Forbidden", code: "PRODUCT_CATALOG_FORBIDDEN" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
  try {
    const client = new ProductCatalogControlClient({
      controlUrl: "http://127.0.0.1:3000/api/internal/product-catalog",
      internalToken: "test-internal-token",
    });
    await assert.rejects(
      () => client.search(principal, { query: "通勤包", limit: 10 }),
      (error: unknown) => error instanceof ProductCatalogControlError &&
        error.status === 403 &&
        error.code === "PRODUCT_CATALOG_FORBIDDEN",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects oversized control responses", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ result: { value: "x".repeat(128) } }), {
    status: 200,
  });
  try {
    const client = new ProductCatalogControlClient({
      controlUrl: "http://127.0.0.1:3000/api/internal/product-catalog",
      internalToken: "test-internal-token",
      maximumResultBytes: 64,
    });
    await assert.rejects(
      () => client.get(principal, "33333333-3333-4333-8333-333333333333"),
      (error: unknown) => error instanceof ProductCatalogControlError &&
        error.code === "PRODUCT_CATALOG_RESULT_TOO_LARGE",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
