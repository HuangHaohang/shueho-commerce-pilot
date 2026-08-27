import { CommerceDataToolError } from "./commerce-data-tool-error.js";

export type MarketplacePlatformCatalog = Map<string, string>;

export function parseMarketplacePlatformCatalog(payload: Record<string, unknown>): MarketplacePlatformCatalog {
  const catalog = new Map<string, string>();
  if (!Array.isArray(payload.platforms)) return catalog;
  for (const item of payload.platforms) {
    if (!isRecord(item) || typeof item.platform !== "string" || typeof item.label !== "string") continue;
    const platform = item.platform.normalize("NFKC").trim().toUpperCase();
    const label = item.label.normalize("NFKC").trim();
    if (!/^[A-Z0-9_]{2,64}$/.test(platform) || !label) continue;
    catalog.set(platform, label.slice(0, 100));
  }
  return catalog;
}

export function assertMarketplacePlatformCatalogEntry(
  catalog: MarketplacePlatformCatalog | undefined,
  platform: string,
): void {
  if (!catalog) {
    throw new CommerceDataToolError(
      "商品研究前必须先读取当前可用平台目录。",
      "MARKETPLACE_PLATFORM_CATALOG_REQUIRED",
      "Call the free list_marketplace_research_platforms tool first. Build any platform question only from its exact returned platform ids and labels; do not use general knowledge or memory. No paid provider endpoint was dispatched.",
    );
  }
  const normalized = platform.normalize("NFKC").trim().toUpperCase();
  if (catalog.has(normalized)) return;
  const available = [...catalog.entries()].map(([id, label]) => `${label} (${id})`).join("、");
  throw new CommerceDataToolError(
    `平台 ${normalized || platform} 不在当前关键词商品研究目录中。当前可用：${available}。`,
    "MARKETPLACE_PLATFORM_UNAVAILABLE",
    "Use only an exact platform id returned by list_marketplace_research_platforms. Do not add the unavailable platform to a user question or research table, and do not dispatch a paid provider endpoint.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
