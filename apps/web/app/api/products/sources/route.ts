import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAgentContext } from "@/lib/agent/http";
import { enforceEnterpriseRateLimit } from "@/lib/enterprise/rate-limit";
import {
  createProductSource,
  listProductSources,
} from "@/lib/product-catalog/connector-repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

const createSourceSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  connectorKey: z.string().regex(/^[a-z0-9][a-z0-9_.-]{1,79}$/),
  connectorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  publicConfig: z.record(z.unknown()).refine((value) => Object.keys(value).length <= 20),
  secretReference: z.string().regex(/^broker:psh_[A-Za-z0-9_-]{32,64}$/).nullable().optional(),
}).strict();

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "product_catalog.read");
  if (!access.ok) return access.response;
  try {
    const sources = await listProductSources(access.context);
    return NextResponse.json({
      sources,
      permission: { canManageSources: access.context.permissions.has("product_catalog.sources.manage") },
    }, { headers: noStoreHeaders() });
  } catch (error) {
    return productSourceError(error, "无法读取产品数据源。");
  }
}

export async function POST(request: Request) {
  const access = await requireAgentContext(request, "product_catalog.sources.manage");
  if (!access.ok) return access.response;
  const rateLimited = await enforceEnterpriseRateLimit(access.context, "product_catalog.source.create", 20, 60);
  if (rateLimited) return rateLimited;
  const parsed = createSourceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "产品数据源配置无效。", code: "PRODUCT_SOURCE_REQUEST_INVALID" },
      { status: 400, headers: noStoreHeaders() },
    );
  }
  try {
    const result = await createProductSource(access.context, {
      ...parsed.data,
      secretReference: parsed.data.secretReference ?? null,
    });
    return NextResponse.json({ source: result.source }, {
      status: result.duplicate ? 200 : 201,
      headers: noStoreHeaders(),
    });
  } catch (error) {
    return productSourceError(error, "无法创建产品数据源。");
  }
}

function productSourceError(error: unknown, fallback: string): NextResponse {
  if (error instanceof ProductCatalogError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.issues.length ? { issues: error.issues } : {}) },
      { status: error.status, headers: noStoreHeaders() },
    );
  }
  return NextResponse.json({ error: fallback, code: "PRODUCT_SOURCE_UNAVAILABLE" }, {
    status: 503,
    headers: noStoreHeaders(),
  });
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
