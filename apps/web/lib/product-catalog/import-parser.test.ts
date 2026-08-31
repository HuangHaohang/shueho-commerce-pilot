import { describe, expect, it } from "vitest";

import { parseProductImportBuffer, readSourcePath } from "@/lib/product-catalog/import-parser";
import { ProductCatalogError } from "@/lib/product-catalog/types";

const encoder = new TextEncoder();

describe("product import parser", () => {
  it("parses quoted CSV while preserving every source field", () => {
    const parsed = parseProductImportBuffer({
      bytes: encoder.encode('spu,title,sku,description\r\nP-1,"通勤包, 黑色",SKU-1,"第一行\n第二行"\r\n'),
      fileName: "products.csv",
      declaredContentType: "text/csv",
    });

    expect(parsed.records).toEqual([{
      spu: "P-1",
      title: "通勤包, 黑色",
      sku: "SKU-1",
      description: "第一行\n第二行",
    }]);
    expect(parsed.fields).toEqual(["/description", "/sku", "/spu", "/title"]);
    expect(parsed.contentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("retains formula-like cells but emits a blocking issue", () => {
    const parsed = parseProductImportBuffer({
      bytes: encoder.encode('spu,title\nP-1,"=HYPERLINK(""https://bad.test"")"\n'),
      fileName: "products.csv",
    });

    expect(parsed.records[0]?.title).toContain("=HYPERLINK");
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "FORMULA_LIKE_CELL", severity: "error", rowNumber: 1, field: "/title" }),
    ]));
  });

  it("supports bounded nested JSON pointers", () => {
    const parsed = parseProductImportBuffer({
      bytes: encoder.encode(JSON.stringify([{ product: { code: "P-1", title: "水杯" } }])),
      fileName: "products.json",
      declaredContentType: "application/json",
    });

    expect(parsed.fields).toEqual(["/product/code", "/product/title"]);
    expect(readSourcePath(parsed.records[0] ?? {}, "/product/title")).toBe("水杯");
  });

  it("rejects excessive JSON depth", () => {
    let value: Record<string, unknown> = { title: "底部" };
    for (let index = 0; index < 22; index += 1) value = { nested: value };

    expect(() => parseProductImportBuffer({
      bytes: encoder.encode(JSON.stringify([value])),
      fileName: "products.json",
    })).toThrowError(ProductCatalogError);
  });
});
