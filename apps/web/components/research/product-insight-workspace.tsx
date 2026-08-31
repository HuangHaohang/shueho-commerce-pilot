"use client";

import {
  ChartNoAxesCombined,
  Database,
  Globe2,
  Lightbulb,
  PackageSearch,
  Scale,
  ShieldCheck,
  Telescope,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import type { ProductContextMode, ProductSummary } from "@/lib/products/catalog";
import {
  type ProductInsightMethod,
} from "@/lib/research/product-insight-contract";
import { cn } from "@/lib/utils";

type ComposerRenderConfig = {
  placeholder: string;
  disabled?: boolean;
  onSubmit: () => void | Promise<void>;
};

type InsightMethodDefinition = {
  id: ProductInsightMethod;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const productInsightMethods: readonly InsightMethodDefinition[] = [
  {
    id: "market_research",
    label: "市场调研",
    description: "真实竞品与买家反馈验证",
    icon: Telescope,
  },
  {
    id: "new_product_development",
    label: "新品开发",
    description: "定位、规格与验证方案",
    icon: Lightbulb,
  },
  {
    id: "product_retrospective",
    label: "产品复盘",
    description: "产品事实与市场适配复盘",
    icon: ChartNoAxesCombined,
  },
] as const;

const categoryResearchStarters = [
  "调研轻量通勤双肩包的主流价格带和卖点",
  "比较小红书与抖音同类商品的内容趋势",
  "分析三个竞品的买家反馈与机会点",
  "研究这个品类适合合作的达人类型",
] as const;

const categoryDevelopmentStarters = [
  "从买家痛点和竞品缺口中定义一个值得开发的新品方向",
  "分析目标品类的价格带，并给出新品定位与首发规格建议",
  "把市场机会拆成目标人群、使用场景、核心卖点和验证指标",
  "为一个新品概念制定小批量验证、内容测试和上市门槛",
] as const;

export type ProductInsightPresentation = {
  title: string;
  placeholder: string;
  starterGoals: string[];
  starterLabel: string;
  productRequired: boolean;
};

const decisionWorkflowStages = {
  market_research: [
    ["决策范围", "明确市场、商品与问题"],
    ["事实基线", "读取产品版本与已知限制"],
    ["证据账本", "核验市场、竞品与评论回执"],
    ["Scorecard / Gate", "给出可解释评分与下一步"],
  ],
  new_product_development: [
    ["机会证据", "区分需求信号与普通属性"],
    ["概念假设", "形成定位、规格与风险"],
    ["机会 Scorecard", "逐维评分，不用黑盒总分"],
    ["验证 Gate", "定义实验、成功与停止条件"],
  ],
  product_retrospective: [
    ["冻结产品版本", "以当前 Product revision 为准"],
    ["证据分层", "经营数据缺失时明确不可用"],
    ["诊断假设", "相关性不冒充经营根因"],
    ["行动 Gate", "保留、验证、暂停都有依据"],
  ],
} as const satisfies Record<ProductInsightMethod, readonly (readonly [string, string])[]>;

export function productInsightPresentation(
  method: ProductInsightMethod,
  mode: ProductContextMode,
  products: ProductSummary[],
): ProductInsightPresentation {
  const hasSelectedProduct = mode === "selected" && products.length > 0;
  const subject = hasSelectedProduct
    ? products.length === 1
      ? products[0].title
      : `${products[0].title}等 ${products.length} 个产品`
    : null;

  if (method === "new_product_development") {
    return subject
      ? {
          title: `想从「${subject}」延伸什么新品？`,
          placeholder: `例如：基于「${subject}」的用户反馈与竞争缺口，设计一个差异化新品方案`,
          starterGoals: [
            `分析「${subject}」尚未覆盖的用户痛点，提出新品机会`,
            `基于「${subject}」和竞品反馈，设计新品定位、规格与价格假设`,
            `围绕「${subject}」规划一个可验证的产品线延伸方案`,
            `为「${subject}」的新品方向制定样品、内容与首发验证指标`,
          ],
          starterLabel: "基于已选产品的新品开发任务",
          productRequired: false,
        }
      : {
          title: "想开发哪一类新品？",
          placeholder: "例如：面向小户型家庭，基于真实需求和竞争缺口设计一款易清洁砂锅",
          starterGoals: [...categoryDevelopmentStarters],
          starterLabel: "新品开发常用任务",
          productRequired: false,
        };
  }

  if (method === "product_retrospective") {
    if (!subject) {
      return {
        title: "先选择要复盘的产品",
        placeholder: "请先通过下方“产品库”选择产品；如有经营报表，可附上作为待核验上下文",
        starterGoals: [],
        starterLabel: "产品复盘要求",
        productRequired: true,
      };
    }
    return {
      title: `想复盘「${subject}」的哪段表现？`,
      placeholder: `例如：结合「${subject}」近 90 天经营附件与市场反馈，梳理卖点、差评和待验证的转化问题`,
      starterGoals: [
        `复盘「${subject}」的卖点表达与真实买家反馈是否一致`,
        `结合经营数据附件，梳理「${subject}」表现变化的可能驱动因素与需要验证的数据`,
        `比较「${subject}」与竞品的价格、规格和评价差距`,
        `为「${subject}」输出保留、改进、停止事项和下一周期验证指标`,
      ],
      starterLabel: "基于已选产品的复盘任务",
      productRequired: false,
    };
  }

  return subject
    ? {
        title: `想验证「${subject}」的哪个市场机会？`,
        placeholder: `例如：基于真实市场反馈验证「${subject}」的核心卖点、用户痛点与价格机会`,
        starterGoals: [
          `基于真实市场反馈，验证「${subject}」最有竞争力的卖点`,
          `分析「${subject}」所在品类的用户痛点，并判断我们的产品是否覆盖`,
          `比较「${subject}」与主流竞品的价格带、规格和差异`,
          `研究「${subject}」适合的内容主题、使用场景和推广机会`,
        ],
        starterLabel: "基于已选产品的市场调研任务",
        productRequired: false,
      }
    : {
        title: "想研究哪个市场？",
        placeholder: "例如：研究 300-500 元通勤双肩包的竞品、价格带与内容机会",
        starterGoals: [...categoryResearchStarters],
        starterLabel: "市场调研常用任务",
        productRequired: false,
      };
}

export function ProductInsightWorkspace({
  method,
  modelLabel,
  composerValue,
  error,
  externalDataAvailable,
  selectedProducts,
  productContextMode,
  onMethodChange,
  onComposerChange,
  renderComposer,
  onExecute,
}: {
  method: ProductInsightMethod;
  modelLabel: string;
  composerValue: string;
  error: string | null;
  externalDataAvailable: boolean;
  selectedProducts: ProductSummary[];
  productContextMode: ProductContextMode;
  onMethodChange: (method: ProductInsightMethod) => void;
  onComposerChange: (value: string) => void;
  renderComposer: (config: ComposerRenderConfig) => ReactNode;
  onExecute: (method: ProductInsightMethod, goal: string) => boolean | Promise<boolean>;
}) {
  const [goalError, setGoalError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const definition = productInsightMethods.find((item) => item.id === method) ?? productInsightMethods[0];
  const ActiveIcon = definition.icon;
  const presentation = productInsightPresentation(method, productContextMode, selectedProducts);

  useEffect(() => {
    setGoalError(null);
  }, [method, productContextMode, selectedProducts.length]);

  async function startTask() {
    const goal = composerValue.trim();
    if (presentation.productRequired) {
      setGoalError("产品复盘必须先从产品库选择至少一个产品。选择后仍会在同一个 Harness 对话中继续。");
      return;
    }
    if (!goal || starting) {
      if (!goal) setGoalError(`请说明这次${definition.label}要解决的业务问题。`);
      return;
    }
    setGoalError(null);
    setStarting(true);
    try {
      const accepted = await onExecute(method, goal);
      if (accepted) {
        onComposerChange("");
      } else {
        setGoalError("任务没有被 Harness 接受，输入已保留，请检查上方提示后重试。");
      }
    } catch {
      setGoalError("任务提交失败，输入已保留，请稍后重试。");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)] pt-14 md:pt-0">
      <header className="flex min-h-[var(--cp-topbar-height)] shrink-0 items-center justify-between gap-4 border-b border-[var(--cp-border-subtle)] px-5 py-2 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] bg-[#edf4f1] text-[#2f6d5c]">
            <PackageSearch className="size-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-semibold">商品决策</h1>
            <p className="m-0 truncate text-xs text-[var(--cp-text-faint)]">
              {definition.label} · 证据账本 · Scorecard · 决策 Gate · {modelLabel}
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-4 text-xs text-[var(--cp-text-muted)] lg:flex" aria-label="商品决策数据源状态">
          <span className="inline-flex items-center gap-1.5">
            <Globe2 className="size-3.5" strokeWidth={1.8} />
            公开网页辅助
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Database className="size-3.5" strokeWidth={1.8} />
            {externalDataAvailable ? "市场证据已连接" : "市场证据待配置"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <PackageSearch className="size-3.5" strokeWidth={1.8} />
            {productContextMode === "selected" && selectedProducts.length > 0
              ? `产品事实 ${selectedProducts.length}`
              : "产品事实自动匹配"}
          </span>
        </div>
      </header>

      <section className="mx-auto flex min-h-0 w-full max-w-[860px] flex-1 flex-col justify-center overflow-y-auto px-5 py-7 md:px-8 md:py-10">
        <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="选择电商决策 Skill">
          {productInsightMethods.map((item) => {
            const Icon = item.icon;
            const selected = item.id === method;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                data-insight-method={item.id}
                className={cn(
                  "min-w-0 rounded-[var(--cp-radius-item)] border px-2 py-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--cp-focus)] sm:px-3 sm:py-3 sm:text-left",
                  selected
                    ? "border-[#9fc6ba] bg-[#f1f7f5] text-[var(--cp-text)]"
                    : "border-[var(--cp-border-subtle)] bg-[var(--cp-surface)] text-[var(--cp-text-soft)] hover:bg-[var(--cp-surface-hover)]",
                )}
                onClick={() => onMethodChange(item.id)}
              >
                <span className="flex items-center justify-center gap-1.5 sm:justify-start sm:gap-2">
                  <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                  <span className="truncate text-sm font-medium">{item.label}</span>
                </span>
                <span className="mt-1.5 block text-[10px] leading-[15px] text-[var(--cp-text-muted)] sm:text-[11px] sm:leading-4">
                  {item.description}
                </span>
              </button>
            );
          })}
        </div>

        <ol className="m-0 mt-4 grid list-none grid-cols-2 gap-x-4 gap-y-3 border-y border-[var(--cp-border-subtle)] px-0 py-3 sm:grid-cols-4" aria-label={`${definition.label}交付流程`}>
          {decisionWorkflowStages[method].map(([label, description], index) => (
            <li key={label} className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--cp-text)]">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--cp-bg-muted)] text-[10px] tabular-nums text-[var(--cp-text-muted)]">
                  {index + 1}
                </span>
                <span className="truncate">{label}</span>
              </div>
              <p className="mb-0 mt-1 pl-[26px] text-[10px] leading-4 text-[var(--cp-text-faint)]">{description}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)] text-[var(--cp-text-soft)]">
            <ActiveIcon className="size-[18px]" strokeWidth={1.8} />
          </span>
          <h2 className="mb-0 mt-4 text-[23px] font-semibold leading-tight">{presentation.title}</h2>
          <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-[var(--cp-text-faint)]" aria-label="商品决策交付保证">
            <span className="inline-flex items-center gap-1"><ShieldCheck className="size-3.5" aria-hidden="true" />证据逐条可核对</span>
            <span className="inline-flex items-center gap-1"><Scale className="size-3.5" aria-hidden="true" />评分维度可解释</span>
          </div>
        </div>

        <div className="mt-6">
          {renderComposer({
            placeholder: presentation.placeholder,
            disabled: starting,
            onSubmit: startTask,
          })}
        </div>

        {presentation.productRequired ? (
          <p className="mb-0 mt-3 text-center text-xs text-[var(--cp-text-muted)]">
            使用输入框下方的“产品库”选择产品。CSV、XLSX 或报表附件只作为待核验上下文，不会冒充已连接的企业经营指标。
          </p>
        ) : null}
        {starting ? <p className="cp-running-shimmer mb-0 mt-3 text-center text-xs">正在建立{definition.label}任务</p> : null}
        {goalError || error ? (
          <p className="mb-0 mt-3 text-center text-xs text-[var(--cp-danger)]" role="alert">{goalError || error}</p>
        ) : null}

        {presentation.starterGoals.length ? (
          <div className="mt-4 grid gap-1 sm:grid-cols-2" aria-label={presentation.starterLabel}>
            {presentation.starterGoals.map((starter) => (
              <button
                key={starter}
                type="button"
                className="min-h-9 rounded-[var(--cp-radius-item)] px-3 py-1.5 text-left text-xs leading-5 text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
                onClick={() => onComposerChange(starter)}
              >
                {starter}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
