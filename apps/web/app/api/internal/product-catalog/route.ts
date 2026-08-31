import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import {
  runtimeTenantAllows,
  RuntimeTenantConfigurationError,
} from "@/lib/enterprise/runtime-tenant";
import {
  authorizeProductCatalogAction,
  recordProductCatalogApprovalEvidence,
  recordProductCatalogManagementApprovalEvidence,
  type ProductCatalogPermission,
} from "@/lib/product-catalog/authorization";
import {
  createProductSource,
  listProductConnectors,
  listProductSources,
  testProductSourceConnection,
} from "@/lib/product-catalog/connector-repository";
import {
  activateProductImport,
  getProduct,
  getProductImport,
  inspectProductImport,
  listProductImports,
  listProducts,
  proposeProductMapping,
  resolveProductResearchSubject,
  resolveProductsByIds,
  validateProductMapping,
} from "@/lib/product-catalog/repository";
import {
  PRODUCT_CONTEXT_MAX_ITEMS,
  PRODUCT_MAPPING_TARGET_FIELDS,
  PRODUCT_MAPPING_TRANSFORMS,
  ProductCatalogError,
} from "@/lib/product-catalog/types";

const MAX_CONTROL_BODY_BYTES = 256 * 1024;

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(255),
  rootThreadId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
});

const mappingFieldSchema = z.object({
  sourcePath: z.string().trim().min(1).max(500),
  targetField: z.enum(PRODUCT_MAPPING_TARGET_FIELDS),
  transform: z.enum(PRODUCT_MAPPING_TRANSFORMS),
  required: z.boolean(),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.string().max(1_000).nullable(),
  transformOptions: z.record(z.unknown()).refine((value) => Object.keys(value).length <= 20),
}).strict();

const mappingProposalSchema = z.object({
  fields: z.array(mappingFieldSchema).min(1).max(200),
}).strict();

const approvalEvidenceSchema = {
  approvalRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  approvalItemId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  turnId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  approvedAt: z.string().datetime(),
};

const searchSchema = scopeSchema.extend({
  action: z.literal("search"),
  query: z.string().trim().min(1).max(500).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().min(1).max(500).nullable().optional(),
}).strict();
const getSchema = scopeSchema.extend({ action: z.literal("get"), productId: z.string().uuid() }).strict();
const resolveContextSchema = scopeSchema.extend({
  action: z.literal("resolve_context"),
  productIds: z.array(z.string().uuid()).min(1).max(PRODUCT_CONTEXT_MAX_ITEMS)
    .refine((values) => new Set(values).size === values.length),
}).strict();
const resolveResearchSubjectSchema = scopeSchema.extend({
  action: z.literal("resolve_research_subject"),
  contextSetId: z.string().uuid(),
}).strict();
const inspectImportSchema = scopeSchema.extend({ action: z.literal("inspect_import"), importId: z.string().uuid() }).strict();
const proposeMappingSchema = scopeSchema.extend({
  action: z.literal("propose_mapping"),
  importId: z.string().uuid(),
  proposal: mappingProposalSchema,
  idempotencyKey: z.string().uuid(),
  ...approvalEvidenceSchema,
}).strict();
const validateMappingSchema = scopeSchema.extend({
  action: z.literal("validate_mapping"),
  importId: z.string().uuid(),
  mappingRevisionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  ...approvalEvidenceSchema,
}).strict();
const activateImportSchema = scopeSchema.extend({
  action: z.literal("activate_import"),
  importId: z.string().uuid(),
  mappingRevisionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  approvalRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  approvalItemId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  turnId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  approvedAt: z.string().datetime(),
}).strict();
const importStatusSchema = scopeSchema.extend({ action: z.literal("import_status"), importId: z.string().uuid() }).strict();

const listConnectorsSchema = scopeSchema.extend({ action: z.literal("list_connectors") }).strict();
const listSourcesSchema = scopeSchema.extend({ action: z.literal("list_sources") }).strict();
const listImportsSchema = scopeSchema.extend({
  action: z.literal("list_imports"),
  limit: z.number().int().min(1).max(50).optional(),
}).strict();
const createSourceDraftSchema = scopeSchema.extend({
  action: z.literal("create_source_draft"),
  name: z.string().trim().min(1).max(160),
  connectorKey: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,79}$/),
  connectorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  publicConfig: z.record(z.unknown()).refine((value) => Object.keys(value).length <= 20),
  secretReference: z.union([
    z.string().regex(/^broker:psh_[A-Za-z0-9_-]{32,64}$/),
    z.null(),
  ]),
  idempotencyKey: z.string().uuid(),
  ...approvalEvidenceSchema,
}).strict();
const testSourceSchema = scopeSchema.extend({
  action: z.literal("test_source"),
  sourceId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  ...approvalEvidenceSchema,
}).strict();

const bodySchema = z.discriminatedUnion("action", [
  listConnectorsSchema,
  listSourcesSchema,
  listImportsSchema,
  searchSchema,
  getSchema,
  resolveContextSchema,
  resolveResearchSubjectSchema,
  inspectImportSchema,
  proposeMappingSchema,
  validateMappingSchema,
  activateImportSchema,
  importStatusSchema,
  createSourceDraftSchema,
  testSourceSchema,
]);

type ProductCatalogAction = z.infer<typeof bodySchema>["action"];

const actionPermissions: Record<ProductCatalogAction, ProductCatalogPermission> = {
  list_connectors: "product_catalog.read",
  list_sources: "product_catalog.read",
  list_imports: "product_catalog.read",
  search: "product_catalog.read",
  get: "product_catalog.read",
  resolve_context: "product_catalog.read",
  resolve_research_subject: "product_catalog.read",
  inspect_import: "product_catalog.review",
  propose_mapping: "product_catalog.review",
  validate_mapping: "product_catalog.review",
  activate_import: "product_catalog.import",
  import_status: "product_catalog.read",
  create_source_draft: "product_catalog.sources.manage",
  test_source: "product_catalog.sources.manage",
};

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized product-catalog callback." }, { status: 401 });
  }
  const rawBody = await request.text().catch(() => "");
  if (Buffer.byteLength(rawBody, "utf8") > MAX_CONTROL_BODY_BYTES) {
    return NextResponse.json(
      { error: "Product-catalog control request is too large.", code: "PRODUCT_CATALOG_REQUEST_TOO_LARGE" },
      { status: 413 },
    );
  }
  const parsed = bodySchema.safeParse(parseJson(rawBody));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid product-catalog request.", code: "PRODUCT_CATALOG_INVALID_REQUEST" },
      { status: 400 },
    );
  }
  const input = parsed.data;
  try {
    if (!runtimeTenantAllows(input.tenantId)) {
      return NextResponse.json(
        { error: "Product-catalog tenant is not assigned to this Web runtime.", code: "PRODUCT_CATALOG_TENANT_MISMATCH" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (error) {
    if (error instanceof RuntimeTenantConfigurationError) {
      return NextResponse.json(
        { error: "Product-catalog runtime tenant is not configured.", code: "PRODUCT_CATALOG_TENANT_UNCONFIGURED" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
  const scope = {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    rootThreadId: input.rootThreadId,
  };
  try {
    if (!(await authorizeProductCatalogAction(scope, actionPermissions[input.action]))) {
      return NextResponse.json(
        { error: "Product-catalog action is not authorized.", code: "PRODUCT_CATALOG_FORBIDDEN" },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    }
    let result: unknown;
    switch (input.action) {
      case "list_connectors":
        result = { connectors: await listProductConnectors(scope) };
        break;
      case "list_sources":
        result = { sources: await listProductSources(scope) };
        break;
      case "list_imports":
        result = await listProductImports(scope, { limit: input.limit });
        break;
      case "search":
        result = await listProducts(scope, { query: input.query, limit: input.limit, cursor: input.cursor });
        break;
      case "get":
        result = await getProduct(scope, input.productId);
        if (!result) throw new ProductCatalogError("产品不存在。", "PRODUCT_NOT_FOUND", 404);
        break;
      case "resolve_context":
        result = await resolveProductsByIds(scope, { productIds: input.productIds });
        break;
      case "resolve_research_subject":
        result = await resolveProductResearchSubject(scope, {
          contextSetId: input.contextSetId,
          threadId: input.rootThreadId,
        });
        break;
      case "inspect_import":
        result = await inspectProductImport(scope, input.importId);
        break;
      case "propose_mapping":
        await recordProductCatalogManagementApprovalEvidence(scope, {
          action: "propose_mapping",
          targetType: "product_import",
          targetId: input.importId,
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
        });
        if (!(await authorizeProductCatalogAction(scope, "product_catalog.review"))) {
          throw new ProductCatalogError("产品映射复核权限在写入前已失效。", "PRODUCT_CATALOG_FORBIDDEN", 403);
        }
        result = await proposeProductMapping(scope, {
          importId: input.importId,
          idempotencyKey: input.idempotencyKey,
          proposal: input.proposal,
          proposalSource: "harness",
          rootThreadId: input.rootThreadId,
          turnId: input.turnId,
          toolCallId: input.approvalItemId,
        });
        break;
      case "validate_mapping":
        await recordProductCatalogManagementApprovalEvidence(scope, {
          action: "validate_mapping",
          targetType: "product_mapping",
          targetId: input.mappingRevisionId,
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
        });
        if (!(await authorizeProductCatalogAction(scope, "product_catalog.review"))) {
          throw new ProductCatalogError("产品映射复核权限在校验前已失效。", "PRODUCT_CATALOG_FORBIDDEN", 403);
        }
        result = await validateProductMapping(scope, {
          importId: input.importId,
          mappingRevisionId: input.mappingRevisionId,
          idempotencyKey: input.idempotencyKey,
          rootThreadId: input.rootThreadId,
          turnId: input.turnId,
          toolCallId: input.approvalItemId,
        });
        break;
      case "activate_import":
        if (!(await authorizeProductCatalogAction(scope, "product_catalog.review"))) {
          throw new ProductCatalogError(
            "产品发布需要复核权限。",
            "PRODUCT_CATALOG_REVIEW_REQUIRED",
            403,
          );
        }
        await recordProductCatalogApprovalEvidence(scope, {
          importId: input.importId,
          mappingRevisionId: input.mappingRevisionId,
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
        });
        if (
          !(await authorizeProductCatalogAction(scope, "product_catalog.import")) ||
          !(await authorizeProductCatalogAction(scope, "product_catalog.review"))
        ) {
          throw new ProductCatalogError(
            "产品导入或复核权限在写入前已失效。",
            "PRODUCT_CATALOG_FORBIDDEN",
            403,
          );
        }
        result = await activateProductImport(scope, {
          importId: input.importId,
          mappingRevisionId: input.mappingRevisionId,
          idempotencyKey: input.idempotencyKey,
        });
        break;
      case "import_status":
        result = await getProductImport(scope, input.importId);
        if (!result) throw new ProductCatalogError("产品导入不存在。", "PRODUCT_IMPORT_NOT_FOUND", 404);
        break;
      case "create_source_draft":
        await recordProductCatalogManagementApprovalEvidence(scope, {
          action: "create_source_draft",
          targetType: "product_source_request",
          targetId: input.idempotencyKey,
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
          connectorKey: input.connectorKey,
          connectorVersion: input.connectorVersion,
        });
        if (!(await authorizeProductCatalogAction(scope, "product_catalog.sources.manage"))) {
          throw new ProductCatalogError("产品数据源管理权限在写入前已失效。", "PRODUCT_CATALOG_FORBIDDEN", 403);
        }
        result = await createProductSource(scope, {
          name: input.name,
          connectorKey: input.connectorKey,
          connectorVersion: input.connectorVersion,
          publicConfig: input.publicConfig,
          secretReference: input.secretReference,
          idempotencyKey: input.idempotencyKey,
        });
        break;
      case "test_source":
        await recordProductCatalogManagementApprovalEvidence(scope, {
          action: "test_source",
          targetType: "product_source",
          targetId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
          approvalRequestId: input.approvalRequestId,
          approvalItemId: input.approvalItemId,
          turnId: input.turnId,
          approvedAt: input.approvedAt,
        });
        if (!(await authorizeProductCatalogAction(scope, "product_catalog.sources.manage"))) {
          throw new ProductCatalogError("产品数据源管理权限在连接测试前已失效。", "PRODUCT_CATALOG_FORBIDDEN", 403);
        }
        result = await testProductSourceConnection(scope, {
          sourceId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
        });
        break;
    }
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code, issues: error.issues },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "Product-catalog control request failed.", code: "PRODUCT_CATALOG_CONTROL_FAILED" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

function parseJson(value: string): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
