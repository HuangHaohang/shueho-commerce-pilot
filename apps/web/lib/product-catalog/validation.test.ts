import { describe, expect, it } from "vitest";

import {
  buildDeterministicProductMapping,
  normalizeProductRecord,
  parseProductMappingProposal,
  validateProductMappingAgainstSchema,
} from "@/lib/product-catalog/validation";

describe("product mapping validation", () => {
  it("builds a deterministic Product/SKU mapping for common commerce headers", () => {
    const mapping = buildDeterministicProductMapping(["/spu", "/title", "/sku", "/brand"]);

    expect(mapping?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "/spu", targetField: "product.key", required: true }),
      expect.objectContaining({ sourcePath: "/title", targetField: "product.title", required: true }),
      expect.objectContaining({ sourcePath: "/sku", targetField: "variant.sku" }),
    ]));
  });

  it("rejects executable transforms and duplicate targets", () => {
    expect(() => parseProductMappingProposal({
      fields: [
        { sourcePath: "/spu", targetField: "product.key", transform: "javascript", required: true },
        { sourcePath: "/title", targetField: "product.title", transform: "nfkc", required: true },
      ],
    })).toThrow();

    expect(() => parseProductMappingProposal({
      fields: [
        { sourcePath: "/spu", targetField: "product.key", transform: "nfkc", required: true },
        { sourcePath: "/other", targetField: "product.key", transform: "nfkc", required: true },
        { sourcePath: "/title", targetField: "product.title", transform: "nfkc", required: true },
      ],
    })).toThrow();
  });

  it("fails closed when a mapping references an absent field", () => {
    const mapping = parseProductMappingProposal({
      fields: [
        { sourcePath: "/spu", targetField: "product.key", transform: "nfkc", required: true },
        { sourcePath: "/title", targetField: "product.title", transform: "nfkc", required: true },
      ],
    });

    expect(validateProductMappingAgainstSchema(mapping, new Set(["/spu"]))).toEqual([
      expect.objectContaining({ code: "MAPPING_SOURCE_FIELD_UNKNOWN", field: "/title" }),
    ]);
  });

  it("never promotes formula-like source text", () => {
    const mapping = buildDeterministicProductMapping(["/spu", "/title"]);
    expect(mapping).not.toBeNull();

    const normalized = normalizeProductRecord({ spu: "P-1", title: "=CMD()" }, mapping!, 1);
    expect(normalized.value).toBeNull();
    expect(normalized.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MAPPED_FORMULA_LIKE_CELL", severity: "error" }),
    ]));
  });
});
