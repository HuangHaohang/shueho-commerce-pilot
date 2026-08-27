import { describe, expect, it } from "vitest";

import { searchActivityLabel, summarizeSearchActivities } from "./search-activity-presentation";

describe("search activity presentation", () => {
  it("summarizes repeated search rows once and keeps the failed count", () => {
    expect(summarizeSearchActivities([
      { kind: "search", status: "completed", sources: Array.from({ length: 7 }) },
      { kind: "search", status: "failed" },
      { kind: "search", status: "failed" },
      { kind: "search", status: "failed" },
    ])).toBe("完成了 4 次搜索 · 3 次未完成");
  });

  it("uses informative inner labels instead of repeating completion text", () => {
    expect(searchActivityLabel({ kind: "search", status: "completed", sources: Array.from({ length: 7 }) }))
      .toBe("7 个来源");
    expect(searchActivityLabel({ kind: "search", status: "failed" })).toBe("搜索未完成");
    expect(searchActivityLabel({ kind: "search", status: "completed" })).toBe("未返回可用来源");
  });
});
