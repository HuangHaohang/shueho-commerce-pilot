import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import { authorizeProductCatalogAction } from "@/lib/product-catalog/authorization";
import {
  activateProductImport,
  inspectProductImport,
} from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

const activateImportSchema = z.object({
  mappingRevisionId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  confirmation: z.literal("publish"),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ importId: string }> },
) {
  const access = await requireAgentContext(request, "product_catalog.review");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(
    access.context,
    "product_catalog.import.activate",
    10,
    60,
  );
  if (rateLimited) return rateLimited;

  const { importId } = await context.params;
  const parsedId = z.string().uuid().safeParse(importId);
  const parsedBody = activateImportSchema.safeParse(await request.json().catch(() => null));
  if (!parsedId.success || !parsedBody.success) {
    return NextResponse.json(
      { error: "产品发布请求无效。", code: "PRODUCT_IMPORT_ACTIVATION_REQUEST_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  try {
    const [canImport, canReview] = await Promise.all([
      authorizeProductCatalogAction(access.context, "product_catalog.import"),
      authorizeProductCatalogAction(access.context, "product_catalog.review"),
    ]);
    if (!canImport || !canReview) {
      return NextResponse.json(
        { error: "产品发布权限在写入前已失效。", code: "PRODUCT_CATALOG_FORBIDDEN" },
        { status: 403, headers: noStoreHeaders() },
      );
    }
    const activated = await activateProductImport(access.context, {
      importId: parsedId.data,
      mappingRevisionId: parsedBody.data.mappingRevisionId,
      idempotencyKey: parsedBody.data.idempotencyKey,
    });
    const readback = await inspectProductImport(access.context, parsedId.data);
    return NextResponse.json(
      { import: activated, issues: readback.issues },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "无法发布产品导入。", code: "PRODUCT_IMPORT_ACTIVATION_UNAVAILABLE" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
