import { describe, expect, it } from "vitest";

import {
  isInsightMethodAllowedForRecipeId,
  isProductInsightMethod,
  productInsightMethodForRecipeId,
  productInsightSkillName,
} from "./product-insight-contract";

describe("product insight browser contract", () => {
  it("keeps the browser surface on a closed method allowlist", () => {
    expect(isProductInsightMethod("market_research")).toBe(true);
    expect(isProductInsightMethod("new_product_development")).toBe(true);
    expect(isProductInsightMethod("product_retrospective")).toBe(true);
    expect(isProductInsightMethod("../../SKILL.md")).toBe(false);
  });

  it("maps persisted Recipe identity back to the fixed UI method", () => {
    expect(productInsightMethodForRecipeId("new_product_development")).toBe("new_product_development");
    expect(productInsightMethodForRecipeId("copywriting")).toBeNull();
    expect(isInsightMethodAllowedForRecipeId("product_retrospective", "product_retrospective")).toBe(true);
    expect(isInsightMethodAllowedForRecipeId("product_retrospective", "market_research")).toBe(false);
  });

  it("exposes only display names for application-managed native Skills", () => {
    expect(productInsightSkillName("market_research")).toBe("commerce-market-research");
    expect(productInsightSkillName("new_product_development")).toBe("commerce-new-product-development");
    expect(productInsightSkillName("product_retrospective")).toBe("commerce-product-retrospective");
  });
});
