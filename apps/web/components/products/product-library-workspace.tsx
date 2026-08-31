"use client";

import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  CloudCog,
  Database,
  FileJson,
  FileSpreadsheet,
  FileUp,
  Loader2,
  LockKeyhole,
  Package,
  PlugZap,
  RefreshCw,
  Search,
  ServerCog,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  PRODUCT_IMPORT_MAX_BYTES,
  ProductCatalogRequestError,
  type LatestProductImport,
  type ProductCatalogPermission,
  type ProductImportResponse,
  type ProductSummary,
} from "@/lib/products/catalog";
import {
  useCreateProductSource,
  useActivateProductImport,
  useProductCatalog,
  useProductConnectors,
  useProductImport,
  useLatestProductImport,
  useProductSources,
  useTestProductSource,
} from "@/lib/products/hooks";
import type {
  ProductConnector,
  ProductConnectorKind,
  ProductSource,
  ProductSourceTest,
} from "@/lib/products/sources";
import { cn } from "@/lib/utils";

type ProductWorkspaceTab = "products" | "sources" | "import";

const importFormSchema = z.object({
  sourceName: z.string().trim().max(120, "数据源名称不能超过 120 个字符。"),
  fileName: z.string().min(1, "请选择 CSV 或 JSON 文件。"),
  fileSize: z.number().max(PRODUCT_IMPORT_MAX_BYTES, "文件不能超过 5 MiB。"),
  extension: z.enum(["csv", "json"], { message: "仅支持 CSV 或 JSON 文件。" }),
});

export function ProductLibraryWorkspace({
  onBack,
  onStartConversation,
}: {
  onBack: () => void;
  onStartConversation?: (prompt?: string) => void;
}) {
  const [tab, setTab] = useState<ProductWorkspaceTab>("products");
  const [query, setQuery] = useState("");
  const [importSourceName, setImportSourceName] = useState("");
  const catalogQuery = useProductCatalog({ query, limit: 100 }, true);
  const sourcesQuery = useProductSources(catalogQuery.data?.permission.canRead === true);
  const latestImportQuery = useLatestProductImport(catalogQuery.data?.permission.canRead === true);
  const latestActivationMutation = useActivateProductImport();
  const latestActivationKeyRef = useRef(createIdempotencyKey());
  const permissionDenied = catalogQuery.error instanceof ProductCatalogRequestError && catalogQuery.error.status === 403;
  const permission = catalogQuery.data?.permission;
  const latestImport = latestImportQuery.data?.latest ?? null;

  useEffect(() => {
    latestActivationKeyRef.current = createIdempotencyKey();
    latestActivationMutation.reset();
  }, [latestImport?.import.id]);

  async function publishLatestImport() {
    if (
      !latestImport ||
      latestImport.import.status !== "ready_to_publish" ||
      !latestImport.import.mappingRevisionId ||
      permission?.canReview !== true
    ) return;
    try {
      await latestActivationMutation.mutateAsync({
        importId: latestImport.import.id,
        mappingRevisionId: latestImport.import.mappingRevisionId,
        idempotencyKey: latestActivationKeyRef.current,
        confirmation: "publish",
      });
    } catch {
      // Mutation state renders the authoritative server error and retains the exact retry key.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)]" aria-label="产品库工作区">
      <header className="flex h-[var(--cp-topbar-height)] shrink-0 items-center gap-3 border-b border-[var(--cp-border-subtle)] px-4 md:px-6">
        <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="返回任务" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0">
          <h1 className="m-0 truncate text-sm font-semibold text-[var(--cp-text)]">产品库</h1>
          <p className="m-0 truncate text-[11px] text-[var(--cp-text-faint)]">标准产品、来源绑定与受控导入</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[1040px] px-4 pb-20 pt-8 md:px-8 md:pt-12">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="m-0 text-[28px] font-semibold leading-tight">产品库</h2>
              <p className="mb-0 mt-2 max-w-[620px] text-sm leading-6 text-[var(--cp-text-muted)]">
                不同来源的数据先保留原始绑定，再归一成 Agent 可安全读取的标准产品和 SKU。
              </p>
            </div>
            {catalogQuery.data ? (
              <CatalogStatusSummary
                data={catalogQuery.data}
                latestImport={latestImport}
                latestImportLoading={latestImportQuery.isLoading}
                latestImportError={latestImportQuery.isError}
              />
            ) : null}
          </div>

          {catalogQuery.data ? (
            <CatalogOnboarding
              totalProducts={catalogQuery.data.total}
              sourceCount={sourcesQuery.data?.sources.length ?? 0}
              latestImportId={catalogQuery.data.catalogStatus.latestImportId}
              catalogStatus={catalogQuery.data.catalogStatus.status}
              latestImport={latestImport}
              latestImportLoading={latestImportQuery.isLoading}
              latestImportError={latestImportQuery.isError}
              publishing={latestActivationMutation.isPending}
              publishError={latestActivationMutation.isError ? latestActivationMutation.error : null}
              canImport={catalogQuery.data.permission.canImport}
              canReview={catalogQuery.data.permission.canReview}
              onOpenImport={() => {
                setImportSourceName("");
                setTab("import");
              }}
              onOpenSources={() => setTab("sources")}
              onStartConversation={onStartConversation}
              onPublish={() => void publishLatestImport()}
              onRetryLatest={() => void latestImportQuery.refetch()}
            />
          ) : null}

          <div className="mt-8 flex min-w-0 items-center gap-1 border-b border-[var(--cp-border)]" role="tablist" aria-label="产品库视图">
            {([
              ["products", "产品"],
              ["sources", "数据源"],
              ["import", "文件导入"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={cn(
                  "relative h-10 shrink-0 rounded-t-[var(--cp-radius-item)] px-4 text-sm text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                  tab === value && "font-medium text-[var(--cp-text)] after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:bg-[var(--cp-text)]",
                )}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {permissionDenied ? (
            <WorkspaceError error={catalogQuery.error} permissionDenied onRetry={() => void catalogQuery.refetch()} />
          ) : catalogQuery.isError ? (
            <WorkspaceError error={catalogQuery.error} permissionDenied={false} onRetry={() => void catalogQuery.refetch()} />
          ) : tab === "products" ? (
            <ProductsView
              query={query}
              onQueryChange={setQuery}
              products={catalogQuery.data?.products ?? []}
              total={catalogQuery.data?.total ?? 0}
              loading={catalogQuery.isLoading}
              canImport={permission?.canImport === true}
              onImport={() => {
                setImportSourceName("");
                setTab("import");
              }}
            />
          ) : tab === "sources" ? (
            <SourcesView
              onImport={(sourceName) => {
                setImportSourceName(sourceName ?? "");
                setTab("import");
              }}
            />
          ) : (
            <ImportView
              permission={permission}
              initialSourceName={importSourceName}
              latestImport={latestImport}
              onStartConversation={onStartConversation}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function CatalogOnboarding({
  totalProducts,
  sourceCount,
  latestImportId,
  catalogStatus,
  latestImport,
  latestImportLoading,
  latestImportError,
  publishing,
  publishError,
  canImport,
  canReview,
  onOpenImport,
  onOpenSources,
  onStartConversation,
  onPublish,
  onRetryLatest,
}: {
  totalProducts: number;
  sourceCount: number;
  latestImportId: string | null;
  catalogStatus: "idle" | "importing" | "needs_review" | "error";
  latestImport: LatestProductImport | null;
  latestImportLoading: boolean;
  latestImportError: boolean;
  publishing: boolean;
  publishError: unknown;
  canImport: boolean;
  canReview: boolean;
  onOpenImport: () => void;
  onOpenSources: () => void;
  onStartConversation?: (prompt?: string) => void;
  onPublish: () => void;
  onRetryLatest: () => void;
}) {
  const hasSource = sourceCount > 0;
  const authoritativeImport = latestImport?.import ?? null;
  const authoritativeImportId = authoritativeImport?.id ?? latestImportId;
  const hasImport = Boolean(authoritativeImportId) || totalProducts > 0;
  const latestStatus = authoritativeImport?.status ?? null;
  const reviewPrompt = authoritativeImportId
    ? `请帮我处理最新产品导入批次（${authoritativeImportId}）的字段映射问题。先说明哪些字段或产品需要人工确认，验证通过后再请求我批准发布到产品库。`
    : "请帮我检查当前工作区待复核的产品导入。先说明字段映射和产品身份问题，验证通过后再请求我批准发布到产品库。";
  const analysisDetail = latestImportLoading
    ? "正在读取最新导入状态"
    : latestImportError
      ? "最新导入状态读取失败"
      : latestStatus === "ready_to_publish"
        ? "来源记录与字段检查已完成"
        : latestStatus === "needs_review"
          ? "存在需要确认的字段或记录"
          : latestStatus === "completed"
            ? "来源记录已处理并保留证据"
            : catalogStatus === "importing"
              ? "正在分析最新导入批次"
              : hasImport
                ? "来源记录已保留"
                : "上传后展示来源记录与问题";
  const publishDetail = latestStatus === "completed"
    ? `${authoritativeImport?.importedProducts ?? 0} 个产品、${authoritativeImport?.importedVariants ?? 0} 个 SKU 已读回`
    : latestStatus === "ready_to_publish"
      ? "等待你明确确认发布"
      : latestStatus === "needs_review"
        ? "复核通过后才能发布"
        : totalProducts > 0
          ? `${totalProducts} 个标准产品可用`
          : "需要明确确认后才写入";
  const steps = [
    {
      label: "选择接入方式",
      detail: hasSource ? `${sourceCount} 个数据源已登记` : "文件、API、数据库或 ERP/PIM",
      complete: hasSource || hasImport,
    },
    {
      label: "分析并校验",
      detail: analysisDetail,
      complete: latestStatus === "ready_to_publish" || latestStatus === "completed",
      warning: latestImportError || latestStatus === "needs_review" || catalogStatus === "error",
    },
    {
      label: "发布标准产品",
      detail: publishDetail,
      complete: latestStatus === "completed" || (!authoritativeImport && totalProducts > 0),
    },
  ];

  return (
    <section className="mt-7 border-y border-[var(--cp-border)] py-4" aria-labelledby="product-onboarding-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 id="product-onboarding-title" className="m-0 text-sm font-semibold text-[var(--cp-text)]">产品接入进度</h3>
            <span className="text-[11px] text-[var(--cp-text-faint)]">每一步都保留来源与审核记录</span>
          </div>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.label} className="grid min-w-0 grid-cols-[24px_minmax(0,1fr)] gap-2">
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full border text-[11px] font-medium",
                    step.complete
                      ? "border-[var(--cp-success)] bg-[var(--cp-success-bg)] text-[var(--cp-success)]"
                      : step.warning
                        ? "border-[var(--cp-warning)] bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]"
                        : "border-[var(--cp-border)] text-[var(--cp-text-muted)]",
                  )}
                  aria-hidden="true"
                >
                  {step.complete ? <CheckCircle2 className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-[var(--cp-text)]">{step.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-[var(--cp-text-muted)]">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:max-w-[260px] lg:justify-end">
          {latestImportLoading ? (
            <Button type="button" className="h-9 rounded-full px-4" disabled>
              <Loader2 className="size-4 animate-spin" />
              正在读取导入状态
            </Button>
          ) : latestImportError ? (
            <Button type="button" variant="outline" className="h-9 rounded-full px-4" onClick={onRetryLatest}>
              <RefreshCw className="size-4" />
              重新读取导入状态
            </Button>
          ) : latestStatus === "ready_to_publish" && canReview && authoritativeImport?.mappingRevisionId ? (
            <Button type="button" className="h-9 rounded-full px-4" disabled={publishing} onClick={onPublish}>
              {publishing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {publishing ? "正在发布" : "发布到产品库"}
            </Button>
          ) : latestStatus === "ready_to_publish" && canReview && onStartConversation ? (
            <Button type="button" variant="outline" className="h-9 rounded-full px-4" onClick={() => onStartConversation(reviewPrompt)}>
              通过对话检查批次
            </Button>
          ) : (latestStatus === "needs_review" || catalogStatus === "needs_review") && canReview && onStartConversation ? (
            <Button type="button" className="h-9 rounded-full px-4" onClick={() => onStartConversation(reviewPrompt)}>
              通过对话复核
            </Button>
          ) : canImport && latestStatus !== "ready_to_publish" && latestStatus !== "needs_review" ? (
            <Button type="button" className="h-9 rounded-full px-4" onClick={onOpenImport}>
              <Upload className="size-4" />
              {hasImport ? "继续导入文件" : "上传产品文件"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="h-9 rounded-full px-4" onClick={onOpenSources}>
            查看接入方式
          </Button>
        </div>
      </div>
      {(latestStatus === "needs_review" || latestStatus === "ready_to_publish" || catalogStatus === "needs_review") && !canReview ? (
        <p className="mb-0 mt-3 text-[11px] leading-4 text-[var(--cp-warning)]">最新导入需要产品审核权限，请联系工作区管理员复核或发布。</p>
      ) : null}
      {publishError ? (
        <p className="mb-0 mt-3 text-[11px] leading-4 text-[var(--cp-danger)]" role="alert">
          {publishError instanceof Error ? publishError.message : "无法发布到产品库。"}
        </p>
      ) : null}
    </section>
  );
}

function ProductsView({
  query,
  onQueryChange,
  products,
  total,
  loading,
  canImport,
  onImport,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  products: ProductSummary[];
  total: number;
  loading: boolean;
  canImport: boolean;
  onImport: () => void;
}) {
  return (
    <section className="pt-6" role="tabpanel" aria-label="产品">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 w-full min-w-0 items-center gap-2 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 sm:max-w-[360px]">
          <Search className="size-4 shrink-0 text-[var(--cp-text-faint)]" strokeWidth={1.8} />
          <span className="sr-only">搜索产品</span>
          <input
            data-product-search-input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
            placeholder="搜索产品名、SPU 或数据源"
          />
        </label>
        <span className="text-xs text-[var(--cp-text-faint)]">{total} 个标准产品</span>
      </div>

      {loading ? <WorkspaceListSkeleton /> : null}
      {!loading && products.length ? (
        <div className="mt-5 border-y border-[var(--cp-border)]">
          <div className="hidden min-h-9 grid-cols-[minmax(0,1fr)_120px_88px_132px] items-center gap-5 border-b border-[var(--cp-border-subtle)] px-2 text-[11px] text-[var(--cp-text-faint)] md:grid">
            <span>产品</span><span>数据源</span><span>SKU</span><span>最近更新</span>
          </div>
          {products.map((product) => <ProductRow key={product.id} product={product} />)}
        </div>
      ) : null}
      {!loading && !products.length ? (
        <WorkspaceEmpty
          title={query.trim() ? "没有匹配的产品" : "尚无标准产品"}
          description={query.trim() ? "换个产品名、SPU 或数据源试试。" : "导入 CSV 或 JSON 后，系统会保留来源记录并生成标准产品。"}
          actionLabel={!query.trim() && canImport ? "导入产品数据" : undefined}
          onAction={onImport}
        />
      ) : null}
    </section>
  );
}

function ProductRow({ product }: { product: ProductSummary }) {
  return (
    <article className="grid min-h-[76px] min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 border-b border-[var(--cp-border-subtle)] px-2 py-3 last:border-b-0 md:grid-cols-[44px_minmax(0,1fr)_120px_88px_132px] md:gap-x-5">
      <ProductImage product={product} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="m-0 truncate text-sm font-medium text-[var(--cp-text)]">{product.title}</h3>
          <ProductStatus status={product.status} />
        </div>
        <p className="mb-0 mt-1 truncate text-xs text-[var(--cp-text-muted)]">SPU {product.spu}</p>
        <p className="mb-0 mt-1 truncate text-[11px] text-[var(--cp-text-faint)] md:hidden">
          {product.sourceName} · {product.variantCount} SKU · {formatDateTime(product.updatedAt)}
        </p>
      </div>
      <span className="hidden truncate text-xs text-[var(--cp-text-soft)] md:block">{product.sourceName}</span>
      <span className="hidden text-xs text-[var(--cp-text-soft)] md:block">{product.variantCount}</span>
      <time className="hidden text-xs text-[var(--cp-text-muted)] md:block" dateTime={product.updatedAt}>{formatDateTime(product.updatedAt)}</time>
    </article>
  );
}

function SourcesView({ onImport }: { onImport: (sourceName?: string) => void }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const sourcesQuery = useProductSources(true);
  const connectorsQuery = useProductConnectors(true);
  const testMutation = useTestProductSource();
  const canManageSources = sourcesQuery.data?.permission.canManageSources === true;

  return (
    <section className="pt-6" role="tabpanel" aria-label="数据源">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="m-0 text-sm font-semibold">已接入数据源</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
            数据源目录、连接状态和只读测试均来自服务端；原始来源不会被 AI 覆盖。
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-fit rounded-full"
          disabled={sourcesQuery.isLoading || !canManageSources}
          onClick={() => setDialogOpen(true)}
        >
          <PlugZap className="size-4" />
          接入数据源
        </Button>
      </div>

      {sourcesQuery.data && !canManageSources ? (
        <div className="mt-5 flex items-start gap-2 border-y border-[var(--cp-border-subtle)] py-3 text-xs leading-5 text-[var(--cp-text-muted)]">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          你可以查看连接状态，但数据源接入由工作区管理员管理。
        </div>
      ) : null}
      {sourcesQuery.data && connectorsQuery.isError ? (
        <div className="mt-5 flex items-start gap-2 border-y border-[var(--cp-border-subtle)] py-3 text-xs leading-5 text-[var(--cp-warning)]" role="status">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          已读取数据源，但连接器目录暂不可用；连接测试与新接入已停用。
        </div>
      ) : null}

      {sourcesQuery.isLoading ? <WorkspaceListSkeleton /> : null}
      {sourcesQuery.isError ? (
        <SourceQueryError error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />
      ) : null}
      {sourcesQuery.data?.sources.length ? (
        <ProductSourcesList
          sources={sourcesQuery.data.sources}
          connectors={connectorsQuery.data?.connectors ?? []}
          canManageSources={canManageSources}
          testingSourceId={testMutation.isPending ? testMutation.variables?.sourceId ?? null : null}
          onTest={(sourceId) => {
            void testMutation.mutateAsync({ sourceId, idempotencyKey: createIdempotencyKey() }).catch(() => undefined);
          }}
        />
      ) : null}
      {sourcesQuery.data && !sourcesQuery.data.sources.length ? (
        <WorkspaceEmpty
          title="还没有产品数据源"
          description={canManageSources
            ? "可先使用文件导入；托管 API、只读数据库和 ERP/PIM 连接器会按运维可用性开放。"
            : "请联系工作区管理员接入产品数据。"}
          actionLabel={canManageSources ? "接入第一个数据源" : undefined}
          onAction={() => setDialogOpen(true)}
        />
      ) : null}

      <ProductSourceConnectionDialog
        open={dialogOpen}
        connectors={connectorsQuery.data?.connectors ?? []}
        connectorsLoading={connectorsQuery.isLoading}
        connectorsError={connectorsQuery.error}
        canManageSources={canManageSources}
        onOpenChange={setDialogOpen}
        onOpenFileImport={onImport}
      />
    </section>
  );
}

export function ProductSourcesList({
  sources,
  connectors,
  canManageSources,
  testingSourceId,
  onTest,
}: {
  sources: ProductSource[];
  connectors: ProductConnector[];
  canManageSources: boolean;
  testingSourceId: string | null;
  onTest: (sourceId: string) => void;
}) {
  const connectorByKey = new Map(connectors.map((connector) => [connector.key, connector]));
  return (
    <div className="mt-5 border-y border-[var(--cp-border)]">
      {sources.map((source) => {
        const connector = connectorByKey.get(source.connectorKey);
        const testAvailable = connector?.capabilities.testConnection === true && source.adapterAvailability === "ready";
        return (
          <article
            key={source.id}
            className="grid min-h-[82px] min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-x-3 border-b border-[var(--cp-border-subtle)] px-2 py-3 last:border-b-0 md:grid-cols-[44px_minmax(0,1fr)_150px_150px_auto] md:gap-x-5"
          >
            <SourceKindIcon kind={source.kind} />
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h4 className="m-0 truncate text-sm font-medium text-[var(--cp-text)]">{source.name}</h4>
                <SourceStateBadge source={source} />
              </div>
              <p className="mb-0 mt-1 truncate text-[11px] text-[var(--cp-text-muted)]">
                {connector?.displayName ?? connectorKindLabel(source.kind)} · {source.secretReference.configured ? "凭据已由管理员安全配置" : connector?.secretReference.required ? "等待管理员配置凭据" : "无需凭据"}
              </p>
              <p className="mb-0 mt-1 text-[11px] leading-4 text-[var(--cp-text-faint)] md:hidden">
                {sourceTestLabel(source.lastTest)} · {source.sync.available ? "可同步" : source.sync.reason || "同步暂不可用"}
              </p>
            </div>
            <div className="hidden min-w-0 md:block">
              <span className="block text-[11px] text-[var(--cp-text-faint)]">最近测试</span>
              <span className="mt-1 block truncate text-xs text-[var(--cp-text-soft)]">{sourceTestLabel(source.lastTest)}</span>
            </div>
            <div className="hidden min-w-0 md:block">
              <span className="block text-[11px] text-[var(--cp-text-faint)]">同步</span>
              <span className="mt-1 block truncate text-xs text-[var(--cp-text-soft)]">{source.sync.available ? "可用" : source.sync.reason || "首版暂不可用"}</span>
            </div>
            <div className="col-span-2 mt-2 flex items-center justify-end md:col-span-1 md:mt-0">
              {connector?.capabilities.testConnection ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 rounded-full px-3 text-xs"
                  disabled={!canManageSources || !testAvailable || testingSourceId === source.id}
                  onClick={() => onTest(source.id)}
                >
                  {testingSourceId === source.id ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                  {testAvailable ? "测试连接" : "等待管理员配置"}
                </Button>
              ) : (
                <span className="text-[11px] text-[var(--cp-text-faint)]">无需连接测试</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ProductSourceConnectionDialog({
  open,
  connectors,
  connectorsLoading,
  connectorsError,
  canManageSources,
  onOpenChange,
  onOpenFileImport,
}: {
  open: boolean;
  connectors: ProductConnector[];
  connectorsLoading: boolean;
  connectorsError: unknown;
  canManageSources: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenFileImport: (sourceName?: string) => void;
}) {
  const [step, setStep] = useState<"select" | "configure" | "result">("select");
  const [selectedConnectorKey, setSelectedConnectorKey] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [publicConfig, setPublicConfig] = useState<Record<string, string>>(Object.create(null));
  const [formError, setFormError] = useState<string | null>(null);
  const [createdSource, setCreatedSource] = useState<ProductSource | null>(null);
  const [testResult, setTestResult] = useState<ProductSourceTest | null>(null);
  const createMutation = useCreateProductSource();
  const testMutation = useTestProductSource();
  const selectedConnector = useMemo(
    () => connectors.find((connector) => connector.key === selectedConnectorKey) ?? null,
    [connectors, selectedConnectorKey],
  );

  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSelectedConnectorKey(null);
    setSourceName("");
    setPublicConfig(Object.create(null));
    setFormError(null);
    setCreatedSource(null);
    setTestResult(null);
    createMutation.reset();
    testMutation.reset();
  }, [open]);

  async function submitSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedConnector || !connectorCanConfigureInBrowser(selectedConnector)) return;
    setFormError(null);
    const name = sourceName.trim();
    if (!name) {
      setFormError("请输入数据源名称。");
      return;
    }
    const safeFields = selectedConnector.publicConfigFields.filter(isSafePublicConfigField);
    if (safeFields.length !== selectedConnector.publicConfigFields.length) {
      setFormError("连接器定义包含浏览器不可填写的敏感字段，请由运维修正定义。");
      return;
    }
    const normalizedConfig: Record<string, string | number> = Object.create(null);
    for (const field of safeFields) {
      const rawValue = publicConfig[field.key]?.trim() ?? "";
      if (field.required && !rawValue) {
        setFormError(`请填写${field.label}。`);
        return;
      }
      if (!rawValue) continue;
      if (field.type === "integer") {
        const numeric = Number(rawValue);
        if (!Number.isSafeInteger(numeric)) {
          setFormError(`${field.label}必须是整数。`);
          return;
        }
        normalizedConfig[field.key] = numeric;
      } else {
        normalizedConfig[field.key] = rawValue;
      }
    }
    try {
      let source = await createMutation.mutateAsync({
        idempotencyKey: createIdempotencyKey(),
        name,
        connectorKey: selectedConnector.key,
        connectorVersion: selectedConnector.version,
        publicConfig: normalizedConfig,
      });
      setCreatedSource(source);
      if (selectedConnector.capabilities.testConnection) {
        try {
          const tested = await testMutation.mutateAsync({
            sourceId: source.id,
            idempotencyKey: createIdempotencyKey(),
          });
          source = tested.source;
          setCreatedSource(tested.source);
          setTestResult(tested.test);
        } catch (error) {
          setFormError(error instanceof Error ? `数据源已创建，但连接测试未完成：${error.message}` : "数据源已创建，但连接测试未完成。");
        }
      }
      setStep("result");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "无法接入产品数据源。");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,760px)] flex-col">
        <header className="shrink-0 border-b border-[var(--cp-border-subtle)] px-5 pb-4 pt-5 pr-14">
          <DialogTitle className="m-0">接入产品数据源</DialogTitle>
          <DialogDescription className="mb-0 mt-1">
            连接凭据只由管理员在安全配置中授权；普通用户不会在这里填写密码、Token 或完整连接串。
          </DialogDescription>
        </header>

        <div className="cp-flat-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {!canManageSources ? (
            <DialogMessage icon={LockKeyhole} title="没有数据源管理权限" description="请联系工作区管理员执行接入。" />
          ) : connectorsLoading ? (
            <WorkspaceListSkeleton />
          ) : connectorsError ? (
            <DialogMessage icon={CircleAlert} title="无法读取连接器目录" description={connectorsError instanceof Error ? connectorsError.message : "请稍后重试。"} danger />
          ) : step === "select" ? (
            <ConnectorSelection connectors={connectors} onSelect={(connector) => {
              if (!connectorCanConfigureInBrowser(connector)) return;
              if (connector.kind === "file_upload") {
                onOpenChange(false);
                onOpenFileImport();
                return;
              }
              setSelectedConnectorKey(connector.key);
              setSourceName(connector.displayName);
              setPublicConfig(Object.create(null));
              setStep("configure");
            }} />
          ) : step === "configure" && selectedConnector ? (
            <form onSubmit={submitSource} noValidate>
              <button type="button" className="mb-4 rounded-[var(--cp-radius-item)] px-2 py-1 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)]" onClick={() => setStep("select")}>
                ← 返回连接器类型
              </button>
              <div className="flex items-start gap-3">
                <ConnectorIcon kind={selectedConnector.kind} />
                <div className="min-w-0">
                  <h3 className="m-0 text-sm font-semibold">{selectedConnector.displayName}</h3>
                  <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">{selectedConnector.description}</p>
                </div>
              </div>

              <label className="mt-6 block text-xs font-medium text-[var(--cp-text-soft)]">
                数据源名称
                <input
                  data-product-form-input
                  type="text"
                  value={sourceName}
                  maxLength={120}
                  onChange={(event) => setSourceName(event.target.value)}
                  className="mt-2 h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm outline-none focus:border-[var(--cp-border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                />
              </label>

              {selectedConnector.publicConfigFields.filter(isSafePublicConfigField).map((field) => (
                <label key={field.key} className="mt-5 block text-xs font-medium text-[var(--cp-text-soft)]">
                  {field.label}{field.required ? " *" : ""}
                  {field.type === "select" ? (
                    <select
                      value={publicConfig[field.key] ?? ""}
                      onChange={(event) => setPublicConfig((current) => ({ ...current, [field.key]: event.target.value }))}
                      className="mt-2 h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                    >
                      <option value="">请选择</option>
                      {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <input
                      data-product-form-input
                      type={field.type === "integer" ? "number" : "text"}
                      inputMode={field.type === "integer" ? "numeric" : undefined}
                      value={publicConfig[field.key] ?? ""}
                      onChange={(event) => setPublicConfig((current) => ({ ...current, [field.key]: event.target.value }))}
                      className="mt-2 h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                    />
                  )}
                </label>
              ))}

              <div className="mt-6 flex items-start gap-2 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] px-3 py-2.5 text-[11px] leading-5 text-[var(--cp-text-muted)]">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                连接器配置由服务端白名单校验；需要凭据的来源只能选择管理员已授权的安全凭据。当前尚未开放凭据选择，因此相关连接器保持停用。
              </div>
              {formError ? <p className="mb-0 mt-3 text-xs leading-5 text-[var(--cp-danger)]" role="alert">{formError}</p> : null}
              <div className="mt-5 flex justify-end">
                <Button type="submit" className="h-10 rounded-full px-5" disabled={createMutation.isPending || testMutation.isPending}>
                  {createMutation.isPending || testMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                  {testMutation.isPending ? "正在测试连接" : createMutation.isPending ? "正在接入" : "接入数据源"}
                </Button>
              </div>
            </form>
          ) : step === "result" && createdSource ? (
            <SourceConnectionResult
              source={createdSource}
              connector={selectedConnector}
              testResult={testResult}
              warning={formError}
              onOpenFileImport={() => {
                onOpenChange(false);
                onOpenFileImport(createdSource.name);
              }}
              onDone={() => onOpenChange(false)}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectorSelection({ connectors, onSelect }: { connectors: ProductConnector[]; onSelect: (connector: ProductConnector) => void }) {
  const orderedConnectors = [...connectors].sort((left, right) => {
    if (connectorCanConfigureInBrowser(left) && !connectorCanConfigureInBrowser(right)) return -1;
    if (!connectorCanConfigureInBrowser(left) && connectorCanConfigureInBrowser(right)) return 1;
    const order: Record<ProductConnectorKind, number> = { file_upload: 0, rest_api: 1, database: 2, erp: 3, pim: 4 };
    return order[left.kind] - order[right.kind];
  });
  return (
    <div>
      <h3 className="m-0 text-sm font-semibold">选择接入方式</h3>
      <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
        文件可直接上传分析。API、数据库和 ERP/PIM 的连接凭据由管理员安全配置；普通用户只选择已经授权的连接。
      </p>
      <div className="mt-5 border-y border-[var(--cp-border)]">
        {orderedConnectors.map((connector) => {
          const available = connectorCanConfigureInBrowser(connector);
          const requiresCredential = connector.secretReference.required;
          return (
            <button
              key={`${connector.key}:${connector.version}`}
              type="button"
              className="grid min-h-[68px] w-full min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--cp-border-subtle)] px-2 py-2.5 text-left last:border-b-0 hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)] disabled:cursor-not-allowed disabled:bg-[var(--cp-surface-disabled)] disabled:opacity-70"
              disabled={!available}
              onClick={() => onSelect(connector)}
            >
              <ConnectorIcon kind={connector.kind} />
              <span className="min-w-0">
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm font-medium text-[var(--cp-text)]">{connectorKindLabel(connector.kind)}</span>
                  <span className="truncate text-[11px] text-[var(--cp-text-faint)]">{connector.displayName}</span>
                </span>
                <span className="mt-1 block line-clamp-2 text-[11px] leading-4 text-[var(--cp-text-muted)]">
                  {available
                    ? connector.description
                    : requiresCredential
                      ? "由管理员安全配置并授权凭据后开放。"
                      : "此连接器尚未由管理员启用。"}
                </span>
              </span>
              <span className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[10px]",
                available
                  ? "bg-[var(--cp-bg-subtle)] text-[var(--cp-text-soft)]"
                  : "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]",
              )}>
                {available ? connector.kind === "file_upload" ? "立即上传" : "开始配置" : requiresCredential ? "由管理员配置" : "暂未开放"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SourceConnectionResult({
  source,
  connector,
  testResult,
  warning,
  onOpenFileImport,
  onDone,
}: {
  source: ProductSource;
  connector: ProductConnector | null;
  testResult: ProductSourceTest | null;
  warning: string | null;
  onOpenFileImport: () => void;
  onDone: () => void;
}) {
  const successful = source.connectionState === "ready" || source.kind === "file_upload";
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center px-2 text-center" aria-live="polite">
      <span className={cn("flex size-12 items-center justify-center rounded-full", successful ? "bg-[var(--cp-success-bg)] text-[var(--cp-success)]" : "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]")}>
        {successful ? <CheckCircle2 className="size-6" /> : <CircleAlert className="size-6" />}
      </span>
      <h3 className="mb-0 mt-4 text-base font-semibold">{source.kind === "file_upload" ? "文件数据源已创建" : "数据源已接入"}</h3>
      <p className="mb-0 mt-2 max-w-[480px] text-xs leading-5 text-[var(--cp-text-muted)]">
        {source.kind === "file_upload"
          ? "文件是 V1 已启用的实际接入方式；下一步导入 CSV 或 JSON，并按确定性映射发布标准产品。"
          : `当前连接状态：${sourceConnectionStateLabel(source.connectionState)}。${sourceTestLabel(testResult ?? source.lastTest)}`}
      </p>
      <dl className="mb-0 mt-5 w-full max-w-[520px] border-y border-[var(--cp-border)] text-left text-xs">
        <ResultRow label="连接器" value={connector?.displayName ?? connectorKindLabel(source.kind)} />
        <ResultRow label="连接凭据" value={source.secretReference.configured ? "已由管理员安全配置" : connector?.secretReference.required ? "等待管理员配置" : "无需凭据"} />
        <ResultRow label="连接测试" value={connector?.capabilities.testConnection ? sourceTestLabel(testResult ?? source.lastTest) : "该连接器不需要连接测试"} />
        <ResultRow label="同步" value={source.sync.available ? "可用" : source.sync.reason || "首版暂不可用"} last />
      </dl>
      {testResult?.proof ? (
        <p className="mb-0 mt-3 text-[11px] text-[var(--cp-text-muted)]">
          只读证明：{testResult.proof.readOnly && testResult.proof.selectAllowed && !testResult.proof.writePrivileges ? "通过" : "未通过"}
        </p>
      ) : null}
      {warning ? <p className="mb-0 mt-3 text-xs leading-5 text-[var(--cp-warning)]">{warning}</p> : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {source.kind === "file_upload" ? (
          <Button type="button" className="h-10 rounded-full px-5" onClick={onOpenFileImport}>
            <Upload className="size-4" />
            继续导入文件
          </Button>
        ) : null}
        <Button type="button" variant={source.kind === "file_upload" ? "outline" : "default"} className="h-10 rounded-full px-5" onClick={onDone}>
          完成
        </Button>
      </div>
    </div>
  );
}

function SourceQueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const permissionDenied = error instanceof ProductCatalogRequestError && error.status === 403;
  return (
    <div className="mt-5 flex min-h-[220px] flex-col items-center justify-center border-y border-[var(--cp-border)] px-6 text-center" role="alert">
      {permissionDenied ? <LockKeyhole className="size-7 text-[var(--cp-text-faint)]" /> : <CircleAlert className="size-7 text-[var(--cp-danger)]" />}
      <h4 className="mb-0 mt-4 text-sm font-semibold">{permissionDenied ? "没有数据源查看权限" : "无法读取产品数据源"}</h4>
      <p className="mb-0 mt-2 text-xs text-[var(--cp-text-muted)]">{error instanceof Error ? error.message : "请稍后重试。"}</p>
      {!permissionDenied ? <Button type="button" variant="outline" className="mt-4 h-9 rounded-full" onClick={onRetry}><RefreshCw className="size-4" />重新读取</Button> : null}
    </div>
  );
}

function DialogMessage({
  icon: Icon,
  title,
  description,
  danger = false,
}: {
  icon: typeof LockKeyhole;
  title: string;
  description: string;
  danger?: boolean;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center px-5 text-center" role={danger ? "alert" : undefined}>
      <Icon className={cn("size-7", danger ? "text-[var(--cp-danger)]" : "text-[var(--cp-text-faint)]")} />
      <h3 className="mb-0 mt-4 text-sm font-semibold">{title}</h3>
      <p className="mb-0 mt-2 max-w-[420px] text-xs leading-5 text-[var(--cp-text-muted)]">{description}</p>
    </div>
  );
}

function SourceKindIcon({ kind }: { kind: ProductConnectorKind }) {
  return <ConnectorIcon kind={kind} />;
}

function ConnectorIcon({ kind }: { kind: ProductConnectorKind }) {
  const Icon = kind === "file_upload" ? FileUp : kind === "rest_api" ? CloudCog : kind === "database" ? Database : ServerCog;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] text-[var(--cp-text-muted)]">
      <Icon className="size-5" strokeWidth={1.7} />
    </span>
  );
}

function SourceStateBadge({ source }: { source: ProductSource }) {
  const ready = source.connectionState === "ready" || source.kind === "file_upload" && source.status === "active";
  const unavailable = source.adapterAvailability !== "ready" || source.connectionState === "unavailable";
  const label = ready ? "已连接" : unavailable ? "等待管理员配置" : source.connectionState === "error" ? "连接异常" : "待测试";
  return (
    <span className={cn(
      "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
      ready
        ? "bg-[var(--cp-success-bg)] text-[var(--cp-success)]"
        : unavailable
          ? "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]"
          : source.connectionState === "error"
            ? "bg-[var(--cp-danger-bg)] text-[var(--cp-danger)]"
            : "bg-[var(--cp-bg-muted)] text-[var(--cp-text-muted)]",
    )}>{label}</span>
  );
}

function ResultRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={cn("grid min-h-10 grid-cols-[92px_minmax(0,1fr)] items-center gap-4 border-b border-[var(--cp-border-subtle)] py-2", last && "border-b-0")}>
      <dt className="text-[var(--cp-text-faint)]">{label}</dt>
      <dd className="m-0 break-words text-[var(--cp-text-soft)]">{value}</dd>
    </div>
  );
}

function connectorKindLabel(kind: ProductConnectorKind): string {
  if (kind === "file_upload") return "文件上传";
  if (kind === "rest_api") return "托管 API";
  if (kind === "database") return "只读数据库";
  return "ERP / PIM";
}

function sourceConnectionStateLabel(state: ProductSource["connectionState"]): string {
  return ({
    unconfigured: "未配置",
    untested: "待测试",
    ready: "已连接",
    unavailable: "等待管理员配置",
    error: "连接异常",
  } as const)[state];
}

function sourceTestLabel(test: ProductSourceTest | null): string {
  if (!test || test.status === "never") return "尚未测试";
  if (test.status === "unavailable") return "等待管理员配置";
  const label = ({
    running: "正在测试",
    succeeded: "测试通过",
    failed: "测试失败",
    unavailable: "等待管理员配置",
    unknown: "测试结果待核对",
  } as const)[test.status];
  if (!test.message) return label;
  return /(secret|token|credential|password|密钥|凭据|连接串|env:|broker:)/i.test(test.message)
    ? `${label} · 请由管理员检查安全配置`
    : `${label} · ${test.message}`;
}

function isSafePublicConfigField(field: ProductConnector["publicConfigFields"][number]): boolean {
  return !/(password|passwd|token|secret|credential|connection.?string|dsn|base.?url|url|host|hostname|port|authorization|cookie)/i.test(field.key);
}

function connectorCanConfigureInBrowser(connector: ProductConnector): boolean {
  return connector.adapterAvailability === "ready" && !connector.secretReference.required;
}

function ImportView({
  permission,
  initialSourceName,
  latestImport,
  onStartConversation,
}: {
  permission: ProductCatalogPermission | undefined;
  initialSourceName: string;
  latestImport: LatestProductImport | null;
  onStartConversation?: (prompt?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceName, setSourceName] = useState(initialSourceName);
  const [validationError, setValidationError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string>(createIdempotencyKey());
  const activationIdempotencyKeyRef = useRef<string>(createIdempotencyKey());
  const importMutation = useProductImport();
  const activateMutation = useActivateProductImport();

  useEffect(() => {
    setSourceName(initialSourceName);
  }, [initialSourceName]);

  if (permission && !permission.canImport) {
    return (
      <section className="pt-6" role="tabpanel" aria-label="导入">
        <div className="flex min-h-[260px] flex-col items-center justify-center border-y border-[var(--cp-border)] px-6 text-center">
          <LockKeyhole className="size-7 text-[var(--cp-text-faint)]" strokeWidth={1.7} />
          <h3 className="mb-0 mt-4 text-sm font-semibold">没有产品导入权限</h3>
          <p className="mb-0 mt-2 max-w-[440px] text-xs leading-5 text-[var(--cp-text-muted)]">你仍可查看已经归一的产品。请联系工作区管理员执行导入。</p>
        </div>
      </section>
    );
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);
    const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
    const parsed = importFormSchema.safeParse({
      sourceName,
      fileName: file?.name ?? "",
      fileSize: file?.size ?? 0,
      extension,
    });
    if (!parsed.success || !file) {
      setValidationError(parsed.error?.issues[0]?.message ?? "请选择 CSV 或 JSON 文件。");
      return;
    }
    try {
      await importMutation.mutateAsync({
        file,
        sourceName,
        idempotencyKey: idempotencyKeyRef.current,
      });
    } catch {
      // Mutation state renders the server-safe error below and preserves the idempotency key for a retry.
    }
  }

  async function publishImport() {
    const analyzed = importMutation.data ?? (latestImport ? {
      import: latestImport.import,
      issues: latestImport.issues,
    } : undefined);
    if (analyzed?.import.status !== "ready_to_publish" || !analyzed.import.mappingRevisionId) return;
    try {
      await activateMutation.mutateAsync({
        importId: analyzed.import.id,
        mappingRevisionId: analyzed.import.mappingRevisionId,
        idempotencyKey: activationIdempotencyKeyRef.current,
        confirmation: "publish",
      });
    } catch {
      // Mutation state renders the server-safe error and retains the activation key for an exact retry.
    }
  }

  const restoredResult = !file && latestImport ? {
    import: latestImport.import,
    issues: latestImport.issues,
  } : undefined;
  const result = activateMutation.data ?? importMutation.data ?? restoredResult;
  const evidenceFields = latestImport && result?.import.id === latestImport.import.id ? latestImport.fields : [];

  return (
    <section className="pt-6" role="tabpanel" aria-label="导入">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,560px)_minmax(240px,1fr)]">
        <form onSubmit={submitImport} noValidate>
          <h3 className="m-0 text-sm font-semibold">上传并分析产品数据</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
            支持 CSV、JSON，单个文件不超过 5 MiB。上传后只创建分析批次并展示来源记录、字段和问题，不会立即写入标准产品库；只有你明确点击“发布到产品库”后才会发布。
          </p>

          <label className="mt-6 block text-xs font-medium text-[var(--cp-text-soft)]">
            数据源名称（可选）
            <input
              data-product-form-input
              type="text"
              value={sourceName}
              maxLength={120}
              onChange={(event) => setSourceName(event.target.value)}
              className="mt-2 h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm outline-none focus:border-[var(--cp-border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              placeholder="例如 Shopify 中国站"
            />
          </label>

          <label className="mt-5 block text-xs font-medium text-[var(--cp-text-soft)]">
            数据文件
            <span className="mt-2 flex min-h-[92px] cursor-pointer items-center gap-3 rounded-[var(--cp-radius-panel)] border border-dashed border-[var(--cp-border-strong)] bg-[var(--cp-bg-subtle)] px-4 py-4 hover:bg-[var(--cp-bg-muted)] focus-within:ring-2 focus-within:ring-[var(--cp-focus)]">
              {file?.name.toLowerCase().endsWith(".json") ? <FileJson className="size-6 shrink-0 text-[var(--cp-text-muted)]" /> : <FileSpreadsheet className="size-6 shrink-0 text-[var(--cp-text-muted)]" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--cp-text)]">{file ? file.name : "选择 CSV 或 JSON 文件"}</span>
                <span className="mt-1 block text-[11px] text-[var(--cp-text-muted)]">{file ? formatBytes(file.size) : "文件只会发送到当前企业工作区"}</span>
              </span>
              <span className="shrink-0 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-1.5 text-xs text-[var(--cp-text-soft)]">浏览</span>
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="sr-only"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setValidationError(null);
                  importMutation.reset();
                  activateMutation.reset();
                  idempotencyKeyRef.current = createIdempotencyKey();
                  activationIdempotencyKeyRef.current = createIdempotencyKey();
                }}
              />
            </span>
          </label>

          {validationError ? <p className="mb-0 mt-3 text-xs text-[var(--cp-danger)]" role="alert">{validationError}</p> : null}
          {importMutation.isError ? (
            <p className="mb-0 mt-3 text-xs leading-5 text-[var(--cp-danger)]" role="alert">
              {importMutation.error instanceof Error ? importMutation.error.message : "无法导入产品数据。"}
            </p>
          ) : null}

          <Button type="submit" className="mt-5 h-10 rounded-full px-5" disabled={importMutation.isPending}>
            {importMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            {importMutation.isPending ? "正在上传并分析" : "上传并分析"}
          </Button>
        </form>

        <ImportResultPanel
          result={result}
          fields={evidenceFields}
          canReview={permission?.canReview === true}
          publishing={activateMutation.isPending}
          publishError={activateMutation.isError ? activateMutation.error : null}
          onPublish={() => void publishImport()}
          onStartConversation={onStartConversation}
        />
      </div>
    </section>
  );
}

export function ImportResultPanel({
  result,
  fields,
  canReview,
  publishing,
  publishError,
  onPublish,
  onStartConversation,
}: {
  result: ProductImportResponse | undefined;
  fields: LatestProductImport["fields"];
  canReview: boolean;
  publishing: boolean;
  publishError: unknown;
  onPublish: () => void;
  onStartConversation?: (prompt?: string) => void;
}) {
  if (!result) {
    return (
      <aside className="border-t border-[var(--cp-border)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <h3 className="m-0 text-sm font-semibold">导入结果</h3>
        <p className="mb-0 mt-2 text-xs leading-5 text-[var(--cp-text-muted)]">
          上传后先检查来源记录、字段和问题；通过校验后再由你明确发布。
        </p>
      </aside>
    );
  }
  const readyToPublish = result.import.status === "ready_to_publish";
  const completed = result.import.status === "completed";
  const reviewPrompt = `请帮我处理产品导入批次（${result.import.id}）的字段映射问题。先列出需要确认的字段和产品身份，完成确定性校验后再请求我批准发布。`;
  return (
    <aside className="border-t border-[var(--cp-border)] pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0" aria-live="polite">
      <div className="flex items-center gap-2">
        {completed || readyToPublish ? <CheckCircle2 className="size-5 text-[var(--cp-success)]" /> : <CircleAlert className="size-5 text-[var(--cp-warning)]" />}
        <h3 className="m-0 text-sm font-semibold">
          {completed ? "已发布到产品库" : readyToPublish ? "来源检查完成，可以发布" : "来源检查完成，需要复核"}
        </h3>
      </div>
      <ol className="mb-0 mt-4 space-y-2 text-[11px] leading-4 text-[var(--cp-text-muted)]">
        <li className="flex items-center gap-2"><CheckCircle2 className="size-3.5 shrink-0 text-[var(--cp-success)]" />原始来源记录已保留</li>
        <li className="flex items-center gap-2">{readyToPublish || completed ? <CheckCircle2 className="size-3.5 shrink-0 text-[var(--cp-success)]" /> : <CircleAlert className="size-3.5 shrink-0 text-[var(--cp-warning)]" />}字段映射与确定性校验{readyToPublish || completed ? "已通过" : "待复核"}</li>
        <li className="flex items-center gap-2">{completed ? <CheckCircle2 className="size-3.5 shrink-0 text-[var(--cp-success)]" /> : <span className="size-3.5 shrink-0 rounded-full border border-[var(--cp-border-strong)]" />}标准产品发布{completed ? "已完成" : "尚未开始"}</li>
      </ol>
      <dl className="mb-0 mt-5 border-y border-[var(--cp-border)] text-xs">
        <ImportMetric label="来源记录" value={result.import.totalRecords} />
        {completed ? <ImportMetric label="标准产品" value={result.import.importedProducts} /> : null}
        {completed ? <ImportMetric label="标准 SKU" value={result.import.importedVariants} /> : null}
        <ImportMetric label="待复核问题" value={result.import.issueCount} last />
      </dl>
      {fields.length ? (
        <div className="mt-5">
          <h4 className="m-0 text-xs font-semibold">来源字段证据</h4>
          <div className="mt-2 border-y border-[var(--cp-border-subtle)]">
            {fields.slice(0, 8).map((field) => (
              <div key={field.path} className="grid min-h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--cp-border-subtle)] py-1.5 text-[11px] last:border-b-0">
                <code className="min-w-0 truncate font-mono text-[var(--cp-text-soft)]" title={field.path}>{field.path}</code>
                <span className="shrink-0 text-[var(--cp-text-muted)]">
                  {field.observedTypes.map(productSourceTypeLabel).join("/")} · {field.presentCount} 条有值
                </span>
              </div>
            ))}
          </div>
          {fields.length > 8 ? <p className="mb-0 mt-2 text-[11px] text-[var(--cp-text-faint)]">另有 {fields.length - 8} 个来源字段，可通过 Harness 对话检查。</p> : null}
        </div>
      ) : null}
      {result.issues.length ? (
        <div className="mt-5">
          <h4 className="m-0 text-xs font-semibold">问题摘要</h4>
          <ul className="mb-0 mt-2 space-y-2 pl-4 text-xs leading-5 text-[var(--cp-text-muted)]">
            {result.issues.slice(0, 5).map((issue, index) => (
              <li key={`${issue.code}-${issue.rowNumber ?? index}`}>{issue.rowNumber ? `第 ${issue.rowNumber} 行：` : ""}{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {readyToPublish ? (
        <div className="mt-5">
          <p className="mb-0 text-[11px] leading-5 text-[var(--cp-text-muted)]">
            发布会把已验证记录写入当前企业工作区的标准 Product/SPU 与 Variant/SKU；其他企业和工作区无法读取。
          </p>
          {canReview ? (
            <Button type="button" className="mt-3 h-9 rounded-full px-4" disabled={publishing} onClick={onPublish}>
              {publishing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {publishing ? "正在发布" : "发布到产品库"}
            </Button>
          ) : (
            <p className="mb-0 mt-3 text-[11px] leading-4 text-[var(--cp-warning)]">发布需要产品审核权限，请联系工作区管理员。</p>
          )}
        </div>
      ) : null}
      {result.import.status === "needs_review" ? (
        <div className="mt-5">
          <p className="mb-0 text-[11px] leading-5 text-[var(--cp-text-muted)]">歧义记录不会自动发布。请通过 Harness 对话完成字段解释和人工确认。</p>
          {canReview && onStartConversation ? (
            <Button type="button" variant="outline" className="mt-3 h-9 rounded-full px-4" onClick={() => onStartConversation(reviewPrompt)}>
              通过对话处理映射
            </Button>
          ) : null}
        </div>
      ) : null}
      {publishError ? (
        <p className="mb-0 mt-3 text-xs leading-5 text-[var(--cp-danger)]" role="alert">
          {publishError instanceof Error ? publishError.message : "无法发布到产品库。"}
        </p>
      ) : null}
    </aside>
  );
}

function CatalogStatusSummary({
  data,
  latestImport,
  latestImportLoading,
  latestImportError,
}: {
  data: NonNullable<ReturnType<typeof useProductCatalog>["data"]>;
  latestImport: LatestProductImport | null;
  latestImportLoading: boolean;
  latestImportError: boolean;
}) {
  const status = data.catalogStatus.status;
  const latestStatus = latestImport?.import.status ?? null;
  const label = latestImportLoading
    ? "正在读取导入状态"
    : latestImportError
      ? "导入状态暂不可用"
      : latestStatus === "ready_to_publish"
        ? "最新导入等待发布"
        : latestStatus === "needs_review"
          ? "最新导入需要复核"
          : latestStatus === "completed"
            ? `${data.total} 个产品可用`
            : status === "importing"
              ? "正在分析产品来源"
              : status === "error"
                ? "最近导入异常"
                : status === "needs_review"
                  ? "部分数据待复核"
                  : `${data.total} 个产品可用`;
  const loading = latestImportLoading || (!latestImport && !latestImportError && status === "importing");
  const warning = latestImportError || latestStatus === "ready_to_publish" || latestStatus === "needs_review" || (!latestStatus && (status === "error" || status === "needs_review"));
  return (
    <div className="flex w-fit max-w-full items-center gap-2 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-xs text-[var(--cp-text-soft)]">
      {loading ? <Loader2 className="size-4 animate-spin" /> : warning ? <CircleAlert className="size-4 text-[var(--cp-warning)]" /> : <CheckCircle2 className="size-4 text-[var(--cp-success)]" />}
      <span className="truncate">{label}</span>
    </div>
  );
}

function WorkspaceError({ error, permissionDenied, onRetry }: { error: unknown; permissionDenied: boolean; onRetry: () => void }) {
  const requestError = error instanceof ProductCatalogRequestError ? error : null;
  return (
    <div className="mt-8 flex min-h-[300px] flex-col items-center justify-center border-y border-[var(--cp-border)] px-6 text-center" role="alert">
      {permissionDenied ? <LockKeyhole className="size-7 text-[var(--cp-text-faint)]" /> : <CircleAlert className="size-7 text-[var(--cp-danger)]" />}
      <h3 className="mb-0 mt-4 text-sm font-semibold">{permissionDenied ? "没有产品库查看权限" : "产品库暂时不可用"}</h3>
      <p className="mb-0 mt-2 max-w-[460px] text-xs leading-5 text-[var(--cp-text-muted)]">{permissionDenied ? "请联系工作区管理员授权，或切换到有权限的工作区。" : requestError?.message || "请稍后重新读取。"}</p>
      {requestError?.requestId ? <code className="mt-2 max-w-full truncate text-[10px] text-[var(--cp-text-faint)]">{requestError.requestId}</code> : null}
      {!permissionDenied ? (
        <Button type="button" variant="outline" className="mt-4 h-9 rounded-full" onClick={onRetry}>
          <RefreshCw className="size-4" />
          重新读取
        </Button>
      ) : null}
    </div>
  );
}

function WorkspaceEmpty({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction: () => void }) {
  return (
    <div className="mt-6 flex min-h-[260px] flex-col items-center justify-center border-y border-[var(--cp-border)] px-6 text-center">
      <Package className="size-7 text-[var(--cp-text-faint)]" strokeWidth={1.6} />
      <h3 className="mb-0 mt-4 text-sm font-semibold">{title}</h3>
      <p className="mb-0 mt-2 max-w-[440px] text-xs leading-5 text-[var(--cp-text-muted)]">{description}</p>
      {actionLabel ? <Button type="button" variant="outline" className="mt-4 h-9 rounded-full" onClick={onAction}>{actionLabel}</Button> : null}
    </div>
  );
}

function WorkspaceListSkeleton() {
  return (
    <div className="mt-5 border-y border-[var(--cp-border)]" aria-label="正在读取产品">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex min-h-[76px] items-center gap-3 border-b border-[var(--cp-border-subtle)] px-2 last:border-b-0">
          <div className="size-11 animate-pulse rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)]" />
          <div className="min-w-0 flex-1"><div className="h-3 w-2/5 animate-pulse rounded bg-[var(--cp-bg-muted)]" /><div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-[var(--cp-bg-muted)]" /></div>
        </div>
      ))}
    </div>
  );
}

function ProductImage({ product }: { product: ProductSummary }) {
  if (product.imageUrl) {
    return <img src={product.imageUrl} alt="" className="size-11 rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] object-cover" />;
  }
  return <span className="flex size-11 items-center justify-center rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)]"><Package className="size-5 text-[var(--cp-text-muted)]" /></span>;
}

function ProductStatus({ status }: { status: string }) {
  const active = /active|enabled|published|在售|可用/i.test(status);
  const label = active
    ? "可用"
    : /draft|草稿/i.test(status)
      ? "草稿"
      : /paused|暂停/i.test(status)
        ? "已暂停"
        : /archived|归档/i.test(status)
          ? "已归档"
          : "不可用";
  return (
    <span
      className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px]", active ? "bg-[var(--cp-success-bg)] text-[var(--cp-success)]" : "bg-[var(--cp-bg-muted)] text-[var(--cp-text-muted)]")}
      title={`系统状态：${status}`}
    >
      {label}
    </span>
  );
}

function ImportMetric({ label, value, last = false }: { label: string; value: number; last?: boolean }) {
  return <div className={cn("flex min-h-10 items-center justify-between gap-4 border-b border-[var(--cp-border-subtle)] py-2", last && "border-b-0")}><dt className="text-[var(--cp-text-muted)]">{label}</dt><dd className="m-0 font-medium text-[var(--cp-text)]">{value}</dd></div>;
}

function createIdempotencyKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `product-import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function productSourceTypeLabel(value: string): string {
  return ({
    string: "文本",
    number: "数值",
    boolean: "布尔",
    object: "对象",
    array: "列表",
    null: "空值",
  } as Record<string, string>)[value] ?? value;
}
