import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProductCatalogResponse, ProductImportResponse } from "@/lib/products/catalog";

import { ImportResultPanel, ProductLibraryWorkspace } from "./product-library-workspace";

const catalog: ProductCatalogResponse = {
  products: [
    {
      id: "prod-1",
      title: "轻量通勤双肩包",
      spu: "BAG-1001",
      status: "active",
      variantCount: 3,
      sourceName: "Shopify 中国站",
      updatedAt: "2026-08-30T08:00:00.000Z",
      imageUrl: null,
    },
  ],
  total: 1,
  nextCursor: null,
  catalogStatus: { status: "needs_review", latestImportId: "33333333-3333-4333-8333-333333333333", updatedAt: "2026-08-30T08:00:00.000Z" },
  permission: { canRead: true, canImport: true, canReview: true, canManageSources: true },
};

describe("ProductLibraryWorkspace", () => {
  it("renders the same-shell product, source, and import management entry points", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["product-catalog", "", 100, null], catalog);
    queryClient.setQueryData(["product-latest-import"], {
      latest: {
        import: {
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "44444444-4444-4444-8444-444444444444",
          fileName: "products.csv",
          status: "needs_review",
          totalRecords: 8,
          importedProducts: 0,
          importedVariants: 0,
          issueCount: 1,
          mappingRevisionId: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-08-30T08:00:00.000Z",
        },
        fields: [],
        issues: [{ code: "MAPPING_REVIEW", message: "SKU 字段需要确认。" }],
      },
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProductLibraryWorkspace onBack={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(html).toContain("产品库工作区");
    expect(html).toContain("标准产品、来源绑定与受控导入");
    expect(html).toContain("产品接入进度");
    expect(html).toContain("查看接入方式");
    expect(html).toContain("产品");
    expect(html).toContain("数据源");
    expect(html).toContain("文件导入");
    expect(html).toContain("轻量通勤双肩包");
    expect(html).toContain("最新导入需要复核");
  });

  it("keeps upload analysis separate from the explicit canonical publish action", () => {
    const analyzed: ProductImportResponse = {
      import: {
        id: "import-1",
        sourceId: "source-1",
        fileName: "products.csv",
        status: "ready_to_publish",
        totalRecords: 8,
        importedProducts: 0,
        importedVariants: 0,
        issueCount: 0,
        mappingRevisionId: "mapping-1",
        createdAt: "2026-08-30T08:00:00.000Z",
      },
      issues: [],
    };
    const html = renderToStaticMarkup(
      <ImportResultPanel
        result={analyzed}
        fields={[{ path: "/spu", observedTypes: ["string"], presentCount: 8 }]}
        canReview
        publishing={false}
        publishError={null}
        onPublish={vi.fn()}
        onStartConversation={vi.fn()}
      />,
    );

    expect(html).toContain("来源检查完成，可以发布");
    expect(html).toContain("来源记录");
    expect(html).toContain("来源字段证据");
    expect(html).toContain("/spu");
    expect(html).toContain("文本 · 8 条有值");
    expect(html).toContain("发布到产品库");
    expect(html).toContain("尚未开始");
    expect(html).not.toContain("已发布到产品库");
    expect(html).not.toContain("产品与 SKU 预览");
  });

  it("restores a ready-to-publish batch after navigation instead of mislabeling it as syncing", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["product-catalog", "", 100, null], {
      ...catalog,
      catalogStatus: {
        status: "importing",
        latestImportId: "33333333-3333-4333-8333-333333333333",
        updatedAt: "2026-08-30T08:00:00.000Z",
      },
    });
    queryClient.setQueryData(["product-latest-import"], {
      latest: {
        import: {
          id: "33333333-3333-4333-8333-333333333333",
          sourceId: "44444444-4444-4444-8444-444444444444",
          fileName: "products.csv",
          status: "ready_to_publish",
          totalRecords: 8,
          importedProducts: 0,
          importedVariants: 0,
          issueCount: 0,
          mappingRevisionId: "55555555-5555-4555-8555-555555555555",
          createdAt: "2026-08-30T08:00:00.000Z",
        },
        fields: [{ path: "/spu", observedTypes: ["string"], presentCount: 8 }],
        issues: [],
      },
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ProductLibraryWorkspace onBack={vi.fn()} onStartConversation={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(html).toContain("最新导入等待发布");
    expect(html).toContain("等待你明确确认发布");
    expect(html).toContain("发布到产品库");
    expect(html).not.toContain("正在同步产品");
    expect(html).not.toContain("已生成产品与 SKU 预览");
  });

  it("routes ambiguous mapping to Harness and shows canonical readback only after publication", () => {
    const needsReview: ProductImportResponse = {
      import: {
        id: "import-review",
        sourceId: "source-1",
        fileName: "products.json",
        status: "needs_review",
        totalRecords: 8,
        importedProducts: 0,
        importedVariants: 0,
        issueCount: 2,
        mappingRevisionId: "mapping-review",
        createdAt: "2026-08-30T08:00:00.000Z",
      },
      issues: [{ code: "MAPPING_REVIEW", message: "SKU 字段需要确认。" }],
    };
    const reviewHtml = renderToStaticMarkup(
      <ImportResultPanel
        result={needsReview}
        fields={[]}
        canReview
        publishing={false}
        publishError={null}
        onPublish={vi.fn()}
        onStartConversation={vi.fn()}
      />,
    );
    expect(reviewHtml).toContain("通过对话处理映射");
    expect(reviewHtml).not.toContain("发布到产品库");

    const completed: ProductImportResponse = {
      ...needsReview,
      import: {
        ...needsReview.import,
        status: "completed",
        importedProducts: 4,
        importedVariants: 8,
        issueCount: 0,
      },
      issues: [],
    };
    const completedHtml = renderToStaticMarkup(
      <ImportResultPanel
        result={completed}
        fields={[]}
        canReview
        publishing={false}
        publishError={null}
        onPublish={vi.fn()}
        onStartConversation={vi.fn()}
      />,
    );
    expect(completedHtml).toContain("已发布到产品库");
    expect(completedHtml).toContain("标准产品");
    expect(completedHtml).toContain("标准 SKU");
    expect(completedHtml).toContain(">4<");
    expect(completedHtml).toContain(">8<");
  });
});
