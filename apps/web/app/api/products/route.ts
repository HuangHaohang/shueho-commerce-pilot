import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { listProducts } from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "product_catalog.read");
  if (!access.ok) return access.response;
  try {
    const url = new URL(request.url);
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return NextResponse.json(
        { error: "产品分页数量必须在 1 到 100 之间。", code: "PRODUCT_LIMIT_INVALID" },
        { status: 400, headers: noStoreHeaders() },
      );
    }
    const result = await listProducts(access.context, {
      query: url.searchParams.get("query"),
      limit,
      cursor: url.searchParams.get("cursor"),
    });
    return NextResponse.json({
      ...result,
      permission: {
        canRead: true,
        canImport: access.context.permissions.has("product_catalog.import"),
        canReview: access.context.permissions.has("product_catalog.review"),
        canManageSources: access.context.permissions.has("product_catalog.sources.manage"),
      },
    }, { headers: noStoreHeaders() });
  } catch (error) {
    return productErrorResponse(error, "无法读取产品库。");
  }
}

function productErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof ProductCatalogError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
      { status: error.status, headers: noStoreHeaders() },
    );
  }
  return NextResponse.json({ error: fallback, code: "PRODUCT_CATALOG_UNAVAILABLE" }, {
    status: 503,
    headers: noStoreHeaders(),
  });
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
