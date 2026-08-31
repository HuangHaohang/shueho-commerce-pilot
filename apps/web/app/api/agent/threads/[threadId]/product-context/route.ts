import { NextResponse } from "next/server";

import { AGENT_ID_PATTERN, requireAgentThreadContext } from "@/lib/agent/http";
import { getAgentThreadForUser } from "@/lib/agent/thread-ownership";
import { getLatestBoundProductContext } from "@/lib/product-catalog/repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
) {
  const { threadId } = await context.params;
  if (!AGENT_ID_PATTERN.test(threadId)) {
    return NextResponse.json(
      { error: "会话标识无效。", code: "PRODUCT_CONTEXT_THREAD_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }

  const access = await requireAgentThreadContext(request, threadId, "product_catalog.read");
  if (!access.ok) return access.response;

  const thread = await getAgentThreadForUser(threadId, access.context);
  if (!thread) {
    return NextResponse.json(
      { error: "会话不存在。", code: "PRODUCT_CONTEXT_THREAD_NOT_FOUND" },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  try {
    const result = await getLatestBoundProductContext(access.context, threadId);
    return NextResponse.json(
      {
        turnId: result.turnId,
        products: result.products.slice(0, 20).map((product) => ({
          id: product.id,
          title: product.title,
          spu: product.spu,
          status: product.status,
          variantCount: product.variantCount,
          sourceName: product.sourceName,
          updatedAt: product.updatedAt,
          imageUrl: product.imageUrl,
        })),
        resolvedAt: result.resolvedAt,
      },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    if (error instanceof ProductCatalogError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: noStoreHeaders() },
      );
    }
    return NextResponse.json(
      { error: "无法恢复任务的产品上下文。", code: "PRODUCT_CONTEXT_UNAVAILABLE" },
      { status: 503, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
