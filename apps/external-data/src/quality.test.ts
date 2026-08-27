import { describe, expect, it } from "vitest";

import { assessTextQuality, lexicalRelevance, parseSalesDisplay } from "./quality.js";

describe("external-data quality rules", () => {
  it("rejects concatenated provider noise without deleting its raw value", () => {
    const raw = "pu测试\t二手测试-cspu\u0007二手测试-新建\u0005二手测试2\u0005二手测试3\u0005Q10 PRO\u0003Q20";
    const decision = assessTextQuality(raw, { maxLength: 256, field: "brandName" });
    expect(decision.status).toBe("rejected");
    expect(decision.reasons).toContain("CONTROL_CHARACTERS");
    expect(decision.reasons).toContain("CATALOG_CONCATENATION");
    expect(raw).toContain("\u0007");
  });

  it("preserves open-ended sales buckets", () => {
    expect(parseSalesDisplay("1000+")).toEqual({
      display: "1000+",
      lowerBound: 1000,
      upperBound: null,
      qualifier: "gte",
    });
  });

  it("distinguishes a related product from cross-category contamination", () => {
    expect(lexicalRelevance("蘑菇勺", "", "厨房不锈钢汤勺蘑菇铲")).toBeGreaterThan(0);
    expect(lexicalRelevance("蘑菇勺", "", "高性能游戏笔记本电脑 RTX4070")).toBe(0);
  });
});
