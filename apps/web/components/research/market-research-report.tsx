import {
  ChartNoAxesCombined,
  CheckCircle2,
  CircleAlert,
  CirclePause,
  ClipboardCheck,
  Database,
  FlaskConical,
  PackageSearch,
  ShieldQuestion,
  Sparkles,
} from "lucide-react";

import { AssistantMarkdown } from "@/components/agent/assistant-markdown";
import type {
  MarketResearchClaim,
  MarketResearchResponse,
} from "@/lib/research/market-report";
import type { AgentActivity } from "@/lib/agent/use-agent-thread";
import { reconcileReportEvidence } from "@/lib/research/report-evidence-verification";
import { cn } from "@/lib/utils";

const confidenceLabels = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
} as const;

const insightTypeLabels = {
  market_research: "市场调研报告",
  new_product_development: "新品开发方案",
  product_retrospective: "产品复盘报告",
} as const;

const priorityLabels = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级",
} as const;

export function MarketResearchReportView({
  response,
  activities = [],
}: {
  response: MarketResearchResponse;
  activities?: readonly AgentActivity[];
}) {
  if (response.responseType === "answer") {
    return <AssistantMarkdown content={response.message} />;
  }

  const scopeSummary = [
    ...response.scope.platforms,
    ...response.scope.markets,
    response.scope.period,
  ].filter(Boolean);
  const evidenceVerification = reconcileReportEvidence(response.receipts, activities);
  const totalReviewEvidence = evidenceVerification.receipts.reduce(
    (total, receipt) => total + receipt.reviewEvidenceCount,
    0,
  );
  const reportLabel = insightTypeLabels[response.insightType];

  return (
    <article data-market-research-report data-product-insight-report={response.insightType} className="min-w-0 text-[14px] leading-6 text-[var(--cp-text)]">
      <header className="border-b border-[var(--cp-border-subtle)] pb-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--cp-text-muted)]">
          <span className="inline-flex h-6 items-center rounded-full bg-[var(--cp-bg-subtle)] px-2.5">
            {reportLabel}
          </span>
          {response.subject.productCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <PackageSearch className="size-3.5" aria-hidden="true" />
              {response.subject.productCount} 个企业产品
            </span>
          ) : null}
          {evidenceVerification.receipts.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Database className="size-3.5" aria-hidden="true" />
              已核验 {evidenceVerification.verifiedCount} / {evidenceVerification.receipts.length} 份市场回执
            </span>
          ) : null}
        </div>
        <h2 className="mb-0 mt-3 text-[22px] font-semibold leading-8">
          {response.subject.title || reportLabel}
        </h2>
        {response.scope.decisionObjective ? (
          <p className="mb-0 mt-1 text-sm text-[var(--cp-text-muted)]">{response.scope.decisionObjective}</p>
        ) : null}
        {scopeSummary.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="研究范围">
            {scopeSummary.map((item) => (
              <span key={item} className="rounded-full border border-[var(--cp-border)] px-2.5 py-0.5 text-[11px] text-[var(--cp-text-muted)]">
                {item}
              </span>
            ))}
          </div>
        ) : null}
      </header>

      {response.decisionGate ? <DecisionGateView gate={response.decisionGate} /> : null}

      {response.executiveSummary ? (
        <section className="my-5 rounded-[var(--cp-radius-panel)] bg-[var(--cp-bg-subtle)] px-4 py-3.5" aria-labelledby="research-summary-title">
          <h3 id="research-summary-title" className="m-0 text-xs font-semibold text-[var(--cp-text-muted)]">结论摘要</h3>
          <p className="mb-0 mt-1.5 text-sm leading-6">{response.executiveSummary}</p>
        </section>
      ) : null}

      {response.scorecard && response.scorecard.dimensions.length ? (
        <DecisionScorecardView scorecard={response.scorecard} marketEvidenceVerified={evidenceVerification.allVerified} />
      ) : null}

      <AssistantMarkdown content={response.reportMarkdown} />

      {response.experiments.length ? (
        <section className="mt-7 border-t border-[var(--cp-border-subtle)] pt-5" aria-labelledby="insight-experiments-title">
          <h3 id="insight-experiments-title" className="m-0 text-[15px] font-semibold">验证实验</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
            实验均为待审批建议；这里定义成功信号和停止条件，不表示已经执行。
          </p>
          <div className="mt-3 space-y-2">
            {response.experiments.map((experiment) => (
              <article key={experiment.experimentId} className="rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[10px] font-medium text-[var(--cp-text-muted)]">
                  <FlaskConical className="size-3.5" aria-hidden="true" />
                  待执行验证
                </div>
                <h4 className="mb-0 mt-1 text-sm font-medium">{experiment.title}</h4>
                <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">假设：{experiment.hypothesis}</p>
                <dl className="mb-0 mt-2 grid gap-x-4 gap-y-1 text-[11px] leading-5 sm:grid-cols-2">
                  <div><dt className="text-[var(--cp-text-faint)]">方法</dt><dd className="m-0">{experiment.method}</dd></div>
                  <div><dt className="text-[var(--cp-text-faint)]">成功信号</dt><dd className="m-0">{experiment.successSignal}</dd></div>
                  <div><dt className="text-[var(--cp-text-faint)]">停止条件</dt><dd className="m-0">{experiment.stopCondition}</dd></div>
                  <div><dt className="text-[var(--cp-text-faint)]">仍需证据</dt><dd className="m-0">{experiment.evidenceNeeded.join("；") || "无"}</dd></div>
                </dl>
                {experiment.evidenceIds.length > 0 && !evidenceVerification.allVerified ? (
                  <p className="mb-0 mt-1 text-[11px] text-[var(--cp-warning)]">实验依据包含尚未核对的市场证据引用。</p>
                ) : null}
                <EvidenceReferenceDisclosure productFactRefs={experiment.productFactRefs} evidenceIds={experiment.evidenceIds} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {response.recommendations.length ? (
        <section className="mt-7 border-t border-[var(--cp-border-subtle)] pt-5" aria-labelledby="insight-recommendations-title">
          <h3 id="insight-recommendations-title" className="m-0 text-[15px] font-semibold">建议动作</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
            每项建议都保留决策依据、验证指标和时间范围；建议不是已发生的经营结果。
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {response.recommendations.map((recommendation) => (
              <div key={recommendation.recommendationId} className="rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--cp-text-muted)]">
                    <ClipboardCheck className="size-3.5" aria-hidden="true" />
                    {priorityLabels[recommendation.priority]}
                  </span>
                  <span className="text-[10px] text-[var(--cp-text-faint)]">{recommendation.timeHorizon}</span>
                </div>
                <h4 className="mb-0 mt-1 text-sm font-medium leading-5">{recommendation.title}</h4>
                <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">{recommendation.rationale}</p>
                <p className="mb-0 mt-2 text-[11px] leading-5">
                  <span className="text-[var(--cp-text-faint)]">验证指标：</span>{recommendation.validationMetric}
                </p>
                <EvidenceReferenceDisclosure
                  productFactRefs={recommendation.productFactRefs}
                  evidenceIds={recommendation.evidenceIds}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {response.claims.length ? (
        <section className="mt-7 border-t border-[var(--cp-border-subtle)] pt-5" aria-labelledby="research-claims-title">
          <h3 id="research-claims-title" className="m-0 text-[15px] font-semibold">结论依据</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
            产品资料、真实市场证据和 AI 推断分别标记，避免把分析当成事实。企业经营指标尚未接入，不会在这里伪造。
          </p>
          <div className="mt-3 space-y-2">
            {response.claims.map((claim) => (
              <ResearchClaimRow
                key={claim.claimId}
                claim={claim}
                marketEvidenceVerified={evidenceVerification.allVerified}
              />
            ))}
          </div>
        </section>
      ) : null}

      {evidenceVerification.receipts.length ? (
        <section className="mt-7 border-t border-[var(--cp-border-subtle)] pt-5" aria-labelledby="research-receipts-title">
          <h3 id="research-receipts-title" className="m-0 text-[15px] font-semibold">数据回执与证据</h3>
          <p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-muted)]">
            这里只显示报告引用的安全摘要，不展示供应商原始响应、内部接口或个人作者信息；最终以“研究证据”面板中的 Harness 工具回执为准。
          </p>
          {totalReviewEvidence === 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-[var(--cp-radius-item)] bg-[var(--cp-warning-bg)] px-3 py-2.5 text-xs leading-5 text-[var(--cp-warning)]" role="note">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>本报告没有买家评论证据；涉及“用户痛点”的内容只能视为待验证假设，不能标记为已证实。</span>
            </div>
          ) : null}
          <div className="mt-3 space-y-2">
            {evidenceVerification.receipts.map((receipt) => (
              <details key={receipt.researchRequestId} className="group rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] px-3 py-2">
                <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{receipt.platform || "外部市场数据"}</span>
                    <span className="block truncate text-[11px] text-[var(--cp-text-muted)]">
                      {receipt.evidenceCount} 条证据 · 其中评论 {receipt.reviewEvidenceCount} 条
                    </span>
                    <span className={cn(
                      "mt-0.5 block text-[10px]",
                      receipt.verification === "verified" ? "text-[var(--cp-success)]" : "text-[var(--cp-warning)]",
                    )}>
                      {receipt.verification === "verified"
                        ? "已与本任务 Harness 工具回执核对"
                        : receipt.verification === "mismatch"
                          ? "模型摘要与工具回执不一致，以下使用工具回执"
                          : "报告引用待核对，不作为已验证证据"}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] text-[var(--cp-text-faint)] group-open:hidden">展开</span>
                  <span className="hidden shrink-0 text-[11px] text-[var(--cp-text-faint)] group-open:inline">收起</span>
                </summary>
                <div className="mt-2 border-t border-[var(--cp-border-subtle)] pt-2 text-xs leading-5 text-[var(--cp-text-muted)]">
                  <p className="m-0 break-all font-mono text-[10px]">研究回执：{receipt.researchRequestId}</p>
                  {receipt.observedAt ? <p className="m-0 mt-1">观测时间：{receipt.observedAt}</p> : null}
                  {receipt.evidenceKinds.length ? <p className="m-0 mt-1">证据类型：{receipt.evidenceKinds.join("、")}</p> : null}
                  {receipt.coverageSummary ? <p className="m-0 mt-1">覆盖范围：{receipt.coverageSummary}</p> : null}
                  {receipt.missingMetrics.length ? <p className="m-0 mt-1 text-[var(--cp-warning)]">缺失指标：{receipt.missingMetrics.join("、")}</p> : null}
                  {receipt.limitations.length ? <p className="m-0 mt-1">限制：{receipt.limitations.join("；")}</p> : null}
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}

      {response.subject.factLimitations.length ? (
        <section className="mt-5 flex items-start gap-2 rounded-[var(--cp-radius-item)] bg-[var(--cp-warning-bg)] px-3 py-2.5 text-xs leading-5 text-[var(--cp-warning)]" aria-label="产品事实限制">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">产品事实限制</div>
            {response.subject.factLimitations.map((limitation) => <p key={limitation} className="m-0 mt-0.5">{limitation}</p>)}
          </div>
        </section>
      ) : null}
    </article>
  );
}

function ResearchClaimRow({
  claim,
  marketEvidenceVerified,
}: {
  claim: MarketResearchClaim;
  marketEvidenceVerified: boolean;
}) {
  const presentation = claimPresentation(claim.type);
  const ClaimIcon = presentation.icon;
  return (
    <div className="rounded-[var(--cp-radius-item)] border border-[var(--cp-border-subtle)] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-medium", presentation.className)}>
          <ClaimIcon className="size-3.5" aria-hidden="true" />
          {presentation.label}
        </span>
        <span className="text-[10px] text-[var(--cp-text-faint)]">{confidenceLabels[claim.confidence]}</span>
      </div>
      <p className="mb-0 mt-1.5 text-sm leading-6">{claim.text}</p>
      {claim.limitations.length ? (
        <p className="mb-0 mt-1 text-[11px] leading-5 text-[var(--cp-text-muted)]">
          限制：{claim.limitations.join("；")}
        </p>
      ) : null}
      {claim.evidenceIds.length > 0 && !marketEvidenceVerified ? (
        <p className="mb-0 mt-1 text-[11px] leading-5 text-[var(--cp-warning)]">
          市场证据引用尚未全部与本轮 Harness 工具回执核对。
        </p>
      ) : null}
      <EvidenceReferenceDisclosure
        productFactRefs={claim.productFactRefs}
        evidenceIds={claim.evidenceIds}
      />
    </div>
  );
}

function DecisionGateView({ gate }: { gate: NonNullable<MarketResearchResponse["decisionGate"]> }) {
  const presentation = decisionGatePresentation(gate.status);
  const GateIcon = presentation.icon;
  return (
    <section className={cn("mt-5 rounded-[var(--cp-radius-item)] border px-4 py-3", presentation.className)} aria-labelledby="decision-gate-title">
      <div className="flex items-start gap-3">
        <GateIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="decision-gate-title" className="m-0 text-sm font-semibold">决策 Gate · {presentation.label}</h3>
            <span className="text-[10px] opacity-70">建议状态，尚未审批或执行</span>
          </div>
          <p className="mb-0 mt-1 text-sm leading-6">{gate.summary}</p>
          {gate.blockingGaps.length ? <p className="mb-0 mt-1 text-xs leading-5">阻塞项：{gate.blockingGaps.join("；")}</p> : null}
          {gate.requiredEvidence.length ? <p className="mb-0 mt-1 text-xs leading-5">继续前需要：{gate.requiredEvidence.join("；")}</p> : null}
        </div>
      </div>
    </section>
  );
}

function DecisionScorecardView({
  scorecard,
  marketEvidenceVerified,
}: {
  scorecard: NonNullable<MarketResearchResponse["scorecard"]>;
  marketEvidenceVerified: boolean;
}) {
  return (
    <section className="my-6 border-y border-[var(--cp-border-subtle)] py-5" aria-labelledby="decision-scorecard-title">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="decision-scorecard-title" className="m-0 flex items-center gap-1.5 text-[15px] font-semibold">
            <ChartNoAxesCombined className="size-4" aria-hidden="true" />
            可解释机会 Scorecard
          </h3>
          <p className="mb-0 mt-1 text-xs text-[var(--cp-text-muted)]">总分只作参考，决策必须查看每个分项的证据状态和限制。</p>
        </div>
        <div className="text-right">
          <div className="text-[22px] font-semibold tabular-nums">{Math.round(scorecard.weightedScore)}<span className="ml-0.5 text-xs font-normal text-[var(--cp-text-faint)]">/100</span></div>
          <div className="text-[10px] text-[var(--cp-text-faint)]">整体证据置信度：{confidenceLabels[scorecard.confidence]}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
        {scorecard.dimensions.map((dimension) => (
          <article key={dimension.dimensionId} className="min-w-0">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium">{dimension.label}</span>
              <span className="shrink-0 tabular-nums">{Math.round(dimension.score)} · 权重 {Math.round(dimension.weight * 100)}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--cp-bg-muted)]" role="meter" aria-label={`${dimension.label}评分`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={dimension.score}>
              <div className="h-full rounded-full bg-[var(--cp-text-muted)]" style={{ width: `${Math.max(0, Math.min(100, dimension.score))}%` }} />
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--cp-text-faint)]">
              <span>{evidenceStateLabel(dimension.evidenceState)}</span>
              {dimension.evidenceIds.length > 0 && !marketEvidenceVerified ? <span className="text-[var(--cp-warning)]">· 回执待核对</span> : null}
            </div>
            <p className="mb-0 mt-1 text-[11px] leading-5 text-[var(--cp-text-muted)]">{dimension.rationale}</p>
            {dimension.limitations.length ? (
              <p className="mb-0 mt-1 text-[10px] leading-4 text-[var(--cp-text-faint)]">限制：{dimension.limitations.join("；")}</p>
            ) : null}
            <EvidenceReferenceDisclosure productFactRefs={dimension.productFactRefs} evidenceIds={dimension.evidenceIds} />
          </article>
        ))}
      </div>
    </section>
  );
}

function decisionGatePresentation(status: NonNullable<MarketResearchResponse["decisionGate"]>["status"]) {
  if (status === "proceed") return { label: "继续推进", icon: CheckCircle2, className: "border-[var(--cp-success)]/30 bg-[var(--cp-success-bg)] text-[var(--cp-success)]" };
  if (status === "validate") return { label: "小规模验证", icon: FlaskConical, className: "border-[var(--cp-warning)]/30 bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]" };
  if (status === "hold") return { label: "暂停", icon: CirclePause, className: "border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] text-[var(--cp-text-muted)]" };
  return { label: "证据不足", icon: ShieldQuestion, className: "border-[var(--cp-warning)]/30 bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]" };
}

function evidenceStateLabel(state: NonNullable<MarketResearchResponse["scorecard"]>["dimensions"][number]["evidenceState"]) {
  if (state === "supported") return "证据支持";
  if (state === "mixed") return "证据分歧";
  if (state === "hypothesis") return "待验证假设";
  return "证据不可用";
}

function EvidenceReferenceDisclosure({
  productFactRefs,
  evidenceIds,
}: {
  productFactRefs: string[];
  evidenceIds: string[];
}) {
  if (!productFactRefs.length && !evidenceIds.length) return null;
  return (
    <details className="group mt-1.5 text-[11px] text-[var(--cp-text-muted)]">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center rounded-[var(--cp-radius-xs)] px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]">
        依据 · 产品事实 {productFactRefs.length} · 市场证据 {evidenceIds.length}
      </summary>
      <div className="mt-1 space-y-1 border-l-2 border-[var(--cp-border-subtle)] pl-3">
        {productFactRefs.map((reference) => (
          <p key={`product-${reference}`} className="m-0 break-all">
            <span className="text-[var(--cp-info)]">产品事实</span> · <code className="font-mono text-[10px]">{reference}</code>
          </p>
        ))}
        {evidenceIds.map((reference) => (
          <p key={`evidence-${reference}`} className="m-0 break-all">
            <span className="text-[var(--cp-success)]">市场证据</span> · <code className="font-mono text-[10px]">{reference}</code>
          </p>
        ))}
      </div>
    </details>
  );
}

function claimPresentation(type: MarketResearchClaim["type"]) {
  if (type === "product_fact") {
    return {
      label: "产品事实",
      icon: PackageSearch,
      className: "bg-[var(--cp-info-bg)] text-[var(--cp-info)]",
    };
  }
  if (type === "market_signal") {
    return {
      label: "市场证据",
      icon: Database,
      className: "bg-[var(--cp-success-bg)] text-[var(--cp-success)]",
    };
  }
  return {
    label: type === "hypothesis" ? "AI 推断 · 待验证" : "AI 推断 · 对比分析",
    icon: Sparkles,
    className: "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]",
  };
}
