import { describe, expect, it } from "vitest";

import { resolveTaskCategory } from "./task-category";

describe("task category resolution", () => {
  it("uses persisted Recipe identity before generated-title text", () => {
    expect(
      resolveTaskCategory({
        category: null,
        recipeId: "copywriting",
        title: "轻量通勤双肩包小红书文案",
      }),
    ).toBe("creative");
    expect(
      resolveTaskCategory({
        category: "general",
        recipeId: "market_research",
        title: "轻量通勤双肩包",
      }),
    ).toBe("research");
  });

  it("uses the persisted Spark classification when present", () => {
    expect(resolveTaskCategory({ category: "research", recipeId: null, title: "轻量通勤包分析" })).toBe("research");
  });

  it("corrects Spark classifications when the generated title has a strong domain signal", () => {
    expect(
      resolveTaskCategory({
        category: "support",
        recipeId: null,
        title: "中文电商文案助手用途说明",
      }),
    ).toBe("creative");
    expect(
      resolveTaskCategory({
        category: "support",
        recipeId: null,
        title: "电商技能创建所需信息清单",
      }),
    ).toBe("general");
    expect(resolveTaskCategory({ category: "creative", recipeId: null, title: "售后回复文案" })).toBe("support");
  });

  it("classifies legacy rows conservatively and keeps unknown chat general", () => {
    expect(resolveTaskCategory({ category: null, recipeId: null, title: "通勤包竞品趋势" })).toBe("research");
    expect(resolveTaskCategory({ category: null, recipeId: null, title: "你好啊" })).toBe("general");
  });
});
