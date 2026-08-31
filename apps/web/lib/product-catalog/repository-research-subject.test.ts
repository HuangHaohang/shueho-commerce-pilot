import { describe, expect, it } from "vitest";

import { productResearchSnapshotSha256 } from "@/lib/product-catalog/repository";
import type { ProductDetail } from "@/lib/product-catalog/types";

const subjectRef = "77777777-7777-4777-8777-777777777777";

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    revisionId: "44444444-4444-4444-8444-444444444444",
    title: "耐热砂锅",
    spu: "POT-1",
    status: "active",
    variantCount: 1,
    sourceName: "ERP",
    updatedAt: "2026-08-31T00:00:00.000Z",
    imageUrl: "https://example.com/pot.jpg",
    description: "适合家庭炖煮",
    brandName: "示例品牌",
    categoryPath: "厨具/锅具/砂锅",
    attributes: { material: "陶瓷", capacity: "3L" },
    revisionNumber: 2,
    variants: [{
      id: "55555555-5555-4555-8555-555555555555",
      variantRevisionId: "66666666-6666-4666-8666-666666666666",
      sku: "POT-3L",
      title: "3L",
      status: "active",
      gtin: null,
      optionValues: { capacity: "3L" },
      revisionNumber: 2,
    }],
    sources: [{
      id: "88888888-8888-4888-8888-888888888888",
      name: "ERP",
      sourceKind: "api",
      externalProductKey: "external-pot-1",
      lastSeenAt: "2026-08-31T00:00:00.000Z",
    }],
    ...overrides,
  };
}

describe("product research subject snapshot hash", () => {
  it("is stable when mutable status and source readback change", () => {
    const first = productResearchSnapshotSha256(subjectRef, [product()]);
    const second = productResearchSnapshotSha256(subjectRef, [product({
      status: "archived",
      sourceName: "另一个展示名称",
      updatedAt: "2026-09-01T00:00:00.000Z",
      sources: [{
        id: "99999999-9999-4999-8999-999999999999",
        name: "另一个来源",
        sourceKind: "file",
        externalProductKey: "changed",
        lastSeenAt: "2026-09-01T00:00:00.000Z",
      }],
      variants: [{ ...product().variants[0]!, status: "archived" }],
    })]);
    expect(second).toBe(first);
  });

  it("changes when an immutable revision fact changes", () => {
    const first = productResearchSnapshotSha256(subjectRef, [product()]);
    const second = productResearchSnapshotSha256(subjectRef, [product({ title: "另一份 revision 标题" })]);
    expect(second).not.toBe(first);
  });
});
