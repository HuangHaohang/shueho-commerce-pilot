"use client";

import { Database, Globe2, Telescope } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type ComposerRenderConfig = {
  placeholder: string;
  disabled?: boolean;
  onSubmit: () => void | Promise<void>;
};

const starterGoals = [
  "调研轻量通勤双肩包的主流价格带和卖点",
  "比较小红书与抖音同类商品的内容趋势",
  "分析三个竞品的用户反馈与机会点",
  "研究这个品类适合合作的达人类型",
] as const;

export function MarketResearchWorkspace({
  modelLabel,
  composerValue,
  error,
  externalDataAvailable,
  onComposerChange,
  renderComposer,
  onExecute,
}: {
  modelLabel: string;
  composerValue: string;
  error: string | null;
  externalDataAvailable: boolean;
  onComposerChange: (value: string) => void;
  renderComposer: (config: ComposerRenderConfig) => ReactNode;
  onExecute: (goal: string) => void | Promise<void>;
}) {
  const [goalError, setGoalError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function startTask() {
    const goal = composerValue.trim();
    if (!goal || starting) {
      if (!goal) setGoalError("请说明要研究的市场、品类、竞品或决策问题。");
      return;
    }
    setGoalError(null);
    setStarting(true);
    onComposerChange("");
    try {
      await onExecute(goal);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)] pt-14 md:pt-0">
      <header className="flex h-[var(--cp-topbar-height)] shrink-0 items-center justify-between gap-4 border-b border-[var(--cp-border-subtle)] px-5 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] bg-[#edf4f1] text-[#2f6d5c]">
            <Telescope className="size-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-semibold">市场调研</h1>
            <p className="m-0 truncate text-xs text-[var(--cp-text-faint)]">{modelLabel}</p>
          </div>
        </div>
        <div className="hidden items-center gap-4 text-xs text-[var(--cp-text-muted)] sm:flex" aria-label="调研数据源状态">
          <span className="inline-flex items-center gap-1.5">
            <Globe2 className="size-3.5" strokeWidth={1.8} />
            公开网页
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Database className="size-3.5" strokeWidth={1.8} />
            {externalDataAvailable ? "外部数据已连接" : "外部数据待配置"}
          </span>
        </div>
      </header>

      <section className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col justify-center px-5 py-12 md:px-8 md:py-16">
        <div className="text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)] text-[var(--cp-text-soft)]">
            <Telescope className="size-5" strokeWidth={1.8} />
          </span>
          <h2 className="mb-0 mt-5 text-[24px] font-semibold leading-tight">想研究哪个市场？</h2>
        </div>

        <div className="mt-8">
          {renderComposer({
            placeholder: "例如：研究 300-500 元通勤双肩包的竞品、价格带与内容机会",
            disabled: starting,
            onSubmit: startTask,
          })}
        </div>

        {starting ? <p className="cp-running-shimmer mb-0 mt-3 text-center text-xs">正在建立调研任务</p> : null}
        {goalError || error ? (
          <p className="mb-0 mt-3 text-center text-xs text-[var(--cp-danger)]">{goalError || error}</p>
        ) : null}

        <div className="mt-5 grid gap-1 sm:grid-cols-2" aria-label="市场调研常用任务">
          {starterGoals.map((starter) => (
            <button
              key={starter}
              type="button"
              className="min-h-10 rounded-[var(--cp-radius-item)] px-3 py-2 text-left text-xs leading-5 text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
              onClick={() => onComposerChange(starter)}
            >
              {starter}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
