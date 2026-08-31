import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { inspectProductImport, listProductImports } from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "product_catalog.read");
  if (!access.ok) return access.response;

  try {
    const listed = await listProductImports(access.context, { limit: 1 });
    const latest = listed.imports[0];
    if (!latest) {
      return NextResponse.json({ latest: null }, { headers: noStoreHeaders() });
    }

    const inspection = await inspectProductImport(access.context, latest.id);
    return NextResponse.json({
      latest: {
        import: inspection.import,
        fields: inspection.fields.map((field) => ({
          path: field.path,
          observedTypes: field.observedTypes,
          presentCount: field.presentCount,
        })),
        issues: inspection.issues,
      },
    }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "无法读取最新产品导入批次。", code: "PRODUCT_IMPORT_LATEST_UNAVAILABLE" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
