export const productInsightMethodValues = [
  "market_research",
  "new_product_development",
  "product_retrospective",
] as const;

export type ProductInsightMethod = (typeof productInsightMethodValues)[number];

export const productInsightRecipeValues = [
  "market_research",
  "new_product_development",
  "product_retrospective",
] as const;

export type ProductInsightRecipeId = (typeof productInsightRecipeValues)[number];

const methodSkillNames: Record<ProductInsightMethod, string> = {
  market_research: "commerce-market-research",
  new_product_development: "commerce-new-product-development",
  product_retrospective: "commerce-product-retrospective",
};

export function isProductInsightMethod(value: unknown): value is ProductInsightMethod {
  return typeof value === "string" && productInsightMethodValues.includes(value as ProductInsightMethod);
}

export function isProductInsightRecipeId(value: unknown): value is ProductInsightRecipeId {
  return typeof value === "string" && productInsightRecipeValues.includes(value as ProductInsightRecipeId);
}

export function productInsightRecipeId(method: ProductInsightMethod): ProductInsightRecipeId {
  return method;
}

export function productInsightMethodForRecipeId(value: unknown): ProductInsightMethod | null {
  return isProductInsightRecipeId(value) ? value : null;
}

export function productInsightSkillName(method: ProductInsightMethod): string {
  return methodSkillNames[method];
}

export function isInsightMethodAllowedForRecipeId(
  recipeId: unknown,
  method: ProductInsightMethod | null | undefined,
): boolean {
  return isProductInsightRecipeId(recipeId) && recipeId === method;
}
