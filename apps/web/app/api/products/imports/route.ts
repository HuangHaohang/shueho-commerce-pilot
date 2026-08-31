import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import { requireBoundedContentLength } from "@/lib/http/content-length";
import { parseProductImportBuffer } from "@/lib/product-catalog/import-parser";
import { createProductImport } from "@/lib/product-catalog/repository";
import { PRODUCT_IMPORT_MAX_BYTES, ProductCatalogError } from "@/lib/product-catalog/types";
import { parseProductMappingProposal } from "@/lib/product-catalog/validation";

const MULTIPART_OVERHEAD_BYTES = 256 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "product_catalog.import");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "product_catalog.import", 10, 60);
  if (rateLimited) return rateLimited;
  const length = requireBoundedContentLength(request.headers, PRODUCT_IMPORT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (!length.ok) {
    return errorResponse(
      length.code === "CONTENT_LENGTH_REQUIRED" ? "产品导入必须声明请求长度。" : "产品导入请求长度无效或超过上限。",
      length.code,
      length.status,
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) {
    return errorResponse("产品导入必须使用 multipart 表单。", "PRODUCT_IMPORT_MULTIPART_REQUIRED", 415);
  }
  try {
    const form = await request.formData().catch(() => null);
    if (!form) return errorResponse("产品导入表单无效。", "PRODUCT_IMPORT_FORM_INVALID", 400);
    const files = form.getAll("file").filter((item): item is File => item instanceof File);
    if (files.length !== 1) return errorResponse("请选择一个 CSV 或 JSON 产品文件。", "PRODUCT_IMPORT_FILE_REQUIRED", 400);
    const file = files[0];
    if (file.size < 1 || file.size > PRODUCT_IMPORT_MAX_BYTES) {
      return errorResponse("产品文件必须在 1 字节到 5 MiB 之间。", "PRODUCT_IMPORT_SIZE_INVALID", 413);
    }
    const idempotencyValues = form.getAll("idempotencyKey");
    const idempotencyValue = idempotencyValues[0];
    if (idempotencyValues.length !== 1 || typeof idempotencyValue !== "string" || !UUID_PATTERN.test(idempotencyValue)) {
      return errorResponse("导入幂等键必须是 UUID。", "PRODUCT_IMPORT_IDEMPOTENCY_INVALID", 400);
    }
    const sourceNameValue = form.get("sourceName");
    if (sourceNameValue !== null && typeof sourceNameValue !== "string") {
      return errorResponse("产品数据源名称无效。", "PRODUCT_SOURCE_NAME_INVALID", 400);
    }
    const mappingValue = form.get("mapping");
    let mapping = null;
    if (mappingValue !== null) {
      if (typeof mappingValue !== "string" || mappingValue.length > 32_768) {
        return errorResponse("产品映射提案无效。", "PRODUCT_MAPPING_INVALID", 400);
      }
      try {
        mapping = parseProductMappingProposal(JSON.parse(mappingValue));
      } catch (error) {
        if (error instanceof ProductCatalogError) throw error;
        return errorResponse("产品映射提案不是有效 JSON。", "PRODUCT_MAPPING_INVALID", 400);
      }
    }
    const parsed = parseProductImportBuffer({
      bytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      declaredContentType: file.type,
    });
    const result = await createProductImport(access.context, {
      parsed,
      sourceName: typeof sourceNameValue === "string" ? sourceNameValue : null,
      idempotencyKey: idempotencyValue,
      mapping,
      activateIfValid: false,
    });
    return NextResponse.json(
      { import: result.import, issues: result.issues },
      { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return errorResponse("无法导入产品数据。", "PRODUCT_IMPORT_UNAVAILABLE", 503);
  }
}

function errorResponse(error: string, code: string, status: number): NextResponse {
  return NextResponse.json({ error, code }, { status, headers: { "Cache-Control": "no-store" } });
}
