import type { PoolClient, QueryResultRow } from "pg";

import { withEnterpriseDatabaseContext } from "@/lib/enterprise/database-context";
import type { EnterpriseScope } from "@/lib/enterprise/types";
import { looksLikeSpreadsheetFormula, observedTypes, readSourcePath, sha256Json } from "@/lib/product-catalog/import-parser";
import {
  PRODUCT_CONTEXT_MAX_ITEMS,
  ProductCatalogError,
  type ActivateProductImportInput,
  type ParsedProductImport,
  type ProductCatalogStatus,
  type ProductContextResult,
  type ProductDetail,
  type ProductImportCreateResult,
  type ProductImportInspection,
  type ProductImportIssue,
  type ProductImportResult,
  type ProductListResult,
  type ProductMappingFieldProposal,
  type ProductMappingProposal,
  type ProductMappingValidation,
  type ProductProjectContextResult,
  type ProductResearchSubjectResult,
  type ProductSummary,
  type ProductVariantDetail,
  type ProposeProductMappingInput,
  type ValidateProductMappingInput,
} from "@/lib/product-catalog/types";
import {
  buildDeterministicProductMapping,
  normalizeProductRecord,
  parseProductMappingProposal,
  validateProductMappingAgainstSchema,
  type NormalizedProductRecord,
} from "@/lib/product-catalog/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 100;

type ProductSummaryRow = QueryResultRow & {
  id: string;
  title: string;
  internal_product_key: string;
  status: ProductSummary["status"];
  variant_count: string;
  source_name: string | null;
  updated_at: Date;
  primary_image_url: string | null;
};

type TurnProductSummaryRow = ProductSummaryRow & {
  turn_id: string;
  ordinal: number;
};

type ImportRow = QueryResultRow & {
  id: string;
  source_id: string;
  file_name: string;
  status: string;
  total_records: number;
  imported_products: number;
  imported_variants: number;
  issue_count: number;
  mapping_revision_id: string | null;
  source_schema_hash: string | null;
  content_sha256: string;
  raw_storage_bytes: string | number;
  retention_until: Date;
  raw_payload_purged_at: Date | null;
  activation_idempotency_key: string | null;
  root_thread_id: string | null;
  turn_id: string | null;
  tool_call_id: string | null;
  created_at: Date;
};

type SourceRecordRow = QueryResultRow & {
  id: string;
  ordinal: number;
  raw_payload: Record<string, unknown>;
};

type MappingRevisionRow = QueryResultRow & {
  id: string;
  source_id: string;
  import_run_id: string | null;
  source_schema_hash: string;
  status: string;
  mapping_document: unknown;
  proposal_idempotency_key: string | null;
  validation_idempotency_key: string | null;
};

type MappingFieldRow = QueryResultRow & {
  id: string;
  source_path: string;
  target_field: ProductMappingFieldProposal["targetField"];
  transform: ProductMappingFieldProposal["transform"];
  required: boolean;
  confidence: number | null;
  evidence: string | null;
  transform_options: Record<string, unknown>;
  review_state: "pending" | "accepted" | "rejected";
};

export async function listProducts(
  scope: EnterpriseScope,
  input: { query?: string | null; limit?: number | null; cursor?: string | null } = {},
): Promise<ProductListResult> {
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const query = normalizeSearch(input.query);
    const limit = normalizeLimit(input.limit);
    const cursor = decodeCursor(input.cursor);
    const values: unknown[] = [scope.tenantId, scope.workspaceId, query ? `%${escapeLike(query)}%` : null, limit + 1];
    const cursorSql = cursor
      ? `AND (product.updated_at, product.id) < ($5::timestamptz, $6::uuid)`
      : "";
    if (cursor) values.push(cursor.updatedAt, cursor.id);
    const result = await client.query<ProductSummaryRow>(
      `
        SELECT product.id, revision.title, product.internal_product_key, product.status,
               count(DISTINCT variant.id)::text AS variant_count,
               min(source.name) AS source_name, product.updated_at, revision.primary_image_url
        FROM commerce_product product
        JOIN commerce_product_revision revision
          ON revision.tenant_id = product.tenant_id
         AND revision.workspace_id = product.workspace_id
         AND revision.id = product.current_revision_id
        LEFT JOIN commerce_product_variant variant
          ON variant.tenant_id = product.tenant_id
         AND variant.workspace_id = product.workspace_id
         AND variant.product_id = product.id
         AND variant.status <> 'archived'
        LEFT JOIN commerce_product_source_link source_link
          ON source_link.tenant_id = product.tenant_id
         AND source_link.workspace_id = product.workspace_id
         AND source_link.product_id = product.id
         AND source_link.review_state = 'accepted'
        LEFT JOIN commerce_product_source source
          ON source.tenant_id = source_link.tenant_id
         AND source.workspace_id = source_link.workspace_id
         AND source.id = source_link.source_id
        WHERE product.tenant_id = $1 AND product.workspace_id = $2
          AND ($3::text IS NULL OR revision.title ILIKE $3 ESCAPE '\\'
               OR product.internal_product_key ILIKE $3 ESCAPE '\\'
               OR EXISTS (
                 SELECT 1 FROM commerce_product_variant search_variant
                 WHERE search_variant.tenant_id = product.tenant_id
                   AND search_variant.workspace_id = product.workspace_id
                   AND search_variant.product_id = product.id
                   AND search_variant.internal_sku ILIKE $3 ESCAPE '\\'
               ))
          ${cursorSql}
        GROUP BY product.id, revision.title, product.internal_product_key,
                 product.status, product.updated_at, revision.primary_image_url
        ORDER BY product.updated_at DESC, product.id DESC
        LIMIT $4
      `,
      values,
    );
    const countResult = await client.query<{ count: string }>(
      `
        SELECT count(*)::text AS count
        FROM commerce_product product
        JOIN commerce_product_revision revision
          ON revision.tenant_id = product.tenant_id
         AND revision.workspace_id = product.workspace_id
         AND revision.id = product.current_revision_id
        WHERE product.tenant_id = $1 AND product.workspace_id = $2
          AND ($3::text IS NULL OR revision.title ILIKE $3 ESCAPE '\\'
               OR product.internal_product_key ILIKE $3 ESCAPE '\\'
               OR EXISTS (
                 SELECT 1 FROM commerce_product_variant search_variant
                 WHERE search_variant.tenant_id = product.tenant_id
                   AND search_variant.workspace_id = product.workspace_id
                   AND search_variant.product_id = product.id
                   AND search_variant.internal_sku ILIKE $3 ESCAPE '\\'
               ))
      `,
      values.slice(0, 3),
    );
    const hasMore = result.rows.length > limit;
    const pageRows = result.rows.slice(0, limit);
    const last = pageRows.at(-1);
    return {
      products: pageRows.map(toProductSummary),
      total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
      nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.id) : null,
      catalogStatus: await readCatalogStatus(client, scope),
    };
  });
}

export async function getProduct(scope: EnterpriseScope, productId: string): Promise<ProductDetail | null> {
  assertUuid(productId, "产品标识");
  return withEnterpriseDatabaseContext(scope, (client) => getProductWithClient(client, scope, productId));
}

export async function resolveProductsByIds(
  scope: EnterpriseScope,
  input: { productIds: string[] },
): Promise<ProductContextResult> {
  const productIds = normalizeProductIds(input.productIds);
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const products: ProductDetail[] = [];
    for (const productId of productIds) {
      const product = await getProductWithClient(client, scope, productId);
      if (!product) {
        throw new ProductCatalogError("所选产品不存在或当前工作区无权访问。", "PRODUCT_NOT_FOUND", 404);
      }
      products.push(product);
    }
    return {
      products,
      resolvedAt: new Date().toISOString(),
      limitations: ["产品上下文来自当前工作区已激活的确定性主数据 revision；原始导入记录不会暴露给 Agent。"],
    };
  });
}

export async function resolveProductResearchSubject(
  scope: EnterpriseScope,
  input: { contextSetId: string; threadId: string },
): Promise<ProductResearchSubjectResult> {
  assertUuid(input.contextSetId, "产品研究主体标识");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId)) {
    throw new ProductCatalogError("会话标识无效。", "PRODUCT_CONTEXT_THREAD_INVALID", 400);
  }
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const contextResult = await client.query<{
      id: string;
      created_at: Date;
    }>(
      `SELECT id,created_at
       FROM commerce_agent_product_context_set
       WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3
         AND thread_id=$4 AND id=$5 AND context_mode='selected'
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.contextSetId],
    );
    const context = contextResult.rows[0];
    if (!context) {
      throw new ProductCatalogError(
        "所选产品研究主体不存在或不属于当前会话。",
        "PRODUCT_RESEARCH_SUBJECT_NOT_FOUND",
        404,
      );
    }
    const itemResult = await client.query<{
      product_id: string;
      product_revision_id: string;
    }>(
      `SELECT product_id,product_revision_id
       FROM commerce_agent_product_context_item
       WHERE tenant_id=$1 AND workspace_id=$2 AND context_set_id=$3
         AND variant_id IS NULL AND variant_revision_id IS NULL
       ORDER BY ordinal`,
      [scope.tenantId, scope.workspaceId, context.id],
    );
    if (!itemResult.rows.length || itemResult.rows.length > PRODUCT_CONTEXT_MAX_ITEMS) {
      throw new ProductCatalogError(
        "产品研究主体没有有效的产品 revision。",
        "PRODUCT_RESEARCH_SUBJECT_EMPTY",
        409,
      );
    }
    const products: ProductDetail[] = [];
    for (const item of itemResult.rows) {
      const product = await getProductRevisionWithClient(
        client,
        scope,
        item.product_id,
        item.product_revision_id,
        context.created_at,
      );
      if (!product) {
        throw new ProductCatalogError(
          "产品研究主体引用的 revision 不可用。",
          "PRODUCT_RESEARCH_SUBJECT_REVISION_NOT_FOUND",
          409,
        );
      }
      products.push(product);
    }
    const refs = itemResult.rows.map((item) => ({
      product_id: item.product_id,
      product_revision_id: item.product_revision_id,
    }));
    const snapshotSha256 = productResearchSnapshotSha256(context.id, products);
    return {
      products,
      resolvedAt: new Date().toISOString(),
      limitations: [
        "产品事实来自提交该 Harness Turn 前由服务器固定的 Product revision；原始导入记录和连接凭据不会暴露给 Agent。",
        "市场反馈属于外部样本，不能反向改写企业产品主数据。",
      ],
      first_party_subject: {
        version: 1,
        subject_ref: context.id,
        snapshot_sha256: snapshotSha256,
        product_count: refs.length,
        products: refs,
      },
    };
  });
}

export function productResearchSnapshotSha256(
  subjectRef: string,
  products: ProductDetail[],
): string {
  return sha256Json({
    version: 1,
    subject_ref: subjectRef,
    products: products.map(toImmutableResearchProductSnapshot),
  });
}

function toImmutableResearchProductSnapshot(product: ProductDetail): Record<string, unknown> {
  return {
    productId: product.id,
    productRevisionId: product.revisionId,
    title: product.title,
    spu: product.spu,
    description: product.description,
    brandName: product.brandName,
    categoryPath: product.categoryPath,
    attributes: product.attributes,
    imageUrl: product.imageUrl,
    revisionNumber: product.revisionNumber,
    variants: product.variants.map((variant) => ({
      variantId: variant.id,
      variantRevisionId: variant.variantRevisionId,
      sku: variant.sku,
      title: variant.title,
      gtin: variant.gtin,
      optionValues: variant.optionValues,
      revisionNumber: variant.revisionNumber,
    })),
  };
}

export async function createProductImport(
  scope: EnterpriseScope,
  input: {
    parsed: ParsedProductImport;
    sourceName?: string | null;
    idempotencyKey: string;
    mapping?: ProductMappingProposal | null;
    activateIfValid?: boolean;
  },
): Promise<ProductImportCreateResult> {
  assertUuid(input.idempotencyKey, "幂等键");
  const rawStorageBytes = estimateParsedImportStorage(input.parsed);
  const prepared = await withEnterpriseDatabaseContext(scope, async (client): Promise<{
    response: ProductImportCreateResult;
    activation: ActivateProductImportInput | null;
  }> => {
    const storage = await client.query<{
      allowed: boolean;
      reason_code: string;
      retention_until: Date;
      tenant_used_bytes: string;
      workspace_used_bytes: string;
      tenant_limit_bytes: string;
      workspace_limit_bytes: string;
    }>(
      `SELECT * FROM commerce_check_product_import_storage_budget($1,$2,$3::bigint)`,
      [scope.tenantId, scope.workspaceId, rawStorageBytes],
    );
    const storageDecision = storage.rows[0];
    if (!storageDecision) {
      throw new ProductCatalogError("无法读取产品导入存储预算。", "PRODUCT_IMPORT_STORAGE_UNAVAILABLE", 503);
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `product-import-create:${scope.tenantId}:${scope.workspaceId}:${input.idempotencyKey}`,
    ]);
    const duplicate = await client.query<ImportRow>(
      `SELECT id, source_id, file_name, status, total_records, imported_products,
              imported_variants, issue_count, mapping_revision_id, source_schema_hash,
              content_sha256,raw_storage_bytes,retention_until,raw_payload_purged_at,
              activation_idempotency_key, root_thread_id, turn_id, tool_call_id, created_at
       FROM commerce_product_import_run
       WHERE tenant_id=$1 AND workspace_id=$2 AND idempotency_key=$3`,
      [scope.tenantId, scope.workspaceId, input.idempotencyKey],
    );
    if (duplicate.rows[0]) {
      if (duplicate.rows[0].content_sha256 !== input.parsed.contentSha256) {
        throw new ProductCatalogError(
          "相同导入幂等键已用于不同文件。",
          "PRODUCT_IMPORT_IDEMPOTENCY_CONFLICT",
          409,
        );
      }
      return { response: {
        import: toImportResult(duplicate.rows[0]),
        issues: await readImportIssues(client, scope, duplicate.rows[0].id),
        duplicate: true,
      }, activation: null };
    }

    const contentReplay = await client.query<ImportRow>(
      `SELECT id, source_id, file_name, status, total_records, imported_products,
              imported_variants, issue_count, mapping_revision_id, source_schema_hash,
              content_sha256,raw_storage_bytes,retention_until,raw_payload_purged_at,
              activation_idempotency_key, root_thread_id, turn_id, tool_call_id, created_at
       FROM commerce_product_import_run
       WHERE tenant_id=$1 AND workspace_id=$2 AND content_sha256=$3
         AND raw_payload_purged_at IS NULL
       ORDER BY created_at DESC,id DESC LIMIT 1`,
      [scope.tenantId, scope.workspaceId, input.parsed.contentSha256],
    );
    if (contentReplay.rows[0]) {
      await client.query(
        `INSERT INTO commerce_enterprise_audit_event
          (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
         VALUES ($1,$2,$3,'product_catalog.import.content_reuse','product_import',$4,'succeeded',
                 jsonb_build_object('contentSha256',$5::text,'idempotencyKey',$6::uuid))`,
        [scope.tenantId, scope.workspaceId, scope.userId, contentReplay.rows[0].id,
          input.parsed.contentSha256, input.idempotencyKey],
      );
      return {
        response: {
          import: toImportResult(contentReplay.rows[0]),
          issues: await readImportIssues(client, scope, contentReplay.rows[0].id),
          duplicate: true,
        },
        activation: null,
      };
    }
    if (!storageDecision.allowed) {
      throw new ProductCatalogError(
        storageDecision.reason_code === "PRODUCT_IMPORT_TENANT_STORAGE_LIMIT"
          ? "企业产品导入存储额度已用完，请等待保留策略清理或联系管理员。"
          : "当前工作区产品导入存储额度已用完，请等待保留策略清理或联系管理员。",
        storageDecision.reason_code,
        429,
      );
    }

    const sourceName = normalizeSourceName(input.sourceName ?? input.parsed.fileName.replace(/\.(?:csv|json)$/i, ""));
    const sourceId = await findOrCreateFileSource(client, scope, sourceName);
    const inserted = await client.query<ImportRow>(
      `
        INSERT INTO commerce_product_import_run (
          tenant_id, workspace_id, source_id, idempotency_key, file_name,
          content_type, content_sha256, content_bytes, source_schema_hash,
          raw_storage_bytes,retention_until,content_dedupe_enforced,
          status, total_records, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,'profiled',$12,$13)
        RETURNING id, source_id, file_name, status, total_records, imported_products,
                  imported_variants, issue_count, mapping_revision_id, source_schema_hash,
                  content_sha256,raw_storage_bytes,retention_until,raw_payload_purged_at,
                  activation_idempotency_key, root_thread_id, turn_id, tool_call_id, created_at
      `,
      [scope.tenantId, scope.workspaceId, sourceId, input.idempotencyKey,
        input.parsed.fileName, input.parsed.contentType, input.parsed.contentSha256,
        input.parsed.contentBytes, input.parsed.schemaHash, rawStorageBytes,
        storageDecision.retention_until, input.parsed.records.length, scope.userId],
    );
    const importRow = inserted.rows[0];
    if (!importRow) throw new ProductCatalogError("无法创建产品导入批次。", "PRODUCT_IMPORT_CREATE_FAILED", 500);

    const recordIds: string[] = [];
    for (const [ordinal, rawPayload] of input.parsed.records.entries()) {
      const record = await client.query<{ id: string }>(
        `
          INSERT INTO commerce_product_source_record (
            tenant_id, workspace_id, import_run_id, ordinal, source_pointer,
            raw_payload, raw_sha256
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
          RETURNING id
        `,
        [scope.tenantId, scope.workspaceId, importRow.id, ordinal, `/records/${ordinal}`,
          JSON.stringify(rawPayload), sha256Json(rawPayload)],
      );
      const recordId = record.rows[0]?.id;
      if (!recordId) throw new ProductCatalogError("无法保存产品原始记录。", "PRODUCT_IMPORT_RAW_WRITE_FAILED", 500);
      recordIds.push(recordId);
    }
    await persistParserIssues(client, scope, importRow.id, recordIds, input.parsed.issues);
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,$3,'product_catalog.import.create','product_import',$4,'succeeded',$5::jsonb)`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        importRow.id,
        JSON.stringify({
          sourceId,
          totalRecords: input.parsed.records.length,
          contentSha256: input.parsed.contentSha256,
          schemaHash: input.parsed.schemaHash,
          activationRequested: input.activateIfValid === true,
        }),
      ],
    );

    const proposal = input.mapping
      ? parseProductMappingProposal(input.mapping)
      : buildDeterministicProductMapping(input.parsed.fields);
    if (!proposal) {
      await insertIssue(client, scope, {
        importId: importRow.id,
        severity: "error",
        code: "MAPPING_REQUIRED",
        message: "未能确定性识别产品编码与标题，需要 Harness 或人工提交字段映射。",
      });
      await refreshImportIssueCount(client, scope, importRow.id, "needs_review");
      const current = await requireImportRow(client, scope, importRow.id);
      return { response: {
        import: toImportResult(current),
        issues: await readImportIssues(client, scope, importRow.id),
        duplicate: false,
      }, activation: null };
    }

    const mapping = await insertMappingRevision(client, scope, {
      importId: importRow.id,
      sourceId,
      sourceSchemaHash: input.parsed.schemaHash,
      proposal,
      proposalSource: input.mapping ? "manual" : "deterministic",
      modelMetadata: {},
      rootThreadId: null,
      turnId: null,
      toolCallId: null,
      proposalIdempotencyKey: null,
    });
    const validation = await validateMappingWithClient(client, scope, importRow.id, mapping.id, true);
    if (!validation.valid || input.parsed.issues.some((issue) => issue.severity === "error")) {
      await refreshImportIssueCount(client, scope, importRow.id, "needs_review", mapping.id);
      const current = await requireImportRow(client, scope, importRow.id);
      return { response: {
        import: toImportResult(current),
        issues: [...await readImportIssues(client, scope, importRow.id), ...validation.issues].slice(0, 1000),
        duplicate: false,
      }, activation: null };
    }
    const current = await requireImportRow(client, scope, importRow.id);
    return {
      response: { import: toImportResult(current), issues: await readImportIssues(client, scope, importRow.id), duplicate: false },
      activation: { importId: importRow.id, mappingRevisionId: mapping.id, idempotencyKey: input.idempotencyKey },
    };
  });
  if (!prepared.activation || prepared.response.duplicate || input.activateIfValid !== true) {
    return prepared.response;
  }
  try {
    const activated = await activateProductImport(scope, prepared.activation);
    return { import: activated, issues: prepared.response.issues, duplicate: false };
  } catch (error) {
    if (!(error instanceof ProductCatalogError)) throw error;
    return withEnterpriseDatabaseContext(scope, async (client) => {
      await insertIssue(client, scope, {
        importId: prepared.activation?.importId ?? "",
        severity: "error",
        code: /^[A-Z][A-Z0-9_]{1,79}$/.test(error.code) ? error.code : "PRODUCT_IMPORT_ACTIVATION_FAILED",
        message: error.message,
      });
      await refreshImportIssueCount(client, scope, prepared.activation?.importId ?? "", "needs_review", prepared.activation?.mappingRevisionId);
      const current = await requireImportRow(client, scope, prepared.activation?.importId ?? "");
      return {
        import: toImportResult(current),
        issues: [...await readImportIssues(client, scope, current.id), ...error.issues].slice(0, 1000),
        duplicate: false,
      };
    });
  }
}

export async function listProductImports(
  scope: EnterpriseScope,
  input: { limit?: number | null } = {},
): Promise<{ imports: ProductImportResult[] }> {
  const limit = input.limit === null || input.limit === undefined
    ? 20
    : Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 50
      ? input.limit
      : null;
  if (limit === null) {
    throw new ProductCatalogError("产品导入列表数量无效。", "PRODUCT_IMPORT_LIMIT_INVALID", 400);
  }
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<ImportRow>(
      `SELECT id, source_id, file_name, status, total_records, imported_products,
              imported_variants, issue_count, mapping_revision_id, source_schema_hash,
              content_sha256,raw_storage_bytes,retention_until,raw_payload_purged_at,
              activation_idempotency_key, root_thread_id, turn_id, tool_call_id, created_at
       FROM commerce_product_import_run
       WHERE tenant_id=$1 AND workspace_id=$2
       ORDER BY created_at DESC,id DESC
       LIMIT $3`,
      [scope.tenantId, scope.workspaceId, limit],
    );
    return { imports: result.rows.map(toImportResult) };
  });
}

export async function getProductImport(scope: EnterpriseScope, importId: string): Promise<ProductImportResult | null> {
  assertUuid(importId, "导入标识");
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<ImportRow>(importSelectSql(), [scope.tenantId, scope.workspaceId, importId]);
    return result.rows[0] ? toImportResult(result.rows[0]) : null;
  });
}

export async function inspectProductImport(scope: EnterpriseScope, importId: string): Promise<ProductImportInspection> {
  assertUuid(importId, "导入标识");
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const importRow = await requireImportRow(client, scope, importId);
    const records = await readSourceRecords(client, scope, importId);
    const fields = collectRecordPaths(records.map((record) => record.raw_payload));
    return {
      import: toImportResult(importRow),
      schemaHash: importRow.source_schema_hash ?? sha256Json({ fields }),
      fields: fields.map((path) => {
        const values = records.map((record) => readSourcePath(record.raw_payload, path)).filter((value) => value !== undefined);
        return {
          path,
          observedTypes: observedTypes(records.map((record) => record.raw_payload), path),
          presentCount: values.length,
          sampleValues: values.slice(0, 3).map((value) => safeProfileSample(path, value)),
        };
      }),
      issues: await readImportIssues(client, scope, importId),
    };
  });
}

export async function proposeProductMapping(
  scope: EnterpriseScope,
  input: ProposeProductMappingInput,
): Promise<{ mappingRevisionId: string; validation: ProductMappingValidation }> {
  assertUuid(input.importId, "导入标识");
  assertUuid(input.idempotencyKey, "映射提案幂等键");
  const proposal = parseProductMappingProposal(input.proposal);
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `product-mapping-propose:${scope.tenantId}:${scope.workspaceId}:${input.idempotencyKey}`,
    ]);
    const existing = await client.query<MappingRevisionRow>(
      `SELECT id,source_id,import_run_id,source_schema_hash,status,mapping_document,
              proposal_idempotency_key,validation_idempotency_key
       FROM commerce_product_mapping_revision
       WHERE tenant_id=$1 AND workspace_id=$2 AND proposal_idempotency_key=$3`,
      [scope.tenantId, scope.workspaceId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      const prior = existing.rows[0];
      if (prior.import_run_id !== input.importId || sha256Json(prior.mapping_document) !== sha256Json(proposal)) {
        throw new ProductCatalogError(
          "映射提案幂等键已用于不同请求。",
          "PRODUCT_MAPPING_IDEMPOTENCY_CONFLICT",
          409,
        );
      }
      return {
        mappingRevisionId: prior.id,
        validation: await validateMappingWithClient(client, scope, input.importId, prior.id, false),
      };
    }
    const importRow = await requireImportRow(client, scope, input.importId);
    const records = await readSourceRecords(client, scope, input.importId);
    const fields = collectRecordPaths(records.map((record) => record.raw_payload));
    const schemaIssues = validateProductMappingAgainstSchema(proposal, new Set(fields));
    if (schemaIssues.length) {
      throw new ProductCatalogError("映射引用了不存在的源字段。", "PRODUCT_MAPPING_SOURCE_UNKNOWN", 422, schemaIssues);
    }
    const mapping = await insertMappingRevision(client, scope, {
      importId: input.importId,
      sourceId: importRow.source_id,
      sourceSchemaHash: importRow.source_schema_hash ?? sha256Json({ fields }),
      proposal,
      proposalSource: input.proposalSource ?? "harness",
      modelMetadata: sanitizeModelMetadata(input.modelMetadata),
      rootThreadId: normalizeHarnessId(input.rootThreadId, 8, 128),
      turnId: normalizeHarnessId(input.turnId, 8, 128),
      toolCallId: normalizeHarnessId(input.toolCallId, 1, 128),
      proposalIdempotencyKey: input.idempotencyKey,
    });
    const validation = await validateMappingWithClient(client, scope, input.importId, mapping.id, true);
    await client.query(
      `INSERT INTO commerce_enterprise_audit_event
        (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
       VALUES ($1,$2,$3,'product_catalog.mapping.propose','product_mapping',$4,'succeeded',$5::jsonb)`,
      [scope.tenantId, scope.workspaceId, scope.userId, mapping.id, JSON.stringify({
        importId: input.importId,
        idempotencyKey: input.idempotencyKey,
        valid: validation.valid,
        totalRecords: validation.totalRecords,
        invalidRecords: validation.invalidRecords,
        rootThreadId: normalizeHarnessId(input.rootThreadId, 8, 128),
        turnId: normalizeHarnessId(input.turnId, 8, 128),
        toolCallId: normalizeHarnessId(input.toolCallId, 1, 128),
      })],
    );
    return { mappingRevisionId: mapping.id, validation };
  });
}

export async function validateProductMapping(
  scope: EnterpriseScope,
  input: ValidateProductMappingInput,
): Promise<ProductMappingValidation> {
  assertUuid(input.importId, "导入标识");
  assertUuid(input.mappingRevisionId, "映射标识");
  assertUuid(input.idempotencyKey, "映射校验幂等键");
  return withEnterpriseDatabaseContext(scope, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `product-mapping-validate:${scope.tenantId}:${scope.workspaceId}:${input.idempotencyKey}`,
    ]);
    const mapping = await requireMappingRevision(client, scope, input.mappingRevisionId);
    if (mapping.import_run_id !== input.importId) {
      throw new ProductCatalogError("映射不属于该导入批次。", "PRODUCT_MAPPING_IMPORT_MISMATCH", 409);
    }
    const reused = await client.query<{ id: string }>(
      `SELECT id FROM commerce_product_mapping_revision
       WHERE tenant_id=$1 AND workspace_id=$2 AND validation_idempotency_key=$3 AND id<>$4
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, input.idempotencyKey, input.mappingRevisionId],
    );
    if (reused.rows[0]) {
      throw new ProductCatalogError(
        "映射校验幂等键已用于另一个映射。",
        "PRODUCT_MAPPING_VALIDATION_IDEMPOTENCY_CONFLICT",
        409,
      );
    }
    if (mapping.validation_idempotency_key && mapping.validation_idempotency_key !== input.idempotencyKey) {
      throw new ProductCatalogError(
        "该映射已由另一个幂等请求完成校验。",
        "PRODUCT_MAPPING_VALIDATION_CONFLICT",
        409,
      );
    }
    const duplicate = mapping.validation_idempotency_key === input.idempotencyKey;
    if (!duplicate) {
      const claimed = await client.query<{ id: string }>(
        `UPDATE commerce_product_mapping_revision
         SET validation_idempotency_key=$4
         WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3
           AND validation_idempotency_key IS NULL AND status IN ('draft','validated')
         RETURNING id`,
        [scope.tenantId, scope.workspaceId, input.mappingRevisionId, input.idempotencyKey],
      );
      if (!claimed.rows[0]) {
        throw new ProductCatalogError(
          "映射当前状态不能执行校验。",
          "PRODUCT_MAPPING_VALIDATION_STATE_CONFLICT",
          409,
        );
      }
    }
    const validation = await validateMappingWithClient(
      client,
      scope,
      input.importId,
      input.mappingRevisionId,
      !duplicate,
    );
    if (!duplicate) {
      await client.query(
        `INSERT INTO commerce_enterprise_audit_event
          (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
         VALUES ($1,$2,$3,'product_catalog.mapping.validate','product_mapping',$4,'succeeded',$5::jsonb)`,
        [scope.tenantId, scope.workspaceId, scope.userId, input.mappingRevisionId, JSON.stringify({
          importId: input.importId,
          idempotencyKey: input.idempotencyKey,
          valid: validation.valid,
          totalRecords: validation.totalRecords,
          invalidRecords: validation.invalidRecords,
          rootThreadId: normalizeHarnessId(input.rootThreadId, 8, 128),
          turnId: normalizeHarnessId(input.turnId, 8, 128),
          toolCallId: normalizeHarnessId(input.toolCallId, 1, 128),
        })],
      );
    }
    return validation;
  });
}

export async function activateProductImport(
  scope: EnterpriseScope,
  input: ActivateProductImportInput,
): Promise<ProductImportResult> {
  assertUuid(input.importId, "导入标识");
  assertUuid(input.mappingRevisionId, "映射标识");
  assertUuid(input.idempotencyKey, "激活幂等键");
  return withEnterpriseDatabaseContext(scope, (client) => activateImportWithClient(client, scope, input));
}

export async function createProductContextSet(
  scope: EnterpriseScope,
  input: { threadId: string; clientRequestId: string; productIds: string[] },
): Promise<string> {
  const productIds = normalizeProductIds(input.productIds);
  assertUuid(input.clientRequestId, "请求标识");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId)) {
    throw new ProductCatalogError("会话标识无效。", "PRODUCT_CONTEXT_THREAD_INVALID", 400);
  }
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const thread = await client.query<{ thread_id: string }>(
      `SELECT thread_id FROM commerce_agent_thread
       WHERE tenant_id=$1 AND workspace_id=$2 AND created_by_user_id=$3 AND thread_id=$4`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId],
    );
    if (!thread.rows[0]) throw new ProductCatalogError("会话不存在。", "PRODUCT_CONTEXT_THREAD_NOT_FOUND", 404);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM commerce_agent_product_context_set
       WHERE tenant_id=$1 AND workspace_id=$2 AND thread_id=$3 AND client_request_id=$4`,
      [scope.tenantId, scope.workspaceId, input.threadId, input.clientRequestId],
    );
    if (existing.rows[0]) {
      const existingItems = await client.query<{ product_id: string }>(
        `SELECT product_id FROM commerce_agent_product_context_item
         WHERE tenant_id=$1 AND workspace_id=$2 AND context_set_id=$3
         ORDER BY ordinal`,
        [scope.tenantId, scope.workspaceId, existing.rows[0].id],
      );
      const persistedIds = existingItems.rows.map((item) => item.product_id);
      if (persistedIds.length !== productIds.length || persistedIds.some((id, index) => id !== productIds[index])) {
        throw new ProductCatalogError(
          "相同请求标识已绑定另一组产品。",
          "PRODUCT_CONTEXT_IDEMPOTENCY_CONFLICT",
          409,
        );
      }
      return existing.rows[0].id;
    }
    const context = await client.query<{ id: string }>(
      `INSERT INTO commerce_agent_product_context_set
        (tenant_id,workspace_id,user_id,thread_id,client_request_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.clientRequestId],
    );
    const contextId = context.rows[0]?.id;
    if (!contextId) throw new ProductCatalogError("无法创建产品上下文。", "PRODUCT_CONTEXT_CREATE_FAILED", 500);
    for (const [ordinal, productId] of productIds.entries()) {
      const product = await client.query<{ product_id: string; product_revision_id: string }>(
        `SELECT id AS product_id, current_revision_id AS product_revision_id
         FROM commerce_product
         WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND current_revision_id IS NOT NULL`,
        [scope.tenantId, scope.workspaceId, productId],
      );
      const row = product.rows[0];
      if (!row) throw new ProductCatalogError("所选产品不存在。", "PRODUCT_NOT_FOUND", 404);
      await client.query(
        `INSERT INTO commerce_agent_product_context_item
          (tenant_id,workspace_id,context_set_id,ordinal,product_id,product_revision_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [scope.tenantId, scope.workspaceId, contextId, ordinal, row.product_id, row.product_revision_id],
      );
    }
    return contextId;
  });
}

export async function cloneProductContextSetForRetry(
  scope: EnterpriseScope,
  input: { threadId: string; sourceTurnId: string; clientRequestId: string },
): Promise<{ contextSetId: string; productIds: string[] } | null> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId) || !/^[A-Za-z0-9_-]{8,128}$/.test(input.sourceTurnId)) {
    throw new ProductCatalogError("会话或 Turn 标识无效。", "PRODUCT_CONTEXT_ID_INVALID", 400);
  }
  assertUuid(input.clientRequestId, "请求标识");
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM commerce_agent_product_context_set
       WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3
         AND thread_id=$4 AND client_request_id=$5`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.clientRequestId],
    );
    if (existing.rows[0]) {
      const items = await client.query<{ product_id: string }>(
        `SELECT product_id FROM commerce_agent_product_context_item
         WHERE tenant_id=$1 AND workspace_id=$2 AND context_set_id=$3
         ORDER BY ordinal`,
        [scope.tenantId, scope.workspaceId, existing.rows[0].id],
      );
      return { contextSetId: existing.rows[0].id, productIds: items.rows.map((item) => item.product_id) };
    }

    const source = await client.query<{ id: string }>(
      `SELECT id FROM commerce_agent_product_context_set
       WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3
         AND thread_id=$4 AND turn_id=$5
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.sourceTurnId],
    );
    if (!source.rows[0]) return null;

    const context = await client.query<{ id: string }>(
      `INSERT INTO commerce_agent_product_context_set
        (tenant_id,workspace_id,user_id,thread_id,client_request_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.clientRequestId],
    );
    const contextSetId = context.rows[0]?.id;
    if (!contextSetId) {
      throw new ProductCatalogError("无法复制产品上下文。", "PRODUCT_CONTEXT_CREATE_FAILED", 500);
    }
    await client.query(
      `INSERT INTO commerce_agent_product_context_item
        (tenant_id,workspace_id,context_set_id,ordinal,product_id,product_revision_id,variant_id,variant_revision_id)
       SELECT tenant_id,workspace_id,$4,ordinal,product_id,product_revision_id,variant_id,variant_revision_id
       FROM commerce_agent_product_context_item
       WHERE tenant_id=$1 AND workspace_id=$2 AND context_set_id=$3
       ORDER BY ordinal`,
      [scope.tenantId, scope.workspaceId, source.rows[0].id, contextSetId],
    );
    const items = await client.query<{ product_id: string }>(
      `SELECT product_id FROM commerce_agent_product_context_item
       WHERE tenant_id=$1 AND workspace_id=$2 AND context_set_id=$3
       ORDER BY ordinal`,
      [scope.tenantId, scope.workspaceId, contextSetId],
    );
    return { contextSetId, productIds: items.rows.map((item) => item.product_id) };
  });
}

export async function hasBoundProductContextForTurn(
  scope: EnterpriseScope,
  input: { threadId: string; turnId: string },
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId) || !/^[A-Za-z0-9_-]{8,128}$/.test(input.turnId)) {
    throw new ProductCatalogError("会话或 Turn 标识无效。", "PRODUCT_CONTEXT_ID_INVALID", 400);
  }
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `SELECT 1 FROM commerce_agent_product_context_set
       WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3
         AND thread_id=$4 AND turn_id=$5
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.turnId],
    );
    return result.rowCount === 1;
  });
}

export async function bindProductContextToTurn(
  scope: EnterpriseScope,
  input: { contextSetId: string; turnId: string },
): Promise<void> {
  assertUuid(input.contextSetId, "产品上下文标识");
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.turnId)) {
    throw new ProductCatalogError("Turn 标识无效。", "PRODUCT_CONTEXT_TURN_INVALID", 400);
  }
  await withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query(
      `UPDATE commerce_agent_product_context_set SET turn_id=$4
       WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3 AND id=$5
         AND (turn_id IS NULL OR turn_id=$4)`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.turnId, input.contextSetId],
    );
    if (result.rowCount !== 1) throw new ProductCatalogError("产品上下文不存在或已绑定。", "PRODUCT_CONTEXT_BIND_FAILED", 409);
  });
}

export async function resolveSelectedProductContext(
  scope: EnterpriseScope,
  input: { threadId: string; turnId: string },
): Promise<ProductContextResult> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId) || !/^[A-Za-z0-9_-]{8,128}$/.test(input.turnId)) {
    throw new ProductCatalogError("会话或 Turn 标识无效。", "PRODUCT_CONTEXT_ID_INVALID", 400);
  }
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<{ product_id: string }>(
      `SELECT item.product_id
       FROM commerce_agent_product_context_set context_set
       JOIN commerce_agent_product_context_item item
         ON item.tenant_id=context_set.tenant_id
        AND item.workspace_id=context_set.workspace_id
        AND item.context_set_id=context_set.id
       WHERE context_set.tenant_id=$1 AND context_set.workspace_id=$2
         AND context_set.user_id=$3 AND context_set.thread_id=$4
         AND context_set.turn_id=$5
       ORDER BY context_set.created_at DESC, item.ordinal
       LIMIT 20`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, input.turnId],
    );
    const ids = [...new Set(result.rows.map((row) => row.product_id))];
    const products: ProductDetail[] = [];
    for (const id of ids) {
      const product = await getProductWithClient(client, scope, id);
      if (product) products.push(product);
    }
    return {
      products,
      resolvedAt: new Date().toISOString(),
      limitations: ["返回的是提交该 Turn 时绑定的产品 revision 引用；原始导入记录不会暴露给 Agent。"],
    };
  });
}

/**
 * Restores only the small product summary projection for the newest product
 * selection that was successfully bound to a Harness Turn in this owned
 * thread. The immutable revision reference is used for title/image fidelity;
 * raw source rows, mappings, attributes, credentials, and connector metadata
 * are deliberately outside this query.
 */
export async function getLatestBoundProductContext(
  scope: EnterpriseScope,
  threadId: string,
): Promise<ProductProjectContextResult> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(threadId)) {
    throw new ProductCatalogError("会话标识无效。", "PRODUCT_CONTEXT_THREAD_INVALID", 400);
  }
  return withEnterpriseDatabaseContext(scope, async (client) => {
    const contextResult = await client.query<{ id: string; turn_id: string }>(
      `SELECT id, turn_id
       FROM commerce_agent_product_context_set
       WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3 AND thread_id=$4
         AND turn_id IS NOT NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [scope.tenantId, scope.workspaceId, scope.userId, threadId],
    );
    const context = contextResult.rows[0];
    if (!context) {
      return { turnId: null, products: [], resolvedAt: new Date().toISOString() };
    }

    const products = await client.query<ProductSummaryRow>(
      `SELECT product.id, revision.title, product.internal_product_key, product.status,
              (SELECT count(*)::text
               FROM commerce_product_variant variant
               WHERE variant.tenant_id=product.tenant_id
                 AND variant.workspace_id=product.workspace_id
                 AND variant.product_id=product.id
                 AND variant.status<>'archived') AS variant_count,
              (SELECT min(source.name)
               FROM commerce_product_source_link source_link
               JOIN commerce_product_source source
                 ON source.tenant_id=source_link.tenant_id
                AND source.workspace_id=source_link.workspace_id
                AND source.id=source_link.source_id
               WHERE source_link.tenant_id=product.tenant_id
                 AND source_link.workspace_id=product.workspace_id
                 AND source_link.product_id=product.id
                 AND source_link.review_state='accepted') AS source_name,
              revision.created_at AS updated_at,
              revision.primary_image_url
       FROM commerce_agent_product_context_item item
       JOIN commerce_agent_product_context_set context_set
         ON context_set.tenant_id=item.tenant_id
        AND context_set.workspace_id=item.workspace_id
        AND context_set.id=item.context_set_id
       JOIN commerce_product product
         ON product.tenant_id=item.tenant_id
        AND product.workspace_id=item.workspace_id
        AND product.id=item.product_id
       JOIN commerce_product_revision revision
         ON revision.tenant_id=item.tenant_id
        AND revision.workspace_id=item.workspace_id
        AND revision.id=item.product_revision_id
        AND revision.product_id=item.product_id
       WHERE context_set.tenant_id=$1 AND context_set.workspace_id=$2
         AND context_set.user_id=$3 AND context_set.thread_id=$4
         AND context_set.id=$5 AND context_set.turn_id=$6
       ORDER BY item.ordinal
       LIMIT $7`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.userId,
        threadId,
        context.id,
        context.turn_id,
        PRODUCT_CONTEXT_MAX_ITEMS,
      ],
    );
    return {
      turnId: context.turn_id,
      products: products.rows.map(toProductSummary),
      resolvedAt: new Date().toISOString(),
    };
  });
}

/**
 * Reads the immutable Product revision summaries bound to a page of Harness
 * Turns in one scoped query. This projection is intentionally limited to the
 * public ProductSummary contract: attributes, raw source rows, connector
 * configuration and credentials never cross the history boundary.
 */
export async function listBoundProductContextsByTurnIds(
  scope: EnterpriseScope,
  input: { threadId: string; turnIds: string[] },
): Promise<Map<string, ProductSummary[]>> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.threadId)) {
    throw new ProductCatalogError("会话标识无效。", "PRODUCT_CONTEXT_THREAD_INVALID", 400);
  }
  const turnIds = [...new Set(input.turnIds)];
  if (
    turnIds.length > 500 ||
    turnIds.some((turnId) => !/^[A-Za-z0-9_-]{8,128}$/.test(turnId))
  ) {
    throw new ProductCatalogError("Turn 标识无效。", "PRODUCT_CONTEXT_TURN_INVALID", 400);
  }
  if (turnIds.length === 0) return new Map();

  return withEnterpriseDatabaseContext(scope, async (client) => {
    const result = await client.query<TurnProductSummaryRow>(
      `WITH requested_turn AS (
         SELECT DISTINCT unnest($5::text[]) AS turn_id
       ), latest_context AS (
         SELECT DISTINCT ON (context_set.turn_id)
                context_set.id, context_set.turn_id, context_set.created_at
         FROM commerce_agent_product_context_set context_set
         JOIN requested_turn requested ON requested.turn_id=context_set.turn_id
         WHERE context_set.tenant_id=$1 AND context_set.workspace_id=$2
           AND context_set.user_id=$3 AND context_set.thread_id=$4
           AND context_set.turn_id IS NOT NULL
         ORDER BY context_set.turn_id, context_set.created_at DESC, context_set.id DESC
       )
       SELECT context.turn_id,item.ordinal,product.id,revision.title,
              product.internal_product_key,product.status,
              (SELECT count(*)::text
               FROM commerce_product_variant variant
               WHERE variant.tenant_id=item.tenant_id
                 AND variant.workspace_id=item.workspace_id
                 AND variant.product_id=item.product_id
                 AND variant.created_at<=context.created_at) AS variant_count,
              source.name AS source_name,revision.created_at AS updated_at,
              revision.primary_image_url
       FROM latest_context context
       JOIN commerce_agent_product_context_item item
         ON item.tenant_id=$1 AND item.workspace_id=$2
        AND item.context_set_id=context.id
       JOIN commerce_product product
         ON product.tenant_id=item.tenant_id
        AND product.workspace_id=item.workspace_id
        AND product.id=item.product_id
       JOIN commerce_product_revision revision
         ON revision.tenant_id=item.tenant_id
        AND revision.workspace_id=item.workspace_id
        AND revision.id=item.product_revision_id
        AND revision.product_id=item.product_id
       LEFT JOIN commerce_product_import_run import_run
         ON import_run.tenant_id=revision.tenant_id
        AND import_run.workspace_id=revision.workspace_id
        AND import_run.id=revision.source_import_id
       LEFT JOIN commerce_product_source source
         ON source.tenant_id=import_run.tenant_id
        AND source.workspace_id=import_run.workspace_id
        AND source.id=import_run.source_id
       ORDER BY array_position($5::text[],context.turn_id),item.ordinal
       LIMIT ${500 * PRODUCT_CONTEXT_MAX_ITEMS}`,
      [scope.tenantId, scope.workspaceId, scope.userId, input.threadId, turnIds],
    );

    const productsByTurn = new Map<string, ProductSummary[]>();
    for (const row of result.rows) {
      const products = productsByTurn.get(row.turn_id) ?? [];
      products.push(toProductSummary(row));
      productsByTurn.set(row.turn_id, products);
    }
    return productsByTurn;
  });
}

async function getProductWithClient(
  client: PoolClient,
  scope: EnterpriseScope,
  productId: string,
): Promise<ProductDetail | null> {
  const productResult = await client.query<ProductSummaryRow & {
    revision_id: string;
    description: string | null;
    brand_name: string | null;
    category_path: string | null;
    attributes: Record<string, unknown>;
    revision_number: number;
  }>(
    `
      SELECT product.id, revision.id AS revision_id, revision.title, product.internal_product_key, product.status,
             (SELECT count(*)::text FROM commerce_product_variant variant_count
              WHERE variant_count.tenant_id=product.tenant_id
                AND variant_count.workspace_id=product.workspace_id
                AND variant_count.product_id=product.id
                AND variant_count.status<>'archived') AS variant_count,
             (SELECT source.name FROM commerce_product_source_link link
              JOIN commerce_product_source source
                ON source.tenant_id=link.tenant_id AND source.workspace_id=link.workspace_id AND source.id=link.source_id
              WHERE link.tenant_id=product.tenant_id AND link.workspace_id=product.workspace_id
                AND link.product_id=product.id AND link.review_state='accepted'
              ORDER BY link.last_seen_at DESC LIMIT 1) AS source_name,
             product.updated_at, revision.primary_image_url, revision.description,
             revision.brand_name, revision.category_path, revision.attributes, revision.revision_number
      FROM commerce_product product
      JOIN commerce_product_revision revision
        ON revision.tenant_id=product.tenant_id
       AND revision.workspace_id=product.workspace_id
       AND revision.id=product.current_revision_id
      WHERE product.tenant_id=$1 AND product.workspace_id=$2 AND product.id=$3
    `,
    [scope.tenantId, scope.workspaceId, productId],
  );
  const row = productResult.rows[0];
  if (!row) return null;
  const variants = await client.query<{
    id: string;
    revision_id: string;
    internal_sku: string;
    status: ProductVariantDetail["status"];
    title: string | null;
    gtin: string | null;
    option_values: Record<string, unknown>;
    revision_number: number;
  }>(
    `SELECT variant.id, revision.id AS revision_id, variant.internal_sku, variant.status, revision.title,
            revision.gtin, revision.option_values, revision.revision_number
     FROM commerce_product_variant variant
     JOIN commerce_product_variant_revision revision
       ON revision.tenant_id=variant.tenant_id
      AND revision.workspace_id=variant.workspace_id
      AND revision.id=variant.current_revision_id
     WHERE variant.tenant_id=$1 AND variant.workspace_id=$2 AND variant.product_id=$3
     ORDER BY variant.internal_sku, variant.id`,
    [scope.tenantId, scope.workspaceId, productId],
  );
  const sources = await client.query<{
    id: string;
    name: string;
    source_kind: string;
    external_product_key: string;
    last_seen_at: Date;
  }>(
    `SELECT DISTINCT ON (source.id) source.id, source.name, source.source_kind,
            link.external_product_key, link.last_seen_at
     FROM commerce_product_source_link link
     JOIN commerce_product_source source
       ON source.tenant_id=link.tenant_id AND source.workspace_id=link.workspace_id AND source.id=link.source_id
     WHERE link.tenant_id=$1 AND link.workspace_id=$2 AND link.product_id=$3
       AND link.review_state='accepted'
     ORDER BY source.id, link.last_seen_at DESC`,
    [scope.tenantId, scope.workspaceId, productId],
  );
  return {
    ...toProductSummary(row),
    revisionId: row.revision_id,
    description: row.description,
    brandName: row.brand_name,
    categoryPath: row.category_path,
    attributes: row.attributes ?? {},
    revisionNumber: row.revision_number,
    variants: variants.rows.map((variant) => ({
      id: variant.id,
      variantRevisionId: variant.revision_id,
      sku: variant.internal_sku,
      title: variant.title,
      status: variant.status,
      gtin: variant.gtin,
      optionValues: variant.option_values ?? {},
      revisionNumber: variant.revision_number,
    })),
    sources: sources.rows.map((source) => ({
      id: source.id,
      name: source.name,
      sourceKind: source.source_kind,
      externalProductKey: source.external_product_key,
      lastSeenAt: source.last_seen_at.toISOString(),
    })),
  };
}

async function getProductRevisionWithClient(
  client: PoolClient,
  scope: EnterpriseScope,
  productId: string,
  productRevisionId: string,
  snapshotAt: Date,
): Promise<ProductDetail | null> {
  const productResult = await client.query<ProductSummaryRow & {
    revision_id: string;
    description: string | null;
    brand_name: string | null;
    category_path: string | null;
    attributes: Record<string, unknown>;
    revision_number: number;
  }>(
    `SELECT product.id,revision.id AS revision_id,revision.title,
            product.internal_product_key,product.status,
            (SELECT count(*)::text FROM commerce_product_variant variant_count
             WHERE variant_count.tenant_id=product.tenant_id
               AND variant_count.workspace_id=product.workspace_id
               AND variant_count.product_id=product.id
               AND variant_count.created_at <= $5
               AND variant_count.status<>'archived') AS variant_count,
            (SELECT source.name FROM commerce_product_revision source_revision
             JOIN commerce_product_import_run import_run
               ON import_run.tenant_id=source_revision.tenant_id
              AND import_run.workspace_id=source_revision.workspace_id
              AND import_run.id=source_revision.source_import_id
             JOIN commerce_product_source source
               ON source.tenant_id=import_run.tenant_id
              AND source.workspace_id=import_run.workspace_id
              AND source.id=import_run.source_id
             WHERE source_revision.tenant_id=revision.tenant_id
               AND source_revision.workspace_id=revision.workspace_id
               AND source_revision.id=revision.id LIMIT 1) AS source_name,
            revision.created_at AS updated_at,revision.primary_image_url,
            revision.description,revision.brand_name,revision.category_path,
            revision.attributes,revision.revision_number
     FROM commerce_product product
     JOIN commerce_product_revision revision
       ON revision.tenant_id=product.tenant_id
      AND revision.workspace_id=product.workspace_id
      AND revision.product_id=product.id
      AND revision.id=$4
     WHERE product.tenant_id=$1 AND product.workspace_id=$2 AND product.id=$3`,
    [scope.tenantId, scope.workspaceId, productId, productRevisionId, snapshotAt],
  );
  const row = productResult.rows[0];
  if (!row) return null;
  const variants = await client.query<{
    id: string;
    revision_id: string;
    internal_sku: string;
    status: ProductVariantDetail["status"];
    title: string | null;
    gtin: string | null;
    option_values: Record<string, unknown>;
    revision_number: number;
  }>(
    `SELECT DISTINCT ON (variant.id)
            variant.id,revision.id AS revision_id,variant.internal_sku,variant.status,
            revision.title,revision.gtin,revision.option_values,revision.revision_number
     FROM commerce_product_variant variant
     JOIN commerce_product_variant_revision revision
       ON revision.tenant_id=variant.tenant_id
      AND revision.workspace_id=variant.workspace_id
      AND revision.variant_id=variant.id
      AND revision.created_at <= $4
     WHERE variant.tenant_id=$1 AND variant.workspace_id=$2
       AND variant.product_id=$3 AND variant.created_at <= $4
     ORDER BY variant.id,revision.created_at DESC,revision.revision_number DESC`,
    [scope.tenantId, scope.workspaceId, productId, snapshotAt],
  );
  const sources = await client.query<{
    id: string;
    name: string;
    source_kind: string;
    external_product_key: string;
    last_seen_at: Date;
  }>(
    `SELECT source.id,source.name,source.source_kind,
            COALESCE(link.external_product_key,product.internal_product_key) AS external_product_key,
            LEAST(COALESCE(link.last_seen_at,$5),$5) AS last_seen_at
     FROM commerce_product product
     JOIN commerce_product_revision revision
       ON revision.tenant_id=product.tenant_id
      AND revision.workspace_id=product.workspace_id
      AND revision.product_id=product.id AND revision.id=$4
     JOIN commerce_product_import_run import_run
       ON import_run.tenant_id=revision.tenant_id
      AND import_run.workspace_id=revision.workspace_id
      AND import_run.id=revision.source_import_id
     JOIN commerce_product_source source
       ON source.tenant_id=import_run.tenant_id
      AND source.workspace_id=import_run.workspace_id
      AND source.id=import_run.source_id
     LEFT JOIN commerce_product_source_link link
       ON link.tenant_id=product.tenant_id
      AND link.workspace_id=product.workspace_id
      AND link.product_id=product.id
      AND link.source_id=source.id
     WHERE product.tenant_id=$1 AND product.workspace_id=$2 AND product.id=$3
     ORDER BY link.last_seen_at DESC NULLS LAST LIMIT 1`,
    [scope.tenantId, scope.workspaceId, productId, productRevisionId, snapshotAt],
  );
  return {
    ...toProductSummary(row),
    revisionId: row.revision_id,
    description: row.description,
    brandName: row.brand_name,
    categoryPath: row.category_path,
    attributes: row.attributes ?? {},
    revisionNumber: row.revision_number,
    variants: variants.rows.map((variant) => ({
      id: variant.id,
      variantRevisionId: variant.revision_id,
      sku: variant.internal_sku,
      title: variant.title,
      status: variant.status,
      gtin: variant.gtin,
      optionValues: variant.option_values ?? {},
      revisionNumber: variant.revision_number,
    })),
    sources: sources.rows.map((source) => ({
      id: source.id,
      name: source.name,
      sourceKind: source.source_kind,
      externalProductKey: source.external_product_key,
      lastSeenAt: source.last_seen_at.toISOString(),
    })),
  };
}

async function validateMappingWithClient(
  client: PoolClient,
  scope: EnterpriseScope,
  importId: string,
  mappingRevisionId: string,
  persistValidatedStatus: boolean,
): Promise<ProductMappingValidation> {
  const importRow = await requireImportRow(client, scope, importId);
  const mapping = await requireMappingRevision(client, scope, mappingRevisionId);
  if (mapping.import_run_id !== importId || mapping.source_id !== importRow.source_id) {
    throw new ProductCatalogError("映射不属于该导入批次。", "PRODUCT_MAPPING_IMPORT_MISMATCH", 409);
  }
  const proposal = parseProductMappingProposal(mapping.mapping_document);
  const records = await readSourceRecords(client, scope, importId);
  const fields = collectRecordPaths(records.map((record) => record.raw_payload));
  const issues = validateProductMappingAgainstSchema(proposal, new Set(fields));
  const storedFields = await readMappingFields(client, scope, mappingRevisionId);
  for (const field of storedFields) {
    if (field.review_state !== "accepted") {
      issues.push({
        code: "MAPPING_FIELD_REVIEW_REQUIRED",
        message: `映射字段 ${field.target_field} 置信度不足，需要人工审核或新的高置信度提案。`,
        severity: "error",
        field: field.source_path,
      });
    }
  }
  let validRecords = 0;
  for (const record of records) {
    const normalized = normalizeProductRecord(record.raw_payload, proposal, record.ordinal + 1);
    issues.push(...normalized.issues);
    if (normalized.value) validRecords += 1;
  }
  const valid = issues.every((issue) => issue.severity !== "error") && validRecords === records.length && records.length > 0;
  if (persistValidatedStatus && valid && mapping.status === "draft") {
    await client.query(
      `UPDATE commerce_product_mapping_revision
       SET status='validated', validated_by_user_id=$4, validated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND status='draft'`,
      [scope.tenantId, scope.workspaceId, mappingRevisionId, scope.userId],
    );
    await client.query(
      `UPDATE commerce_product_import_run
       SET status='validated', mapping_revision_id=$4
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND status IN ('profiled','needs_review','validated')`,
      [scope.tenantId, scope.workspaceId, importId, mappingRevisionId],
    );
  }
  return {
    valid,
    mappingRevisionId,
    totalRecords: records.length,
    validRecords,
    invalidRecords: records.length - validRecords,
    issues: issues.slice(0, 1000),
  };
}

async function activateImportWithClient(
  client: PoolClient,
  scope: EnterpriseScope,
  input: ActivateProductImportInput,
): Promise<ProductImportResult> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`product-import:${scope.tenantId}:${input.importId}`]);
  const importRow = await requireImportRow(client, scope, input.importId);
  if (importRow.activation_idempotency_key && importRow.activation_idempotency_key !== input.idempotencyKey) {
    throw new ProductCatalogError("该导入批次已由另一个幂等请求激活。", "PRODUCT_IMPORT_ACTIVATION_CONFLICT", 409);
  }
  const reusedActivationKey = await client.query<{ id: string }>(
    `SELECT id FROM commerce_product_import_run
     WHERE tenant_id=$1 AND workspace_id=$2 AND activation_idempotency_key=$3 AND id<>$4
     LIMIT 1`,
    [scope.tenantId, scope.workspaceId, input.idempotencyKey, input.importId],
  );
  if (reusedActivationKey.rows[0]) {
    throw new ProductCatalogError("激活幂等键已用于另一个导入批次。", "PRODUCT_IMPORT_IDEMPOTENCY_CONFLICT", 409);
  }
  if (importRow.status === "completed") return toImportResult(importRow);
  const validation = await validateMappingWithClient(client, scope, input.importId, input.mappingRevisionId, true);
  if (!validation.valid) {
    throw new ProductCatalogError("产品映射未通过确定性校验。", "PRODUCT_MAPPING_VALIDATION_FAILED", 422, validation.issues);
  }
  const mapping = await requireMappingRevision(client, scope, input.mappingRevisionId);
  const proposal = parseProductMappingProposal(mapping.mapping_document);
  const mappingFields = await readMappingFields(client, scope, input.mappingRevisionId);
  const fieldsByTarget = new Map(mappingFields.map((field) => [field.target_field, field]));
  await client.query(
    `UPDATE commerce_product_import_run
     SET status='importing', mapping_revision_id=$4, activation_idempotency_key=$5,
         started_at=COALESCE(started_at,CURRENT_TIMESTAMP), failure_code=NULL, failure_message=NULL
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
    [scope.tenantId, scope.workspaceId, input.importId, input.mappingRevisionId, input.idempotencyKey],
  );

  const records = await readSourceRecords(client, scope, input.importId);
  const touchedProducts = new Set<string>();
  const touchedVariants = new Set<string>();
  for (const record of records) {
    const normalized = normalizeProductRecord(record.raw_payload, proposal, record.ordinal + 1);
    if (!normalized.value) continue;
    const result = await persistNormalizedProduct(client, scope, {
      importRow,
      mappingRevisionId: input.mappingRevisionId,
      mappingFields: fieldsByTarget,
      sourceRecord: record,
      normalized: normalized.value,
    });
    touchedProducts.add(result.productId);
    if (result.variantId) touchedVariants.add(result.variantId);
  }
  await client.query(
    `UPDATE commerce_product_mapping_revision
     SET status='active', activated_by_user_id=$4, activated_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND status='validated'`,
    [scope.tenantId, scope.workspaceId, input.mappingRevisionId, scope.userId],
  );
  await client.query(
    `UPDATE commerce_product_import_run
     SET status='completed', imported_products=$4, imported_variants=$5,
         issue_count=(SELECT count(*) FROM commerce_product_import_issue issue
                      WHERE issue.tenant_id=$1 AND issue.workspace_id=$2 AND issue.import_run_id=$3),
         completed_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
    [scope.tenantId, scope.workspaceId, input.importId, touchedProducts.size, touchedVariants.size],
  );
  await client.query(
    `INSERT INTO commerce_enterprise_audit_event
      (tenant_id,workspace_id,actor_user_id,action,target_type,target_id,outcome,metadata)
     VALUES ($1,$2,$3,'product_catalog.import.activate','product_import',$4,'succeeded',
             jsonb_build_object(
               'productCount',$5::integer,
               'variantCount',$6::integer,
               'activationOrigin',$7::text,
               'mappingRevisionId',$8::uuid
             ))`,
    [scope.tenantId, scope.workspaceId, scope.userId, input.importId, touchedProducts.size,
      touchedVariants.size, importRow.root_thread_id ? "harness_commerce_approval" : "authenticated_user_import",
      input.mappingRevisionId],
  );
  return toImportResult(await requireImportRow(client, scope, input.importId));
}

async function persistNormalizedProduct(
  client: PoolClient,
  scope: EnterpriseScope,
  input: {
    importRow: ImportRow;
    mappingRevisionId: string;
    mappingFields: Map<string, MappingFieldRow>;
    sourceRecord: SourceRecordRow;
    normalized: NormalizedProductRecord;
  },
): Promise<{ productId: string; variantId: string | null }> {
  const existingProduct = await client.query<{ id: string; same_source_identity: boolean }>(
    `SELECT product.id,
            EXISTS (
              SELECT 1 FROM commerce_product_source_link link
              WHERE link.tenant_id=product.tenant_id AND link.workspace_id=product.workspace_id
                AND link.product_id=product.id AND link.source_id=$4
                AND link.external_product_key=$3 AND link.review_state='accepted'
            ) AS same_source_identity
     FROM commerce_product product
     WHERE product.tenant_id=$1 AND product.workspace_id=$2 AND product.internal_product_key=$3
     FOR UPDATE`,
    [scope.tenantId, scope.workspaceId, input.normalized.product.key, input.importRow.source_id],
  );
  if (existingProduct.rows[0] && !existingProduct.rows[0].same_source_identity) {
    throw new ProductCatalogError(
      "另一个数据源已使用相同 SPU；跨源合并必须先人工审核。",
      "PRODUCT_CROSS_SOURCE_IDENTITY_REVIEW_REQUIRED",
      409,
    );
  }
  const productId = existingProduct.rows[0]?.id ?? (
    await client.query<{ id: string }>(
      `INSERT INTO commerce_product (tenant_id,workspace_id,internal_product_key,status)
       VALUES ($1,$2,$3,'active') RETURNING id`,
      [scope.tenantId, scope.workspaceId, input.normalized.product.key],
    )
  ).rows[0]?.id;
  if (!productId) throw new ProductCatalogError("无法写入产品主档。", "PRODUCT_MASTER_WRITE_FAILED", 500);
  if (existingProduct.rows[0]) {
    await client.query(
      `UPDATE commerce_product SET status='active',updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      [scope.tenantId, scope.workspaceId, productId],
    );
  }
  const productContentHash = sha256Json(input.normalized.product);
  const insertedProductRevision = await client.query<{ id: string }>(
    `INSERT INTO commerce_product_revision (
       tenant_id,workspace_id,product_id,revision_number,title,description,brand_name,
       category_path,primary_image_url,attributes,content_sha256,source_import_id,
       source_record_id,mapping_revision_id,created_by_user_id
     ) VALUES (
       $1,$2,$3,
       (SELECT COALESCE(max(revision_number),0)+1 FROM commerce_product_revision
        WHERE tenant_id=$1 AND workspace_id=$2 AND product_id=$3),
       $4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14
     )
     ON CONFLICT (tenant_id,workspace_id,product_id,content_sha256) DO NOTHING
     RETURNING id`,
    [scope.tenantId, scope.workspaceId, productId, input.normalized.product.title,
      input.normalized.product.description, input.normalized.product.brandName,
      input.normalized.product.categoryPath, input.normalized.product.imageUrl,
      JSON.stringify(input.normalized.product.attributes), productContentHash, input.importRow.id,
      input.sourceRecord.id, input.mappingRevisionId, scope.userId],
  );
  const productRevisionId = insertedProductRevision.rows[0]?.id ?? (
    await client.query<{ id: string }>(
      `SELECT id FROM commerce_product_revision
       WHERE tenant_id=$1 AND workspace_id=$2 AND product_id=$3 AND content_sha256=$4`,
      [scope.tenantId, scope.workspaceId, productId, productContentHash],
    )
  ).rows[0]?.id;
  if (!productRevisionId) throw new ProductCatalogError("无法确定产品 revision。", "PRODUCT_REVISION_WRITE_FAILED", 500);
  await client.query(
    `UPDATE commerce_product SET current_revision_id=$4, updated_at=CURRENT_TIMESTAMP
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
    [scope.tenantId, scope.workspaceId, productId, productRevisionId],
  );

  let variantId: string | null = null;
  let variantRevisionId: string | null = null;
  let insertedVariantRevisionNow = false;
  if (input.normalized.variant) {
    const variant = await client.query<{ id: string }>(
      `INSERT INTO commerce_product_variant (tenant_id,workspace_id,product_id,internal_sku,status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (tenant_id,workspace_id,internal_sku) DO UPDATE
       SET status='active', updated_at=CURRENT_TIMESTAMP
       WHERE commerce_product_variant.product_id=EXCLUDED.product_id
       RETURNING id`,
      [scope.tenantId, scope.workspaceId, productId, input.normalized.variant.sku],
    );
    variantId = variant.rows[0]?.id ?? null;
    if (!variantId) {
      throw new ProductCatalogError("SKU 已属于另一个产品，不能自动合并。", "PRODUCT_VARIANT_IDENTITY_CONFLICT", 409);
    }
    const variantHash = sha256Json(input.normalized.variant);
    const insertedVariantRevision = await client.query<{ id: string }>(
      `INSERT INTO commerce_product_variant_revision (
         tenant_id,workspace_id,variant_id,revision_number,title,gtin,option_values,
         attributes,content_sha256,source_import_id,source_record_id,mapping_revision_id,created_by_user_id
       ) VALUES (
         $1,$2,$3,
         (SELECT COALESCE(max(revision_number),0)+1 FROM commerce_product_variant_revision
          WHERE tenant_id=$1 AND workspace_id=$2 AND variant_id=$3),
         $4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12
       )
       ON CONFLICT (tenant_id,workspace_id,variant_id,content_sha256) DO NOTHING
       RETURNING id`,
      [scope.tenantId, scope.workspaceId, variantId, input.normalized.variant.title,
        input.normalized.variant.gtin, JSON.stringify(input.normalized.variant.optionValues),
        JSON.stringify(input.normalized.variant.attributes), variantHash, input.importRow.id,
        input.sourceRecord.id, input.mappingRevisionId, scope.userId],
    );
    variantRevisionId = insertedVariantRevision.rows[0]?.id ?? (
      await client.query<{ id: string }>(
        `SELECT id FROM commerce_product_variant_revision
         WHERE tenant_id=$1 AND workspace_id=$2 AND variant_id=$3 AND content_sha256=$4`,
        [scope.tenantId, scope.workspaceId, variantId, variantHash],
      )
    ).rows[0]?.id ?? null;
    insertedVariantRevisionNow = Boolean(insertedVariantRevision.rows[0]);
    if (!variantRevisionId) throw new ProductCatalogError("无法确定 SKU revision。", "PRODUCT_VARIANT_REVISION_WRITE_FAILED", 500);
    await client.query(
      `UPDATE commerce_product_variant SET current_revision_id=$4, updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      [scope.tenantId, scope.workspaceId, variantId, variantRevisionId],
    );
  }

  const linked = await client.query<{ id: string }>(
    `INSERT INTO commerce_product_source_link (
       tenant_id,workspace_id,source_id,external_product_key,external_variant_key,
       product_id,variant_id,latest_source_record_id,mapping_revision_id,
       match_method,confidence,review_state
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'source_key',1,'accepted')
     ON CONFLICT (tenant_id,workspace_id,source_id,external_product_key,external_variant_key)
     DO UPDATE SET latest_source_record_id=EXCLUDED.latest_source_record_id,
       mapping_revision_id=EXCLUDED.mapping_revision_id,
       confidence=1, review_state='accepted', last_seen_at=CURRENT_TIMESTAMP,
       updated_at=CURRENT_TIMESTAMP
     WHERE commerce_product_source_link.product_id=EXCLUDED.product_id
       AND commerce_product_source_link.variant_id IS NOT DISTINCT FROM EXCLUDED.variant_id
     RETURNING id`,
    [scope.tenantId, scope.workspaceId, input.importRow.source_id, input.normalized.product.key,
      input.normalized.variant?.sku ?? "", productId, variantId, input.sourceRecord.id, input.mappingRevisionId],
  );
  if (!linked.rows[0]) {
    throw new ProductCatalogError(
      "数据源商品身份与已有 Product/SKU 关联冲突，需要人工审核。",
      "PRODUCT_SOURCE_LINK_CONFLICT",
      409,
    );
  }

  if (insertedProductRevision.rows[0]) {
    await insertFieldLineage(client, scope, input, productRevisionId, null, false);
  }
  if (insertedVariantRevisionNow && variantRevisionId) {
    await insertFieldLineage(client, scope, input, null, variantRevisionId, true);
  }
  return { productId, variantId };
}

async function insertFieldLineage(
  client: PoolClient,
  scope: EnterpriseScope,
  input: {
    mappingFields: Map<string, MappingFieldRow>;
    sourceRecord: SourceRecordRow;
    normalized: NormalizedProductRecord;
  },
  productRevisionId: string | null,
  variantRevisionId: string | null,
  variantOnly: boolean,
): Promise<void> {
  for (const [target, mapped] of input.normalized.mappedValues.entries()) {
    if (variantOnly !== target.startsWith("variant.")) continue;
    const field = input.mappingFields.get(target);
    if (!field) continue;
    await client.query(
      `INSERT INTO commerce_product_field_lineage (
        tenant_id,workspace_id,product_revision_id,variant_revision_id,mapping_field_id,
        source_record_id,target_field,source_path,raw_value_sha256
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [scope.tenantId, scope.workspaceId, productRevisionId, variantRevisionId, field.id,
        input.sourceRecord.id, target, mapped.field.sourcePath, sha256Json(mapped.rawValue)],
    );
  }
}

async function insertMappingRevision(
  client: PoolClient,
  scope: EnterpriseScope,
  input: {
    importId: string;
    sourceId: string;
    sourceSchemaHash: string;
    proposal: ProductMappingProposal;
    proposalSource: "deterministic" | "harness" | "manual";
    modelMetadata: Record<string, unknown>;
    rootThreadId: string | null;
    turnId: string | null;
    toolCallId: string | null;
    proposalIdempotencyKey: string | null;
  },
): Promise<{ id: string }> {
  await client.query(
    `SELECT id FROM commerce_product_source
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 FOR UPDATE`,
    [scope.tenantId, scope.workspaceId, input.sourceId],
  );
  const result = await client.query<{ id: string }>(
    `INSERT INTO commerce_product_mapping_revision (
       tenant_id,workspace_id,source_id,import_run_id,revision_number,source_schema_hash,
       proposal_source,mapping_document,model_metadata,input_profile_hash,confidence,
       root_thread_id,turn_id,tool_call_id,created_by_user_id,proposal_idempotency_key
     ) VALUES (
       $1,$2,$3,$4,
       (SELECT COALESCE(max(revision_number),0)+1 FROM commerce_product_mapping_revision
        WHERE tenant_id=$1 AND workspace_id=$2 AND source_id=$3),
       $5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15
     ) RETURNING id`,
    [scope.tenantId, scope.workspaceId, input.sourceId, input.importId, input.sourceSchemaHash,
      input.proposalSource, JSON.stringify(input.proposal), JSON.stringify(input.modelMetadata),
      sha256Json({ schema: input.sourceSchemaHash, proposal: input.proposal }),
      minimumConfidence(input.proposal), input.rootThreadId, input.turnId, input.toolCallId,
      scope.userId, input.proposalIdempotencyKey],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new ProductCatalogError("无法保存产品字段映射。", "PRODUCT_MAPPING_WRITE_FAILED", 500);
  for (const field of input.proposal.fields) {
    await client.query(
      `INSERT INTO commerce_product_mapping_field (
        tenant_id,workspace_id,mapping_revision_id,source_path,target_field,transform,
        transform_options,required,confidence,evidence,review_state
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)`,
      [scope.tenantId, scope.workspaceId, id, field.sourcePath, field.targetField,
        field.transform, JSON.stringify(field.transformOptions), field.required, field.confidence,
        field.evidence,
        input.proposalSource !== "harness" || (field.confidence !== null && field.confidence >= 0.9)
          ? "accepted"
          : "pending"],
    );
  }
  await client.query(
    `UPDATE commerce_product_import_run SET mapping_revision_id=$4,
       root_thread_id=COALESCE($5,root_thread_id),
       turn_id=COALESCE($6,turn_id),
       tool_call_id=COALESCE($7,tool_call_id)
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
    [scope.tenantId, scope.workspaceId, input.importId, id,
      input.rootThreadId, input.turnId, input.toolCallId],
  );
  return { id };
}

async function readMappingFields(
  client: PoolClient,
  scope: EnterpriseScope,
  mappingRevisionId: string,
): Promise<MappingFieldRow[]> {
  const result = await client.query<MappingFieldRow>(
    `SELECT id,source_path,target_field,transform,required,confidence,evidence,transform_options,review_state
     FROM commerce_product_mapping_field
     WHERE tenant_id=$1 AND workspace_id=$2 AND mapping_revision_id=$3
     ORDER BY target_field`,
    [scope.tenantId, scope.workspaceId, mappingRevisionId],
  );
  return result.rows;
}

async function requireMappingRevision(
  client: PoolClient,
  scope: EnterpriseScope,
  mappingRevisionId: string,
): Promise<MappingRevisionRow> {
  const result = await client.query<MappingRevisionRow>(
    `SELECT id,source_id,import_run_id,source_schema_hash,status,mapping_document,
            proposal_idempotency_key,validation_idempotency_key
     FROM commerce_product_mapping_revision
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
    [scope.tenantId, scope.workspaceId, mappingRevisionId],
  );
  const row = result.rows[0];
  if (!row) throw new ProductCatalogError("产品字段映射不存在。", "PRODUCT_MAPPING_NOT_FOUND", 404);
  return row;
}

async function requireImportRow(client: PoolClient, scope: EnterpriseScope, importId: string): Promise<ImportRow> {
  const result = await client.query<ImportRow>(importSelectSql(), [scope.tenantId, scope.workspaceId, importId]);
  const row = result.rows[0];
  if (!row) throw new ProductCatalogError("产品导入批次不存在。", "PRODUCT_IMPORT_NOT_FOUND", 404);
  return row;
}

function importSelectSql(): string {
  return `SELECT id, source_id, file_name, status, total_records, imported_products,
                 imported_variants, issue_count, mapping_revision_id, source_schema_hash,
                 content_sha256,raw_storage_bytes,retention_until,raw_payload_purged_at,
                 activation_idempotency_key, root_thread_id, turn_id, tool_call_id, created_at
          FROM commerce_product_import_run
          WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`;
}

async function readSourceRecords(client: PoolClient, scope: EnterpriseScope, importId: string): Promise<SourceRecordRow[]> {
  const retained = await client.query<{ raw_payload_purged_at: Date | null }>(
    `SELECT raw_payload_purged_at FROM commerce_product_import_run
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 FOR SHARE`,
    [scope.tenantId, scope.workspaceId, importId],
  );
  if (!retained.rows[0]) {
    throw new ProductCatalogError("产品导入批次不存在。", "PRODUCT_IMPORT_NOT_FOUND", 404);
  }
  if (retained.rows[0].raw_payload_purged_at) {
    throw new ProductCatalogError(
      "原始产品载荷已按企业保留策略清理，不能再次检查、映射或发布。",
      "PRODUCT_IMPORT_RAW_PAYLOAD_PURGED",
      410,
    );
  }
  const result = await client.query<SourceRecordRow>(
    `SELECT id,ordinal,raw_payload FROM commerce_product_source_record
     WHERE tenant_id=$1 AND workspace_id=$2 AND import_run_id=$3 ORDER BY ordinal`,
    [scope.tenantId, scope.workspaceId, importId],
  );
  return result.rows;
}

async function findOrCreateFileSource(client: PoolClient, scope: EnterpriseScope, name: string): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `product-source:${scope.tenantId}:${scope.workspaceId}:${name.toLocaleLowerCase("en-US")}`,
  ]);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM commerce_product_source
     WHERE tenant_id=$1 AND workspace_id=$2 AND lower(name)=lower($3) AND status<>'archived'
     LIMIT 1`,
    [scope.tenantId, scope.workspaceId, name],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const definition = await client.query<{ id: string; connector_key: string; version: string; config_schema_hash: string }>(
    `SELECT id,connector_key,version,config_schema_hash
     FROM commerce_product_connector_definition
     WHERE connector_key='file_upload' AND version='1.0.0' AND status='active'`,
  );
  const connector = definition.rows[0];
  if (!connector) {
    throw new ProductCatalogError("文件导入连接器不可用。", "PRODUCT_FILE_CONNECTOR_UNAVAILABLE", 503);
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO commerce_product_source
      (tenant_id,workspace_id,source_kind,name,status,created_by_user_id,
       connector_key,connector_version,connector_definition_id,config_schema_hash,
       connection_state,public_config)
     VALUES ($1,$2,'file_upload',$3,'active',$4,$5,$6,$7,$8,'ready','{}'::jsonb)
     RETURNING id`,
    [scope.tenantId, scope.workspaceId, name, scope.userId,
      connector.connector_key, connector.version, connector.id, connector.config_schema_hash],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new ProductCatalogError("无法创建产品数据源。", "PRODUCT_SOURCE_CREATE_FAILED", 500);
  return id;
}

async function persistParserIssues(
  client: PoolClient,
  scope: EnterpriseScope,
  importId: string,
  recordIds: string[],
  issues: ProductImportIssue[],
): Promise<void> {
  for (const issue of issues) {
    await insertIssue(client, scope, {
      importId,
      sourceRecordId: issue.rowNumber ? recordIds[issue.rowNumber - 1] : null,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      sourceField: issue.field ?? null,
      details: issue.rowNumber ? { rowNumber: issue.rowNumber } : {},
    });
  }
}

async function insertIssue(
  client: PoolClient,
  scope: EnterpriseScope,
  issue: {
    importId: string;
    sourceRecordId?: string | null;
    mappingRevisionId?: string | null;
    severity: ProductImportIssue["severity"];
    code: string;
    sourceField?: string | null;
    message: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO commerce_product_import_issue (
      tenant_id,workspace_id,import_run_id,source_record_id,mapping_revision_id,
      severity,issue_code,source_field,message,details
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
    [scope.tenantId, scope.workspaceId, issue.importId, issue.sourceRecordId ?? null,
      issue.mappingRevisionId ?? null, issue.severity, issue.code, issue.sourceField ?? null,
      issue.message, JSON.stringify(issue.details ?? {})],
  );
}

async function readImportIssues(
  client: PoolClient,
  scope: EnterpriseScope,
  importId: string,
): Promise<ProductImportIssue[]> {
  const result = await client.query<{
    issue_code: string;
    message: string;
    severity: ProductImportIssue["severity"];
    source_field: string | null;
    details: { rowNumber?: unknown };
  }>(
    `SELECT issue_code,message,severity,source_field,details
     FROM commerce_product_import_issue
     WHERE tenant_id=$1 AND workspace_id=$2 AND import_run_id=$3
     ORDER BY created_at,id LIMIT 1000`,
    [scope.tenantId, scope.workspaceId, importId],
  );
  return result.rows.map((row) => ({
    code: row.issue_code,
    message: row.message,
    severity: row.severity,
    ...(typeof row.details?.rowNumber === "number" ? { rowNumber: row.details.rowNumber } : {}),
    ...(row.source_field ? { field: row.source_field } : {}),
  }));
}

async function refreshImportIssueCount(
  client: PoolClient,
  scope: EnterpriseScope,
  importId: string,
  status: "needs_review" | "validated",
  mappingRevisionId?: string,
): Promise<void> {
  await client.query(
    `UPDATE commerce_product_import_run SET status=$4,
       mapping_revision_id=COALESCE($5::uuid,mapping_revision_id),
       issue_count=(SELECT count(*) FROM commerce_product_import_issue issue
                    WHERE issue.tenant_id=$1 AND issue.workspace_id=$2 AND issue.import_run_id=$3)
     WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
    [scope.tenantId, scope.workspaceId, importId, status, mappingRevisionId ?? null],
  );
}

async function readCatalogStatus(client: PoolClient, scope: EnterpriseScope): Promise<ProductCatalogStatus> {
  const result = await client.query<{ id: string; status: string; updated_at: Date }>(
    `SELECT id,status,updated_at FROM commerce_product_import_run
     WHERE tenant_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 1`,
    [scope.tenantId, scope.workspaceId],
  );
  const row = result.rows[0];
  if (!row) return { status: "idle", latestImportId: null, updatedAt: null };
  return {
    status: row.status === "needs_review" ? "needs_review"
      : row.status === "failed" ? "error"
        : ["uploaded", "profiled", "validated", "importing"].includes(row.status) ? "importing"
          : "idle",
    latestImportId: row.id,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toProductSummary(row: ProductSummaryRow): ProductSummary {
  return {
    id: row.id,
    title: row.title,
    spu: row.internal_product_key,
    status: row.status,
    variantCount: Number.parseInt(row.variant_count ?? "0", 10),
    sourceName: row.source_name ?? "未命名数据源",
    updatedAt: row.updated_at.toISOString(),
    imageUrl: row.primary_image_url,
  };
}

function toImportResult(row: ImportRow): ProductImportResult {
  return {
    id: row.id,
    sourceId: row.source_id,
    fileName: row.file_name,
    status: row.status === "completed"
      ? "completed"
      : row.status === "validated"
        ? "ready_to_publish"
        : "needs_review",
    totalRecords: row.total_records,
    importedProducts: row.imported_products,
    importedVariants: row.imported_variants,
    issueCount: row.issue_count,
    mappingRevisionId: row.mapping_revision_id,
    rawPayloadAvailable: row.raw_payload_purged_at === null,
    retentionUntil: row.retention_until.toISOString(),
    estimatedStorageBytes: Number(row.raw_storage_bytes),
    createdAt: row.created_at.toISOString(),
  };
}

function estimateParsedImportStorage(parsed: ParsedProductImport): number {
  const serializedBytes = parsed.records.reduce(
    (total, record) => total + Buffer.byteLength(JSON.stringify(record), "utf8"),
    0,
  );
  const estimate = Math.max(
    parsed.contentBytes * 4,
    serializedBytes * 3 + parsed.records.length * 1024,
  );
  return Math.max(parsed.contentBytes, Math.ceil(estimate));
}

function collectRecordPaths(records: Array<Record<string, unknown>>): string[] {
  const paths = new Set<string>();
  for (const record of records.slice(0, 1000)) collectPaths(record, "", paths, 0);
  return [...paths].sort();
}

function collectPaths(value: unknown, parent: string, paths: Set<string>, depth: number): void {
  if (!isRecord(value) || depth > 20) return;
  for (const [key, child] of Object.entries(value)) {
    const path = `${parent}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (isRecord(child)) collectPaths(child, path, paths, depth + 1);
    else paths.add(path);
  }
}

function safeProfileSample(path: string, value: unknown): unknown {
  const lowerPath = path.toLocaleLowerCase("en-US");
  if (/token|secret|password|credential|authorization|cookie|手机号|电话|邮箱/.test(lowerPath)) return "[已脱敏]";
  if (typeof value === "string") {
    if (looksLikeSpreadsheetFormula(value)) return "[公式样式文本已阻止]";
    return value.normalize("NFKC").trim().slice(0, 160);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return `[数组 ${value.length} 项]`;
  return "[对象]";
}

function sanitizeModelMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  const allowed: Record<string, unknown> = {};
  for (const key of ["model", "provider", "toolContractVersion", "mappingPromptVersion"]) {
    const item = value[key];
    if ((typeof item === "string" && item.length <= 128) || (typeof item === "number" && Number.isSafeInteger(item))) {
      allowed[key] = item;
    }
  }
  return allowed;
}

function minimumConfidence(proposal: ProductMappingProposal): number | null {
  const values = proposal.fields.map((field) => field.confidence).filter((value): value is number => value !== null);
  return values.length ? Math.min(...values) : null;
}

function normalizeHarnessId(value: string | null | undefined, min: number, max: number): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductCatalogError("Harness lineage 标识无效。", "PRODUCT_MAPPING_LINEAGE_INVALID", 422);
  }
  return normalized;
}

function normalizeSourceName(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new ProductCatalogError("产品数据源名称无效。", "PRODUCT_SOURCE_NAME_INVALID", 422);
  }
  return normalized;
}

function normalizeProductIds(values: string[]): string[] {
  if (!Array.isArray(values) || !values.length || values.length > PRODUCT_CONTEXT_MAX_ITEMS) {
    throw new ProductCatalogError("一次必须选择 1 到 20 个产品。", "PRODUCT_CONTEXT_SIZE_INVALID", 400);
  }
  const unique = [...new Set(values)];
  if (unique.length !== values.length || unique.some((value) => !UUID_PATTERN.test(value))) {
    throw new ProductCatalogError("产品选择包含无效或重复标识。", "PRODUCT_CONTEXT_IDS_INVALID", 400);
  }
  return unique;
}

function normalizeSearch(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim() ?? "";
  if (normalized.length > 200) throw new ProductCatalogError("产品搜索词过长。", "PRODUCT_QUERY_INVALID", 400);
  return normalized || null;
}

function normalizeLimit(value: number | null | undefined): number {
  return Number.isInteger(value) ? Math.min(MAX_LIST_LIMIT, Math.max(1, value as number)) : DEFAULT_LIST_LIMIT;
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id }), "utf8").toString("base64url");
}

function decodeCursor(value: string | null | undefined): { updatedAt: string; id: string } | null {
  if (!value) return null;
  if (value.length > 500) throw new ProductCatalogError("产品分页游标无效。", "PRODUCT_CURSOR_INVALID", 400);
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof parsed.updatedAt !== "string" || Number.isNaN(new Date(parsed.updatedAt).getTime()) ||
        typeof parsed.id !== "string" || !UUID_PATTERN.test(parsed.id)) throw new Error("invalid");
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new ProductCatalogError("产品分页游标无效。", "PRODUCT_CURSOR_INVALID", 400);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new ProductCatalogError(`${label}无效。`, "PRODUCT_ID_INVALID", 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
