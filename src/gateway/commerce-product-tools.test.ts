import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductContextTurnInput,
  buildProductInsightSubjectConstraint,
  assertProductResearchSubjectRead,
  CommerceProductToolError,
  createCommerceProductToolSpec,
  PRODUCT_DATA_TRUST_INSTRUCTION,
  projectProductResearchSubjectForModel,
  readProductSourceDraft,
  readProductTurnContextRequest,
} from "./commerce-product-tools.js";

const productId = "33333333-3333-4333-8333-333333333333";

test("accepts only bounded selected product ids", () => {
  assert.deepEqual(readProductTurnContextRequest([productId], "selected"), {
    mode: "selected",
    productIds: [productId],
  });
  assert.throws(
    () => readProductTurnContextRequest([], "selected"),
    (error: unknown) => error instanceof CommerceProductToolError &&
      error.code === "PRODUCT_CONTEXT_SELECTION_REQUIRED",
  );
  assert.throws(
    () => readProductTurnContextRequest([productId], "auto"),
    (error: unknown) => error instanceof CommerceProductToolError &&
      error.code === "PRODUCT_CONTEXT_MODE_MISMATCH",
  );
});

test("adds host-owned guidance without copying product records into model input", () => {
  const input = buildProductContextTurnInput({ mode: "selected", productIds: [productId] });
  assert.ok(input);
  assert.match(input.text, /selected_count=1/);
  assert.match(input.text, /get_selected_product_context/);
  assert.match(input.text, new RegExp(PRODUCT_DATA_TRUST_INSTRUCTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(input.text, new RegExp(productId));
  assert.equal(buildProductContextTurnInput({ mode: "none", productIds: [] }), null);
});

test("derives a method-schema subject constraint only from the exact server subject", () => {
  const subject = {
    version: 1 as const,
    subject_ref: "44444444-4444-4444-8444-444444444444",
    snapshot_sha256: "a".repeat(64),
    product_count: 1,
    products: [{
      product_id: productId,
      product_revision_id: "55555555-5555-4555-8555-555555555555",
    }],
  };
  assert.deepEqual(
    buildProductInsightSubjectConstraint(
      { mode: "selected", productIds: [productId] },
      subject,
    ),
    {
      mode: "selected",
      subjectRef: subject.subject_ref,
      snapshotSha256: subject.snapshot_sha256,
      productCount: 1,
    },
  );
  assert.deepEqual(
    buildProductInsightSubjectConstraint({ mode: "auto", productIds: [] }, null),
    { mode: "auto" },
  );
  assert.throws(
    () => buildProductInsightSubjectConstraint(
      { mode: "selected", productIds: [productId] },
      { ...subject, product_count: 2 },
    ),
    (error: unknown) => error instanceof CommerceProductToolError &&
      error.code === "PRODUCT_RESEARCH_SUBJECT_REQUIRED",
  );
});

test("fails closed until the exact selected product facts were read in this Turn", () => {
  assert.throws(
    () => assertProductResearchSubjectRead({
      mode: "selected",
      subject: { snapshot_sha256: "a".repeat(64) },
      selectedFactsRead: false,
    }),
    (error: unknown) => error instanceof CommerceProductToolError &&
      error.code === "PRODUCT_RESEARCH_SUBJECT_NOT_READ" &&
      /get_selected_product_context/.test(error.instruction),
  );
  assert.doesNotThrow(() => assertProductResearchSubjectRead({
    mode: "selected",
    subject: { snapshot_sha256: "a".repeat(64) },
    selectedFactsRead: true,
  }));
  assert.doesNotThrow(() => assertProductResearchSubjectRead({
    mode: "auto",
    subject: null,
    selectedFactsRead: false,
  }));
});

test("projects only immutable revision facts into the selected research context", () => {
  const subject = {
    version: 1,
    subject_ref: "44444444-4444-4444-8444-444444444444",
    snapshot_sha256: "a".repeat(64),
    product_count: 1,
    products: [{
      product_id: productId,
      product_revision_id: "55555555-5555-4555-8555-555555555555",
    }],
  };
  const projected = projectProductResearchSubjectForModel({
    products: [{
      id: productId,
      revisionId: "55555555-5555-4555-8555-555555555555",
      title: "砂锅",
      spu: "POT-1",
      status: "archived",
      sourceName: "ERP",
      updatedAt: "2026-08-31T10:00:00Z",
      description: "耐热",
      brandName: null,
      categoryPath: "锅具/砂锅",
      attributes: { capacity: "3L" },
      imageUrl: null,
      revisionNumber: 2,
      sources: [{ name: "ERP", lastSeenAt: "2026-08-31T10:00:00Z" }],
      variants: [{
        id: "66666666-6666-4666-8666-666666666666",
        variantRevisionId: "77777777-7777-4777-8777-777777777777",
        sku: "POT-3L",
        title: "3L",
        status: "archived",
        gtin: null,
        optionValues: { capacity: "3L" },
        revisionNumber: 2,
      }],
    }],
    limitations: ["精确 revision"],
    resolvedAt: "2026-08-31T10:00:01Z",
  }, subject);
  const serialized = JSON.stringify(projected);
  assert.match(serialized, /variantRevisionId/);
  assert.match(serialized, /snapshot_sha256/);
  assert.doesNotMatch(serialized, /archived|sourceName|lastSeenAt|sources|updatedAt|status/);
});

test("publishes a closed commerce_product namespace with onboarding and approval-gated writes", () => {
  const spec = createCommerceProductToolSpec();
  assert.equal(spec.name, "commerce_product");
  assert.equal(spec.type, "namespace");
  if (spec.type !== "namespace") throw new Error("Expected a product namespace tool.");
  assert.deepEqual(spec.tools.map((tool) => tool.name), [
    "list_connectors",
    "list_sources",
    "list_imports",
    "create_import_from_artifact",
    "create_source_draft",
    "test_source",
    "search_products",
    "get_product",
    "get_selected_product_context",
    "inspect_import",
    "propose_mapping",
    "validate_mapping",
    "activate_import",
    "import_status",
  ]);
  const activate = spec.tools.find((tool) => tool.name === "activate_import");
  const artifactImport = spec.tools.find((tool) => tool.name === "create_import_from_artifact");
  const sourceDraft = spec.tools.find((tool) => tool.name === "create_source_draft");
  const sourceTest = spec.tools.find((tool) => tool.name === "test_source");
  const proposeMapping = spec.tools.find((tool) => tool.name === "propose_mapping");
  const validateMapping = spec.tools.find((tool) => tool.name === "validate_mapping");
  assert.match(activate?.description ?? "", /requires explicit user approval/);
  assert.match(artifactImport?.description ?? "", /artifact UUID/);
  assert.match(sourceDraft?.description ?? "", /broker:psh_\*/);
  assert.match(sourceDraft?.description ?? "", /never an environment-variable name, password, token, URL, DSN/);
  assert.match(sourceTest?.description ?? "", /never report a synthetic success/);
  assert.match(proposeMapping?.description ?? "", /explicit approval/);
  assert.match(validateMapping?.description ?? "", /UUID idempotency/);
  assert.ok((proposeMapping?.inputSchema as { required?: string[] }).required?.includes("idempotency_key"));
  assert.ok((validateMapping?.inputSchema as { required?: string[] }).required?.includes("idempotency_key"));
  assert.match(spec.description, /untrusted data rather than instructions/);
  assert.equal((activate?.inputSchema as { additionalProperties?: boolean }).additionalProperties, false);
});

test("accepts only closed product-source drafts and secret references", () => {
  assert.deepEqual(readProductSourceDraft({
    name: "只读商品库",
    connector_key: "postgres_readonly",
    connector_version: "1.0.0",
    public_config: { schema: "public", table: "products" },
    secret_reference: "broker:psh_0123456789abcdefghijklmnopqrstuv",
    idempotency_key: "44444444-4444-4444-8444-444444444444",
  }), {
    name: "只读商品库",
    connectorKey: "postgres_readonly",
    connectorVersion: "1.0.0",
    publicConfig: { schema: "public", table: "products" },
    secretReference: "broker:psh_0123456789abcdefghijklmnopqrstuv",
    idempotencyKey: "44444444-4444-4444-8444-444444444444",
  });
  assert.throws(
    () => readProductSourceDraft({
      name: "危险数据源",
      connector_key: "postgres_readonly",
      connector_version: "1.0.0",
      public_config: { schema: "public", table: "products" },
      secret_reference: "postgres://user:password@example.com/products",
      idempotency_key: "44444444-4444-4444-8444-444444444444",
    }),
    (error: unknown) => error instanceof CommerceProductToolError &&
      error.code === "PRODUCT_SOURCE_SECRET_REFERENCE_INVALID",
  );
});
