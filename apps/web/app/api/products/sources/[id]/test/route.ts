import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import { testProductSourceConnection } from "@/lib/product-catalog/connector-repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

const testSourceSchema = z.object({ idempotencyKey: z.string().uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireAgentContext(request, "product_catalog.sources.manage");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "product_catalog.source.test", 20, 60);
  if (rateLimited) return rateLimited;
  const parsed = testSourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "连接测试请求无效。", code: "PRODUCT_SOURCE_TEST_REQUEST_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }
  try {
    const { id } = await context.params;
    const result = await testProductSourceConnection(access.context, {
      sourceId: id,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return NextResponse.json({ test: result.test, source: result.source }, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "产品数据源连接测试失败。", code: "PRODUCT_SOURCE_TEST_UNAVAILABLE" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
