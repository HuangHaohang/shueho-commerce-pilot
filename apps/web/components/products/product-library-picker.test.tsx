import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ProductCatalogRequestError,
  type ProductCatalogResponse,
  type ProductSummary,
} from "@/lib/products/catalog";

import {
  ProductLibraryPickerPanel,
  SelectedProductChips,
  nextProductContextSelection,
  productLibrarySurfaceForViewport,
  toggleProductSelection,
} from "./product-library-picker";

const products: ProductSummary[] = [
  {
    id: "prod-1",
    title: "轻量通勤双肩包",
    spu: "BAG-1001",
    status: "active",
    variantCount: 3,
    sourceName: "Shopify 中国站",
    updatedAt: "2026-08-30T08:00:00.000Z",
    imageUrl: "https://cdn.example.com/bag.jpg",
  },
  {
    id: "prod-2",
    title: "防泼水旅行托特包",
    spu: "BAG-1002",
    status: "active",
    variantCount: 2,
    sourceName: "ERP 商品中心",
    updatedAt: "2026-08-30T08:10:00.000Z",
    imageUrl: null,
  },
];

const catalog: ProductCatalogResponse = {
  products,
  total: 2,
  nextCursor: null,
  catalogStatus: { status: "idle", latestImportId: null, updatedAt: "2026-08-30T08:10:00.000Z" },
  permission: { canRead: true, canImport: true, canReview: true, canManageSources: true },
};

function renderPanel(overrides: Partial<Parameters<typeof ProductLibraryPickerPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ProductLibraryPickerPanel
      query=""
      data={catalog}
      loading={false}
      refreshing={false}
      error={null}
      activeTab="recent"
      selectedProducts={products}
      onQueryChange={vi.fn()}
      onTabChange={vi.fn()}
      onRetry={vi.fn()}
      onToggleProduct={vi.fn()}
      onCommit={vi.fn()}
      onManage={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ProductLibraryPickerPanel", () => {
  it("renders recent and selected tabs with two directly applied products", () => {
    const html = renderPanel();

    expect(html).toContain("最近使用");
    expect(html).toContain("已选择 (2)");
    expect(html).toContain("已选 2 个产品");
    expect(html).toContain("完成");
    expect(html).toContain("轻量通勤双肩包");
    expect(html).toContain("防泼水旅行托特包");
  });

  it("keeps an actionable empty state when no canonical products exist", () => {
    const html = renderPanel({
      data: { ...catalog, products: [], total: 0 },
      selectedProducts: [],
    });

    expect(html).toContain("尚无已归一且可用的产品");
    expect(html).toContain("导入产品数据");
    expect(html).toContain("管理产品库");
  });

  it("distinguishes a permission error from an empty library", () => {
    const html = renderPanel({
      data: undefined,
      error: new ProductCatalogRequestError("Forbidden", 403, "PRODUCT_READ_FORBIDDEN", "req-products-403"),
      selectedProducts: [],
    });

    expect(html).toContain("没有产品库查看权限");
    expect(html).not.toContain("尚无已归一且可用的产品");
    expect(html).toContain("req-products-403");
  });

  it("shows syncing without hiding products already safe to use", () => {
    const html = renderPanel({
      data: { ...catalog, catalogStatus: { status: "importing", latestImportId: "imp-1", updatedAt: null } },
    });

    expect(html).toContain("同步中");
    expect(html).toContain("可继续使用已归一产品");
    expect(html).toContain("轻量通勤双肩包");
  });

  it("uses a single-column list inside the compact creative conversation panel", () => {
    const html = renderPanel({ compact: true });

    expect(html).toContain("grid-cols-1");
    expect(html).not.toContain("sm:grid-cols-2");
  });

  it("can remove the last selected product instead of trapping a stale composer chip", () => {
    expect(toggleProductSelection([products[0]], products[0])).toEqual([]);
    expect(nextProductContextSelection([products[0]], products[0])).toEqual({
      products: [],
      mode: "auto",
    });
  });
});

describe("SelectedProductChips", () => {
  it("uses a product thumbnail when available and preserves both selected identities", () => {
    const html = renderToStaticMarkup(
      <SelectedProductChips products={products} onRemove={vi.fn()} />,
    );

    expect(html).toContain('data-selected-product="prod-1"');
    expect(html).toContain('data-selected-product="prod-2"');
    expect(html).toContain('src="https://cdn.example.com/bag.jpg"');
    expect(html).toContain("移除产品 防泼水旅行托特包");
  });

  it("shortens selected-product chips in a compact conversation rail", () => {
    const compactProducts = [
      ...products,
      { ...products[0], id: "prod-3", title: "第三个产品" },
      { ...products[1], id: "prod-4", title: "第四个产品" },
    ];
    const html = renderToStaticMarkup(
      <SelectedProductChips products={compactProducts} compact onRemove={vi.fn()} />,
    );

    expect(html).toContain("轻量通勤双肩包");
    expect(html).toContain("防泼水旅行托特包");
    expect(html).not.toContain("第三个产品");
    expect(html).toContain("+2");
    expect(html).toContain("max-w-[104px]");
  });
});

describe("product library responsive surface", () => {
  it("uses a bottom sheet on mobile and a popover without a tablet overflow trap", () => {
    expect(productLibrarySurfaceForViewport(390)).toBe("sheet");
    expect(productLibrarySurfaceForViewport(639)).toBe("sheet");
    expect(productLibrarySurfaceForViewport(640)).toBe("popover");
  });
});
