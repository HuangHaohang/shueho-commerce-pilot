import { describe, expect, it } from "vitest";

import {
  categoryForRecipeId,
  isAgentWorkflowId,
  isWorkflowAllowedForRecipeId,
  recipeIdForWorkflow,
  resolveTaskCategory,
} from "./task-category";

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
    expect(
      resolveTaskCategory({
        category: "research",
        recipeId: "creative_project",
        title: "竞品趋势调研",
      }),
    ).toBe("creative");
    expect(
      resolveTaskCategory({
        category: "general",
        recipeId: "product_onboarding",
        title: "接入企业产品库",
      }),
    ).toBe("operations");
  });

  it("maps the fixed browser workflow enum to persisted Recipe identity", () => {
    expect(isAgentWorkflowId("commerce-copywriting")).toBe(true);
    expect(isAgentWorkflowId("commerce-market-research")).toBe(true);
    expect(isAgentWorkflowId("commerce-product-insight")).toBe(true);
    expect(isAgentWorkflowId("commerce-creative-project")).toBe(true);
    expect(isAgentWorkflowId("commerce-product-onboarding")).toBe(true);
    expect(isAgentWorkflowId("creative_project")).toBe(false);
    expect(isAgentWorkflowId("commerce-arbitrary-workflow")).toBe(false);

    expect(recipeIdForWorkflow("commerce-copywriting")).toBe("copywriting");
    expect(recipeIdForWorkflow("commerce-market-research")).toBe("market_research");
    expect(recipeIdForWorkflow("commerce-product-insight", "new_product_development")).toBe("new_product_development");
    expect(recipeIdForWorkflow("commerce-product-insight", "product_retrospective")).toBe("product_retrospective");
    expect(recipeIdForWorkflow("commerce-product-insight")).toBeNull();
    expect(recipeIdForWorkflow("commerce-creative-project")).toBe("creative_project");
    expect(recipeIdForWorkflow("commerce-product-onboarding")).toBe("product_onboarding");
    expect(recipeIdForWorkflow(undefined)).toBeNull();

    expect(categoryForRecipeId("creative_project")).toBe("creative");
    expect(categoryForRecipeId("product_onboarding")).toBe("operations");
    expect(categoryForRecipeId("new_product_development")).toBe("research");
    expect(categoryForRecipeId("product_retrospective")).toBe("research");
  });

  it("binds each persisted Recipe to its server-owned workflow contract", () => {
    expect(isWorkflowAllowedForRecipeId("creative_project", "commerce-creative-project")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("creative_project", "commerce-market-research")).toBe(false);
    expect(isWorkflowAllowedForRecipeId("market_research", "commerce-market-research")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("market_research", "commerce-product-insight")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("new_product_development", "commerce-product-insight")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("product_retrospective", "commerce-product-insight")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("product_retrospective", "commerce-market-research")).toBe(false);
    expect(isWorkflowAllowedForRecipeId("market_research", undefined)).toBe(false);
    expect(isWorkflowAllowedForRecipeId("product_onboarding", "commerce-product-onboarding")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("product_onboarding", undefined)).toBe(false);
    expect(isWorkflowAllowedForRecipeId("copywriting", "commerce-copywriting")).toBe(true);
    expect(isWorkflowAllowedForRecipeId("copywriting", "commerce-creative-project")).toBe(true);
    expect(isWorkflowAllowedForRecipeId(null, undefined)).toBe(true);
    expect(isWorkflowAllowedForRecipeId(null, "commerce-creative-project")).toBe(false);
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
