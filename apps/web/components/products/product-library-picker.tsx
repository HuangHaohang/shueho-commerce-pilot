"use client";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Loader2,
  LockKeyhole,
  Package,
  PackageSearch,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  ProductCatalogRequestError,
  type ProductCatalogResponse,
  type ProductContextMode,
  type ProductSummary,
} from "@/lib/products/catalog";
import { useProductCatalog } from "@/lib/products/hooks";
import { cn } from "@/lib/utils";

const MAX_SELECTED_PRODUCTS = 20;
export const PRODUCT_LIBRARY_MOBILE_MAX_WIDTH = 639;

export function productLibrarySurfaceForViewport(width: number): "sheet" | "popover" {
  return width <= PRODUCT_LIBRARY_MOBILE_MAX_WIDTH ? "sheet" : "popover";
}

export function ProductLibraryPicker({
  open,
  disabled = false,
  placement = "top",
  compact = false,
  collisionBoundary = null,
  mode,
  selectedProducts,
  onOpenChange,
  onModeChange,
  onSelectedProductsChange,
  onManage,
}: {
  open: boolean;
  disabled?: boolean;
  placement?: "top" | "bottom";
  compact?: boolean;
  collisionBoundary?: Element | null;
  mode: ProductContextMode;
  selectedProducts: ProductSummary[];
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: ProductContextMode) => void;
  onSelectedProductsChange: (products: ProductSummary[]) => void;
  onManage: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"recent" | "selected">("recent");
  const deferredQuery = useDeferredValue(query);
  const isMobile = useMobileSheet();
  const catalogQuery = useProductCatalog({ query: deferredQuery, limit: 40 }, true);

  useEffect(() => {
    if (!open) return;
    setActiveTab(selectedProducts.length ? "selected" : "recent");
    setQuery("");
  }, [open]);
  const trigger = (
    <button
      type="button"
      className={cn(
        "flex h-9 items-center rounded-full text-xs text-[var(--cp-text-muted)] transition-colors hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:opacity-50",
        compact ? "w-9 justify-center p-0" : "max-w-[152px] gap-1.5 px-2.5 sm:px-3",
      )}
      aria-label={productPickerAriaLabel(mode, selectedProducts.length, catalogQuery.data?.catalogStatus.status)}
      aria-haspopup="dialog"
      aria-expanded={open}
      disabled={disabled}
    >
      <ProductPickerStatusIcon
        loading={catalogQuery.isLoading}
        status={catalogQuery.data?.catalogStatus.status}
        error={catalogQuery.error}
      />
      {!compact ? (
        <span className="truncate whitespace-nowrap max-sm:hidden">{productPickerLabel(mode, selectedProducts.length)}</span>
      ) : null}
      {!compact && selectedProducts.length ? (
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--cp-bg-muted)] px-1.5 text-[10px] font-medium text-[var(--cp-text-soft)] sm:hidden">
          {selectedProducts.length}
        </span>
      ) : null}
      {!compact ? <ChevronDown className="size-3.5 shrink-0 max-sm:hidden" strokeWidth={1.8} /> : null}
    </button>
  );

  const panel = (
    <ProductLibraryPickerPanel
      query={query}
      data={catalogQuery.data}
      loading={catalogQuery.isLoading}
      refreshing={catalogQuery.isFetching && !catalogQuery.isLoading}
      error={catalogQuery.error}
      activeTab={activeTab}
      selectedProducts={selectedProducts}
      onQueryChange={setQuery}
      onTabChange={setActiveTab}
      onRetry={() => void catalogQuery.refetch()}
      onToggleProduct={(product) => {
        const next = nextProductContextSelection(selectedProducts, product);
        onSelectedProductsChange(next.products);
        onModeChange(next.mode);
      }}
      onCommit={() => {
        onOpenChange(false);
      }}
      onManage={() => {
        onOpenChange(false);
        onManage();
      }}
      compact={compact}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent className="flex flex-col pb-[max(12px,env(safe-area-inset-bottom))]">
          <SheetTitle className="sr-only">产品库</SheetTitle>
          <SheetDescription className="sr-only">选择当前任务可使用的产品范围</SheetDescription>
          {panel}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={placement === "top" ? "top" : "bottom"}
        align={compact ? "end" : "start"}
        collisionBoundary={collisionBoundary ?? undefined}
        className="overflow-hidden p-0"
        style={{
          width: `min(${compact ? "380px" : "560px"}, var(--radix-popover-content-available-width))`,
        }}
        role="dialog"
        aria-label="产品库"
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}

export function ProductLibraryPickerPanel({
  query,
  data,
  loading,
  refreshing,
  error,
  activeTab,
  selectedProducts,
  onQueryChange,
  onTabChange,
  onRetry,
  onToggleProduct,
  onCommit,
  onManage,
  compact = false,
}: {
  query: string;
  data: ProductCatalogResponse | undefined;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  activeTab: "recent" | "selected";
  selectedProducts: ProductSummary[];
  onQueryChange: (query: string) => void;
  onTabChange: (tab: "recent" | "selected") => void;
  onRetry: () => void;
  onToggleProduct: (product: ProductSummary) => void;
  onCommit: () => void;
  onManage: () => void;
  compact?: boolean;
}) {
  const selectedIds = useMemo(() => new Set(selectedProducts.map((product) => product.id)), [selectedProducts]);
  const permissionDenied = error instanceof ProductCatalogRequestError && error.status === 403;
  const status = data?.catalogStatus.status;
  const statusSummary = status === "importing"
    ? "正在同步，可继续使用已归一产品"
    : status === "needs_review"
      ? "部分新数据等待复核"
      : status === "error"
        ? "最近一次同步异常"
        : data
          ? `${data.total} 个可用产品`
          : "选择当前任务的产品范围";
  const visibleProducts = activeTab === "selected"
    ? selectedProducts.filter((product) => matchesProductQuery(product, query))
    : data?.products ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-product-library-panel>
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--cp-border-subtle)] px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="m-0 shrink-0 text-sm font-semibold text-[var(--cp-text)]">产品库</h2>
          <span className="truncate text-[11px] leading-4 text-[var(--cp-text-muted)]">{statusSummary}</span>
          {refreshing ? <Loader2 className="size-3.5 shrink-0 animate-spin text-[var(--cp-text-faint)]" aria-label="正在刷新产品库" /> : null}
        </div>
        {status === "importing" ? (
          <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cp-bg-subtle)] px-2 text-[10px] text-[var(--cp-text-soft)]">
            <Loader2 className="size-3.5 animate-spin" />
            同步中
          </span>
        ) : status === "needs_review" || status === "error" ? (
          <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cp-warning-bg)] px-2 text-[10px] text-[var(--cp-warning)]">
            <CircleAlert className="size-3.5" />
            {status === "error" ? "同步异常" : "待复核"}
          </span>
        ) : null}
      </header>

      {!permissionDenied ? (
        <div className="shrink-0 px-3 pt-2.5">
          <label className="flex h-9 items-center gap-2 rounded-[var(--cp-radius-segment)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 focus-within:border-[var(--cp-border-strong)]">
            <Search className="size-4 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
            <span className="sr-only">搜索产品</span>
            <input
              data-product-search-input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
              placeholder="按产品名、SPU 或数据源搜索"
            />
          </label>
          <div className="mt-1.5 flex items-center gap-1 border-b border-[var(--cp-border-subtle)]" role="tablist" aria-label="产品选择范围">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "recent"}
              className={cn(
                "relative h-8 rounded-t-[var(--cp-radius-item)] px-2.5 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                activeTab === "recent" && "font-medium text-[var(--cp-text)] after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-[var(--cp-text)]",
              )}
              onClick={() => onTabChange("recent")}
            >
              最近使用
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "selected"}
              className={cn(
                "relative h-8 rounded-t-[var(--cp-radius-item)] px-2.5 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                activeTab === "selected" && "font-medium text-[var(--cp-text)] after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:bg-[var(--cp-text)]",
              )}
              onClick={() => onTabChange("selected")}
            >
              已选择 {selectedProducts.length ? `(${selectedProducts.length})` : ""}
            </button>
          </div>
        </div>
      ) : null}

      <div className="cp-flat-scrollbar min-h-[112px] flex-1 overflow-y-auto overscroll-contain px-2.5 py-1.5 sm:max-h-[232px]">
        {loading ? <ProductPickerSkeleton /> : null}
        {!loading && error ? (
          <ProductPickerError error={error} permissionDenied={permissionDenied} onRetry={onRetry} onManage={onManage} />
        ) : null}
        {!loading && !error && data && visibleProducts.length ? (
          <div
            className={cn("grid gap-x-2", compact ? "grid-cols-1" : "sm:grid-cols-2")}
            role="listbox"
            aria-label="可选产品"
            aria-multiselectable="true"
          >
            {visibleProducts.map((product) => {
              const selected = selectedIds.has(product.id);
              return (
                <button
                  key={product.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "grid min-h-12 w-full grid-cols-[36px_minmax(0,1fr)_20px] items-center gap-2.5 rounded-[var(--cp-radius-item)] px-2 py-1 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                    selected && "bg-[var(--cp-bg-subtle)]",
                  )}
                  onClick={() => onToggleProduct(product)}
                >
                  <ProductThumbnail product={product} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium leading-5 text-[var(--cp-text)]">{product.title}</span>
                    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-[var(--cp-text-muted)]">
                      <span className="truncate">{product.spu}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{product.sourceName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="shrink-0">{product.variantCount} SKU</span>
                    </span>
                  </span>
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-[6px] border",
                      selected
                        ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white"
                        : "border-[var(--cp-border-strong)] bg-[var(--cp-surface)]",
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <Check className="size-3.5" strokeWidth={2.2} /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {!loading && !error && data && !visibleProducts.length ? (
          <div className="flex min-h-[112px] flex-col items-center justify-center px-4 text-center">
            <Package className="size-5 text-[var(--cp-text-faint)]" strokeWidth={1.6} />
            <p className="mb-0 mt-2 text-sm font-medium text-[var(--cp-text)]">
              {activeTab === "selected" ? "还没有选择产品" : query.trim() ? "没有匹配的产品" : "尚无已归一且可用的产品"}
            </p>
            <p className="mb-0 mt-0.5 text-xs leading-5 text-[var(--cp-text-muted)]">
              {activeTab === "selected"
                ? "从“最近使用”中选择要添加到对话的产品。"
                : query.trim()
                  ? "换个产品名、SPU 或数据源试试。"
                  : "导入 CSV 或 JSON 后，系统会保留来源并生成标准产品。"}
            </p>
            {activeTab === "recent" && !query.trim() && data.permission.canImport ? (
              <Button type="button" variant="outline" className="mt-4 h-9 rounded-full" onClick={onManage}>
                导入产品数据
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <footer className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--cp-border-subtle)] px-3 py-2">
        <span className="text-xs text-[var(--cp-text-muted)]">已选 {selectedProducts.length} 个产品</span>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" className="h-8 rounded-full px-3 text-xs" onClick={onManage}>
            管理产品库
          </Button>
          <Button
            type="button"
            className="h-8 rounded-full px-4 text-xs"
            disabled={permissionDenied}
            onClick={onCommit}
          >
            完成
          </Button>
        </div>
      </footer>
    </div>
  );
}

export function SelectedProductChips({
  products,
  compact = false,
  disabled = false,
  onRemove,
}: {
  products: ProductSummary[];
  compact?: boolean;
  disabled?: boolean;
  onRemove: (productId: string) => void;
}) {
  if (!products.length) return null;
  const visibleProducts = products.slice(0, compact ? 2 : 4);
  const remaining = products.length - visibleProducts.length;

  return (
    <div className="mb-2 flex max-w-full flex-wrap gap-1.5" aria-label={`已选择 ${products.length} 个产品`}>
      {visibleProducts.map((product) => (
        <span
          key={product.id}
          data-selected-product={product.id}
          className="inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] pl-1.5 pr-1 text-xs text-[var(--cp-text-soft)]"
        >
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" className="size-5 shrink-0 rounded-[5px] object-cover" />
          ) : (
            <Package className="size-3.5 shrink-0 text-[var(--cp-text-muted)]" strokeWidth={1.8} />
          )}
          <span className={cn("truncate", compact ? "max-w-[104px]" : "max-w-[180px]")}>{product.title}</span>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--cp-text-faint)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`移除产品 ${product.title}`}
            disabled={disabled}
            onClick={() => onRemove(product.id)}
          >
            <X className="size-3.5" />
          </button>
        </span>
      ))}
      {remaining > 0 ? (
        <span className="inline-flex h-8 items-center rounded-full border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] px-2.5 text-xs text-[var(--cp-text-muted)]">
          +{remaining}
        </span>
      ) : null}
    </div>
  );
}

function ProductPickerStatusIcon({ loading, status, error }: { loading: boolean; status?: ProductCatalogResponse["catalogStatus"]["status"]; error: unknown }) {
  if (loading || status === "importing") return <Loader2 className="size-4 shrink-0 animate-spin" strokeWidth={1.8} />;
  if (error instanceof ProductCatalogRequestError && error.status === 403) return <LockKeyhole className="size-4 shrink-0" strokeWidth={1.8} />;
  if (error || status === "error" || status === "needs_review") return <CircleAlert className="size-4 shrink-0 text-[var(--cp-warning)]" strokeWidth={1.8} />;
  return <PackageSearch className="size-4 shrink-0" strokeWidth={1.8} />;
}

function ProductPickerError({
  error,
  permissionDenied,
  onRetry,
  onManage,
}: {
  error: unknown;
  permissionDenied: boolean;
  onRetry: () => void;
  onManage: () => void;
}) {
  const requestError = error instanceof ProductCatalogRequestError ? error : null;
  return (
    <div className="flex min-h-[112px] flex-col items-center justify-center px-4 text-center" role="alert">
      {permissionDenied ? (
        <LockKeyhole className="size-6 text-[var(--cp-text-faint)]" strokeWidth={1.7} />
      ) : (
        <CircleAlert className="size-6 text-[var(--cp-danger)]" strokeWidth={1.7} />
      )}
      <p className="mb-0 mt-3 text-sm font-medium text-[var(--cp-text)]">
        {permissionDenied ? "没有产品库查看权限" : "产品库暂时不可用"}
      </p>
      <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
        {permissionDenied ? "请联系工作区管理员授权，或切换到有权限的工作区。" : requestError?.message || "请稍后重试。"}
      </p>
      {requestError?.requestId ? (
        <code className="mt-2 max-w-full truncate text-[10px] text-[var(--cp-text-faint)]">{requestError.requestId}</code>
      ) : null}
      <div className="mt-4 flex items-center gap-2">
        {!permissionDenied ? (
          <Button type="button" variant="outline" className="h-9 rounded-full" onClick={onRetry}>
            <RefreshCw className="size-4" />
            重新读取
          </Button>
        ) : null}
        <Button type="button" variant="ghost" className="h-9 rounded-full" onClick={onManage}>
          查看产品库
        </Button>
      </div>
    </div>
  );
}

function ProductThumbnail({ product }: { product: ProductSummary }) {
  if (product.imageUrl) {
    return (
      // Remote commerce image hosts are tenant-configured, so this remains an unoptimized browser image.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={product.imageUrl}
        alt=""
        className="size-9 rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] object-cover"
      />
    );
  }
  return (
    <span className="flex size-9 items-center justify-center rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] text-[var(--cp-text-muted)]">
      <Package className="size-4" strokeWidth={1.7} />
    </span>
  );
}

function ProductPickerSkeleton() {
  return (
    <div className="space-y-1" aria-label="正在读取产品库">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex min-h-12 items-center gap-2.5 px-2">
          <div className="size-9 animate-pulse rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)]" />
          <div className="min-w-0 flex-1">
            <div className="h-3 w-3/5 animate-pulse rounded bg-[var(--cp-bg-muted)]" />
            <div className="mt-2 h-2.5 w-4/5 animate-pulse rounded bg-[var(--cp-bg-muted)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function productPickerLabel(mode: ProductContextMode, selectedCount: number): string {
  if (mode === "selected" && selectedCount) return `产品 · ${selectedCount}`;
  if (mode === "none") return "产品库 · 关闭";
  return "产品库";
}

function productPickerAriaLabel(
  mode: ProductContextMode,
  selectedCount: number,
  status?: ProductCatalogResponse["catalogStatus"]["status"],
): string {
  const state = mode === "selected" && selectedCount
    ? `已选择 ${selectedCount} 个产品`
    : mode === "none"
      ? "本任务不使用"
      : "自动匹配";
  return `产品库上下文：${state}${status === "importing" ? "，同步中" : ""}`;
}

function matchesProductQuery(product: ProductSummary, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return true;
  return [product.title, product.spu, product.sourceName]
    .join(" ")
    .toLocaleLowerCase("zh-CN")
    .includes(normalized);
}

export function toggleProductSelection(
  selectedProducts: ProductSummary[],
  product: ProductSummary,
): ProductSummary[] {
  const exists = selectedProducts.some((item) => item.id === product.id);
  if (exists) return selectedProducts.filter((item) => item.id !== product.id);
  if (selectedProducts.length >= MAX_SELECTED_PRODUCTS) return selectedProducts;
  return [...selectedProducts, product];
}

export function nextProductContextSelection(
  selectedProducts: ProductSummary[],
  product: ProductSummary,
): { products: ProductSummary[]; mode: ProductContextMode } {
  const products = toggleProductSelection(selectedProducts, product);
  return { products, mode: products.length ? "selected" : "auto" };
}

function useMobileSheet(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(`(max-width: ${PRODUCT_LIBRARY_MOBILE_MAX_WIDTH}px)`);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}
