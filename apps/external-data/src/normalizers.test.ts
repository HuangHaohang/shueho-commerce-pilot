import { describe, expect, it } from "vitest";

import { normalizeTaobaoSearch } from "./normalizers.js";

describe("Taobao search normalizer", () => {
  it("normalizes every returned list and isolates noisy facets", () => {
    const normalized = normalizeTaobaoSearch({
      code: 0,
      message: "ok",
      data: {
        code: 0,
        model: {
          page: { pageNo: 1, pageSize: 10, totalItems: 1 },
          success: true,
          itemList: [{
            itemId: 123,
            itemName: "蘑菇造型不锈钢汤勺",
            priceZKYuanDouble: 19.9,
            orderPayUV: "1000+",
            shopName: "测试店铺",
          }],
          brandList: [{ brandId: 1, brandName: "正常品牌", count: 1 }, { brandId: 2, brandName: "坏值\u0002电脑\u0003手机\u0004图书\u0005测试\u0006更多", count: 0 }],
          propertyList: [{
            pid: 20021,
            pname: "材质",
            valueList: [{ vid: 1, vname: "304不锈钢", count: 1 }, { vid: 2, vname: `污染${"x".repeat(300)}`, count: 0 }],
          }],
          traceList: [{ stage: "search" }],
          extraMap: { source: "fixture" },
        },
      },
    });
    expect(normalized.items).toHaveLength(1);
    expect(normalized.items[0]?.salesQualifier).toBe("gte");
    expect(normalized.brands).toHaveLength(2);
    expect(normalized.brands[1]?.quality.status).toBe("rejected");
    expect(normalized.properties[0]?.values).toHaveLength(2);
    expect(normalized.properties[0]?.values[1]?.quality.status).toBe("rejected");
    expect(normalized.traces).toHaveLength(1);
  });
});
