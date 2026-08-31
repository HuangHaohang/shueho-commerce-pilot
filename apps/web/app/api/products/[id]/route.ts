import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { getProduct } from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAgentContext(request, "product_catalog.read");
  if (!access.ok) return access.response;
  try {
    const { id } = await context.params;
    const product = await getProduct(access.context, id);
    if (!product) {
      return NextResponse.json(
        { error: "产品不存在。", code: "PRODUCT_NOT_FOUND" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ product }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "无法读取产品详情。", code: "PRODUCT_CATALOG_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
