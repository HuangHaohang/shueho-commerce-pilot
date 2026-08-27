import { describe, expect, it } from "vitest";

import { buildQueryIdentity, canonicalJson } from "./canonical.js";

describe("stable external-data identities", () => {
  it("produces the same query key for reordered params and separates pagination", () => {
    const first = buildQueryIdentity({
      endpointId: "taobao.search_item_list_v1",
      schemaVersion: "v1",
      platform: "taobao",
      requestText: "帮我调研淘宝上蘑菇勺的价格带和销量量级",
      topN: 50,
      params: { keyword: " 蘑菇勺 ", page: 1, tmall: false, sort: "_sale" },
    });
    const second = buildQueryIdentity({
      endpointId: "taobao.search_item_list_v1",
      schemaVersion: "v1",
      platform: "taobao",
      requestText: "帮我调研淘宝上蘑菇勺的价格带和销量量级",
      topN: 50,
      params: { sort: "_sale", tmall: false, page: 2, keyword: "蘑菇勺" },
    });
    expect(first.queryKey).toBe(second.queryKey);
    expect(first.pageKey).not.toBe(second.pageKey);
    expect(first.intent.metrics).toEqual(["price_band", "sales_level"]);
    expect(first.canonicalQueryParams).toMatchObject({ keyword: "蘑菇勺", sort: "_sale", tmall: false, top_n: 50 });
    const paraphrase = buildQueryIdentity({
      endpointId: "taobao.search_item_list_v1",
      schemaVersion: "v1",
      platform: "taobao",
      requestText: "研究淘宝蘑菇勺售价区间以及热销商品的销售量",
      topN: 50,
      params: { keyword: "蘑菇勺", page: 1, tmall: false, sort: "_sale" },
    });
    expect(paraphrase.intentKey).toBe(first.intentKey);
  });

  it("uses canonical object-key ordering", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });
});
