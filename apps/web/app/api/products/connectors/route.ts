import { NextResponse } from "next/server";

import { requireAgentContext } from "@/lib/agent/http";
import { listProductConnectors } from "@/lib/product-catalog/connector-repository";
import { ProductCatalogError } from "@/lib/product-catalog/types";

export async function GET(request: Request) {
  const access = await requireAgentContext(request, "product_catalog.read");
  if (!access.ok) return access.response;
  try {
    const connectors = await listProductConnectors(access.context);
    return NextResponse.json({
      connectors: connectors.map((connector) => ({
        ...connector,
        secretReference: {
          required: connector.secretReference.required,
          allowedSchemes: connector.secretReference.allowedSchemes,
        },
      })),
      permission: { canManageSources: access.context.permissions.has("product_catalog.sources.manage") },
    }, { headers: noStoreHeaders() });
  } catch (error) {
    return productConnectorError(error, "无法读取产品连接器目录。");
  }
}

function productConnectorError(error: unknown, fallback: string): NextResponse {
  if (error instanceof ProductCatalogError) {
    return NextResponse.json({ error: error.message, code: error.code }, {
      status: error.status,
      headers: noStoreHeaders(),
    });
  }
  return NextResponse.json({ error: fallback, code: "PRODUCT_CONNECTOR_CATALOG_UNAVAILABLE" }, {
    status: 503,
    headers: noStoreHeaders(),
  });
}

function noStoreHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" };
}
