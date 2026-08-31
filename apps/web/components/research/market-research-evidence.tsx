"use client";

import { ChevronDown, Database, ExternalLink, Globe2, ReceiptText, ShieldCheck, ShieldQuestion } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { AgentActivity } from "@/lib/agent/use-agent-thread";
import type { WebSource } from "@/lib/agent/web-sources";
import type { ResearchEvidenceReceipt, ResearchPlanReceipt } from "@/lib/agent/tool-activity";
import type { MarketResearchReceipt } from "@/lib/research/market-report";
import { cn } from "@/lib/utils";

type SafeEvidenceRow = {
  id: string;
  verified: boolean;
  platform: string | null;
  observedAt: string;
  evidenceCount: number;
  reviewEvidenceCount: number;
  evidenceKinds: string[];
  coverageSummary: string;
  missingMetrics: string[];
  limitations: string[];
};

export function ResearchPlanReceiptCard({ receipt }: { receipt: ResearchPlanReceipt }) {
  const price = receipt.quote
    ? !receipt.quote.priced || receipt.quote.billableAmountMicros === null
      ? "存在未定价调用"
      : `预计 ${formatMicros(receipt.quote.billableAmountMicros, receipt.quote.currency)}`
    : "报价不可用";
  return (
    <section className="rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-3 py-2.5" aria-label="免费市场研究计划">
      <div className="flex items-center gap-2 text-xs font-medium">
        <ReceiptText className="size-4 text-[var(--cp-text-muted)]" aria-hidden="true" />
        免费研究计划
      </div>
      <dl className="mb-0 mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] leading-5 text-[var(--cp-text-muted)]">
        {receipt.coverage.platform ? (
          <div><dt className="inline">平台：</dt><dd className="inline">{receipt.coverage.platform}</dd></div>
        ) : null}
        {receipt.coverage.market ? (
          <div><dt className="inline">市场：</dt><dd className="inline">{receipt.coverage.market}</dd></div>
        ) : null}
        <div><dt className="inline">预计调用：</dt><dd className="inline">{receipt.estimatedProviderCalls} 次</dd></div>
        <div><dt className="inline">费用：</dt><dd className="inline">{price}</dd></div>
        {receipt.coverage.plannedProducts !== null ? (
          <div><dt className="inline">代表商品：</dt><dd className="inline">{receipt.coverage.plannedProducts} 个</dd></div>
        ) : null}
        {receipt.productCount !== null ? (
          <div><dt className="inline">企业产品：</dt><dd className="inline">{receipt.productCount} 个</dd></div>
        ) : null}
      </dl>
      {receipt.coverage.requestedMetrics.length ? (
        <p className="mb-0 mt-1 text-[10px] text-[var(--cp-text-faint)]">指标：{receipt.coverage.requestedMetrics.join("、")}</p>
      ) : null}
      {receipt.snapshotSha256 ? (
        <p className="mb-0 mt-1 truncate font-mono text-[10px] text-[var(--cp-text-faint)]" title={receipt.snapshotSha256}>
          产品快照 {receipt.snapshotSha256.slice(0, 12)}…
        </p>
      ) : null}
      <p className="mb-0 mt-1 text-[10px] text-[var(--cp-text-faint)]">计划有效期至 {formatObservedAt(receipt.expiresAt)}</p>
    </section>
  );
}

export function ResearchEvidencePanel({
  activities,
  reportReceipts,
  webSources,
}: {
  activities: readonly AgentActivity[];
  reportReceipts: readonly MarketResearchReceipt[];
  webSources: readonly WebSource[];
}) {
  const plans = activities
    .map((activity) => activity.research)
    .filter((receipt): receipt is ResearchPlanReceipt => receipt?.kind === "plan");
  const evidenceRows = buildEvidenceRows(activities, reportReceipts);
  const totalReviewEvidence = evidenceRows.reduce((total, row) => total + row.reviewEvidenceCount, 0);
  const hasResearchEvidence = plans.length > 0 || evidenceRows.length > 0;

  return (
    <div data-research-evidence-panel>
      <div className="flex items-center justify-between gap-3 text-sm text-[var(--cp-text-muted)]">
        <span>{hasResearchEvidence ? "研究证据" : "来源"}</span>
        <span className="text-xs text-[var(--cp-text-faint)]">{plans.length + evidenceRows.length + webSources.length}</span>
      </div>

      {plans.length ? (
        <div className="mt-3 space-y-2">
          {plans.slice(-2).map((plan, index) => (
            <ResearchPlanReceiptCard key={`${plan.snapshotSha256 ?? "category"}-${plan.expiresAt}-${index}`} receipt={plan} />
          ))}
        </div>
      ) : null}

      {evidenceRows.length ? (
        <div className="mt-3 space-y-2">
          {totalReviewEvidence === 0 ? (
            <div className="rounded-[var(--cp-radius-item)] bg-[var(--cp-warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--cp-warning)]">
              暂无买家评论证据，用户痛点只能作为待验证假设。
            </div>
          ) : null}
          {evidenceRows.map((row) => <EvidenceReceiptDisclosure key={row.id} row={row} />)}
        </div>
      ) : null}

      {webSources.length ? (
        <div className="mt-4 border-t border-[var(--cp-border-subtle)] pt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--cp-text-muted)]">
            <Globe2 className="size-3.5" aria-hidden="true" />
            公开网页
          </div>
          <div className="space-y-1">
            {webSources.map((source) => (
              <a
                key={source.url}
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-9 items-center gap-2 rounded-[var(--cp-radius-item)] px-2 py-1.5 text-sm text-[var(--cp-text-soft)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              >
                <ExternalLink className="size-3.5 shrink-0 text-[var(--cp-text-faint)]" aria-hidden="true" />
                <span className="min-w-0 truncate">{source.title || sourceHostname(source.url)}</span>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {!plans.length && !evidenceRows.length && !webSources.length ? (
        <div className="mt-3 text-sm text-[var(--cp-text-faint)]">暂无可审计来源</div>
      ) : null}
    </div>
  );
}

export function ResearchToolReceiptView({ receipt }: { receipt: ResearchPlanReceipt | ResearchEvidenceReceipt }) {
  return receipt.kind === "plan"
    ? <ResearchPlanReceiptCard receipt={receipt} />
    : <EvidenceReceiptDisclosure row={evidenceProjectionRow(receipt)} />;
}

export function ResearchEvidenceMobileSheet({
  activities,
  reportReceipts,
  webSources,
}: {
  activities: readonly AgentActivity[];
  reportReceipts: readonly MarketResearchReceipt[];
  webSources: readonly WebSource[];
}) {
  const planCount = activities.filter((activity) => activity.research?.kind === "plan").length;
  const count = planCount + buildEvidenceRows(activities, reportReceipts).length + webSources.length;
  if (!count) return null;
  return (
    <div className="mx-auto mb-1 flex w-full max-w-[768px] justify-end px-1 2xl:hidden">
      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            aria-label={`查看研究证据，共 ${count} 项`}
          >
            <Database className="size-4" aria-hidden="true" />
            研究证据 · {count}
          </button>
        </SheetTrigger>
        <SheetContent className="flex flex-col px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-5">
          <SheetTitle>研究证据与数据回执</SheetTitle>
          <SheetDescription className="mt-1">产品事实、外部市场数据与公开网页保持独立来源。</SheetDescription>
          <div className="cp-flat-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pb-3">
            <ResearchEvidencePanel activities={activities} reportReceipts={reportReceipts} webSources={webSources} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function buildEvidenceRows(
  activities: readonly AgentActivity[],
  reportReceipts: readonly MarketResearchReceipt[],
): SafeEvidenceRow[] {
  const rows = new Map<string, SafeEvidenceRow>();
  // Seed the model-authored report projection first. When the same research
  // request has an actual Harness tool receipt, that authoritative projection
  // must overwrite the report rather than the other way around.
  for (const receipt of reportReceipts) {
    rows.set(receipt.researchRequestId, {
      id: receipt.researchRequestId,
      verified: false,
      platform: receipt.platform || null,
      observedAt: receipt.observedAt,
      evidenceCount: receipt.evidenceCount,
      reviewEvidenceCount: receipt.reviewEvidenceCount,
      evidenceKinds: receipt.evidenceKinds,
      coverageSummary: receipt.coverageSummary,
      missingMetrics: [],
      limitations: receipt.limitations,
    });
  }
  for (const activity of activities) {
    const receipt = activity.research;
    if (receipt?.kind !== "evidence") continue;
    rows.set(receipt.researchRequestId, evidenceProjectionRow(receipt));
  }
  return [...rows.values()];
}

function evidenceProjectionRow(receipt: ResearchEvidenceReceipt): SafeEvidenceRow {
  const kinds = [
    receipt.coverage.acceptedProducts && receipt.coverage.acceptedProducts > 0 ? "product" : null,
    receipt.reviewEvidenceCount > 0 ? "review" : null,
  ].filter((kind): kind is string => Boolean(kind));
  return {
    id: receipt.researchRequestId,
    verified: true,
    platform: receipt.platform,
    observedAt: receipt.observedAt,
    evidenceCount: receipt.evidenceCount,
    reviewEvidenceCount: receipt.reviewEvidenceCount,
    evidenceKinds: kinds,
    coverageSummary: [
      receipt.coverage.acceptedProducts === null ? null : `${receipt.coverage.acceptedProducts} 个商品`,
      receipt.coverage.acceptedEvidence === null ? null : `${receipt.coverage.acceptedEvidence} 条质量证据`,
    ].filter(Boolean).join("；"),
    missingMetrics: receipt.coverage.missingRequestedMetrics,
    limitations: receipt.limitations,
  };
}

function EvidenceReceiptDisclosure({ row }: { row: SafeEvidenceRow }) {
  const ReceiptIcon = row.verified ? ShieldCheck : ShieldQuestion;
  return (
    <details className="group rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] px-3 py-2">
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]">
        <ReceiptIcon
          className={cn(
            "size-4 shrink-0",
            row.verified ? "text-[var(--cp-success)]" : "text-[var(--cp-warning)]",
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{row.platform || "外部市场数据"}</span>
          <span className="block truncate text-[10px] text-[var(--cp-text-faint)]">
            {row.evidenceCount} 条证据 · 评论 {row.reviewEvidenceCount} 条
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-[var(--cp-text-faint)] transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-2 border-t border-[var(--cp-border-subtle)] pt-2 text-[11px] leading-5 text-[var(--cp-text-muted)]">
        {!row.verified ? (
          <p className="m-0 text-[var(--cp-warning)]">报告引用 · 尚未与本任务的 Harness 工具回执核对</p>
        ) : null}
        <p className="m-0 break-all font-mono text-[10px]">研究回执：{row.id}</p>
        <p className="m-0 mt-1">观测时间：{formatObservedAt(row.observedAt)}</p>
        {row.evidenceKinds.length ? <p className="m-0 mt-1">证据类型：{row.evidenceKinds.join("、")}</p> : null}
        {row.coverageSummary ? <p className="m-0 mt-1">覆盖范围：{row.coverageSummary}</p> : null}
        {row.missingMetrics.length ? <p className="m-0 mt-1 text-[var(--cp-warning)]">缺失指标：{row.missingMetrics.join("、")}</p> : null}
        {row.limitations.length ? <p className="m-0 mt-1">限制：{row.limitations.join("；")}</p> : null}
      </div>
    </details>
  );
}

function formatMicros(value: number, currency: string): string {
  return `${currency} ${(value / 1_000_000).toFixed(4)}`;
}

function formatObservedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function sourceHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}
