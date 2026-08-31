import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProductSummary } from "@/lib/products/catalog";

import {
  ProductInsightWorkspace,
  productInsightMethods,
  productInsightPresentation,
} from "./product-insight-workspace";

const product: ProductSummary = {
  id: "33333333-3333-4333-8333-333333333333",
  title: "手工耐热砂锅",
  spu: "POT-001",
  status: "active",
  variantCount: 3,
  sourceName: "企业 ERP",
  updatedAt: "2026-08-31T00:00:00.000Z",
  imageUrl: null,
};

describe("ProductInsightWorkspace", () => {
  it("exposes three allowlisted business Skills without embedding their instructions", () => {
    const html = renderToStaticMarkup(
      <ProductInsightWorkspace
        method="market_research"
        modelLabel="5.6 Sol · 轻度"
        composerValue=""
        error={null}
        externalDataAvailable={false}
        selectedProducts={[]}
        productContextMode="auto"
        onMethodChange={vi.fn()}
        onComposerChange={vi.fn()}
        onExecute={vi.fn()}
        renderComposer={({ placeholder }) => <div data-placeholder={placeholder}>共享 AgentComposer</div>}
      />,
    );

    expect(productInsightMethods.map((item) => item.id)).toEqual([
      "market_research",
      "new_product_development",
      "product_retrospective",
    ]);
    expect(html).toContain("商品决策");
    expect(html).toContain("市场调研");
    expect(html).toContain("新品开发");
    expect(html).toContain("产品复盘");
    expect(html).toContain("commerce-market-research");
    expect(html).toContain("commerce-new-product-development");
    expect(html).toContain("commerce-product-retrospective");
    expect(html).toContain("共享 AgentComposer");
    expect(html).toContain("外部数据待配置");
    expect(html).not.toContain("SKILL.md");
  });

  it("grounds each Skill in the selected product", () => {
    const research = productInsightPresentation("market_research", "selected", [product]);
    const development = productInsightPresentation("new_product_development", "selected", [product]);
    const retrospective = productInsightPresentation("product_retrospective", "selected", [product]);

    expect(research.title).toContain("手工耐热砂锅");
    expect(development.title).toContain("手工耐热砂锅");
    expect(retrospective.title).toContain("手工耐热砂锅");
    expect(retrospective.starterGoals.join(" ")).toContain("需要验证的数据");
    expect(retrospective.productRequired).toBe(false);
  });

  it("requires a real product selection for retrospective without disabling the shared picker", () => {
    const presentation = productInsightPresentation("product_retrospective", "auto", []);
    expect(presentation.productRequired).toBe(true);
    expect(presentation.placeholder).toContain("产品库");
    expect(presentation.starterGoals).toEqual([]);
  });
});
