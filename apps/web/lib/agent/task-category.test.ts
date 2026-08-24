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
  });

  it("uses the persisted Spark classification when present", () => {
    expect(resolveTaskCategory({ category: "research", recipeId: null, title: "轻量通勤包分析" })).toBe("research");
  });

  it("classifies legacy rows conservatively and keeps unknown chat general", () => {
    expect(resolveTaskCategory({ category: null, recipeId: null, title: "通勤包竞品趋势" })).toBe("research");
    expect(resolveTaskCategory({ category: null, recipeId: null, title: "你好啊" })).toBe("general");
  });
});
