import assert from "node:assert/strict";
import test from "node:test";

import { CommerceDataToolError } from "./commerce-data-tool-error.js";
import {
  assertMarketplacePlatformCatalogEntry,
  parseMarketplacePlatformCatalog,
} from "./marketplace-platform-catalog.js";

test("accepts only exact database-returned marketplace workflow ids", () => {
  const catalog = parseMarketplacePlatformCatalog({
    platforms: [
      { platform: "taobao", label: "淘宝和天猫" },
      { platform: "douyin_ec", label: "抖音电商" },
      { platform: "", label: "invalid" },
      { platform: "PINDUODUO", label: "" },
    ],
  });
  assert.deepEqual([...catalog.entries()], [
    ["TAOBAO", "淘宝和天猫"],
    ["DOUYIN_EC", "抖音电商"],
  ]);
  assert.doesNotThrow(() => assertMarketplacePlatformCatalogEntry(catalog, "douyin_ec"));
  assert.throws(
    () => assertMarketplacePlatformCatalogEntry(catalog, "DOUYIN"),
    (error: unknown) => error instanceof CommerceDataToolError &&
      error.code === "MARKETPLACE_PLATFORM_UNAVAILABLE" &&
      error.message.includes("DOUYIN_EC"),
  );
  assert.throws(
    () => assertMarketplacePlatformCatalogEntry(catalog, "PINDUODUO"),
    (error: unknown) => error instanceof CommerceDataToolError &&
      error.code === "MARKETPLACE_PLATFORM_UNAVAILABLE",
  );
});

test("requires the free platform catalog before marketplace options or research", () => {
  assert.throws(
    () => assertMarketplacePlatformCatalogEntry(undefined, "TAOBAO"),
    (error: unknown) => error instanceof CommerceDataToolError &&
      error.code === "MARKETPLACE_PLATFORM_CATALOG_REQUIRED" &&
      error.instruction.includes("list_marketplace_research_platforms"),
  );
});
