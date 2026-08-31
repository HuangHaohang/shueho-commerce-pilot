import { NextResponse } from "next/server";
import { z } from "zod";

import { isAuthorizedGatewayCallback } from "@/lib/agent/internal-auth";
import {
  runtimeTenantAllows,
  RuntimeTenantConfigurationError,
} from "@/lib/enterprise/runtime-tenant";
import {
  authorizeProductCatalogAction,
  recordProductCatalogManagementApprovalEvidence,
} from "@/lib/product-catalog/authorization";
import { parseProductImportBuffer } from "@/lib/product-catalog/import-parser";
import { createProductImport } from "@/lib/product-catalog/repository";
import {
  PRODUCT_IMPORT_MAX_BYTES,
  ProductCatalogError,
} from "@/lib/product-catalog/types";
import { requireBoundedContentLength } from "@/lib/http/content-length";

const MAX_MULTIPART_BYTES = PRODUCT_IMPORT_MAX_BYTES + 64 * 1024;

const metadataSchema = z.object({
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId: z.string().min(1).max(255),
  rootThreadId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  action: z.literal("create_import_from_artifact"),
  artifactId: z.string().uuid(),
  artifactChecksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceName: z.string().trim().min(1).max(160).nullable(),
  idempotencyKey: z.string().uuid(),
  approvalRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  approvalItemId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  turnId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),
  approvedAt: z.string().datetime(),
}).strict();

export async function POST(request: Request) {
  if (!isAuthorizedGatewayCallback(request)) {
    return NextResponse.json({ error: "Unauthorized product-import callback." }, { status: 401 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return responseError("Product-import artifact request must be multipart.", "PRODUCT_IMPORT_MULTIPART_REQUIRED", 415);
  }
  const length = requireBoundedContentLength(request.headers, MAX_MULTIPART_BYTES);
  if (!length.ok) {
    return responseError(
      "Product-import artifact request length is missing, invalid, or too large.",
      length.code,
      length.status,
    );
  }
  const form = await request.formData().catch(() => null);
  if (!form || form.getAll("metadata").length !== 1 || form.getAll("file").length !== 1) {
    return responseError("Invalid product-import artifact request.", "PRODUCT_IMPORT_ARTIFACT_INVALID", 400);
  }
  const keys = [...new Set(Array.from(form.keys()))];
  if (keys.length !== 2 || !keys.includes("metadata") || !keys.includes("file")) {
    return responseError("Invalid product-import artifact request.", "PRODUCT_IMPORT_ARTIFACT_INVALID", 400);
  }
  const metadataValue = form.get("metadata");
  const file = form.get("file");
  if (typeof metadataValue !== "string" || Buffer.byteLength(metadataValue, "utf8") > 32 * 1024) {
    return responseError("Invalid product-import artifact request.", "PRODUCT_IMPORT_ARTIFACT_INVALID", 400);
  }
  const metadata = metadataSchema.safeParse(
    parseJson(metadataValue),
  );
  if (!metadata.success || !(file instanceof File) || !file.size || file.size > PRODUCT_IMPORT_MAX_BYTES) {
    return responseError("Invalid product-import artifact request.", "PRODUCT_IMPORT_ARTIFACT_INVALID", 400);
  }
  try {
    if (!runtimeTenantAllows(metadata.data.tenantId)) {
      return responseError(
        "Product-import tenant is not assigned to this Web runtime.",
        "PRODUCT_IMPORT_TENANT_MISMATCH",
        404,
      );
    }
  } catch (error) {
    if (error instanceof RuntimeTenantConfigurationError) {
      return responseError(
        "Product-import runtime tenant is not configured.",
        "PRODUCT_IMPORT_TENANT_UNCONFIGURED",
        503,
      );
    }
    throw error;
  }
  const scope = {
    tenantId: metadata.data.tenantId,
    workspaceId: metadata.data.workspaceId,
    userId: metadata.data.userId,
    rootThreadId: metadata.data.rootThreadId,
  };
  try {
    if (!(await authorizeProductCatalogAction(scope, "product_catalog.import"))) {
      return responseError("Product import is not authorized.", "PRODUCT_CATALOG_FORBIDDEN", 403);
    }
    const parsed = await parseProductImportBuffer({
      fileName: file.name,
      declaredContentType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    if (parsed.contentSha256 !== metadata.data.artifactChecksumSha256) {
      throw new ProductCatalogError(
        "产品文件在导入边界校验失败。",
        "PRODUCT_IMPORT_ARTIFACT_CHECKSUM_MISMATCH",
        409,
      );
    }
    await recordProductCatalogManagementApprovalEvidence(scope, {
      action: "create_import_from_artifact",
      targetType: "thread_artifact",
      targetId: metadata.data.artifactId,
      idempotencyKey: metadata.data.idempotencyKey,
      approvalRequestId: metadata.data.approvalRequestId,
      approvalItemId: metadata.data.approvalItemId,
      turnId: metadata.data.turnId,
      approvedAt: metadata.data.approvedAt,
    });
    if (!(await authorizeProductCatalogAction(scope, "product_catalog.import"))) {
      throw new ProductCatalogError("产品导入权限在写入前已失效。", "PRODUCT_CATALOG_FORBIDDEN", 403);
    }
    const result = await createProductImport(scope, {
      parsed,
      sourceName: metadata.data.sourceName,
      idempotencyKey: metadata.data.idempotencyKey,
    });
    return NextResponse.json({ result }, {
      status: result.duplicate ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return responseError("Product-import artifact request failed.", "PRODUCT_IMPORT_ARTIFACT_FAILED", 503);
  }
}

function responseError(error: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error, code }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
