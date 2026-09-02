"use client";

import { FileText, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

type ComposerRenderConfig = {
  placeholder: string;
  disabled?: boolean;
  onSubmit: () => void | Promise<void>;
};

const starterGoals = [
  "给这款商品写一套上新文案",
  "把现有卖点改成小红书风格",
  "生成淘宝商品标题和五点卖点",
] as const;

export function CopywritingWorkspace({
  modelLabel,
  composerValue,
  error,
  onComposerChange,
  renderComposer,
  onExecute,
}: {
  modelLabel: string;
  composerValue: string;
  error: string | null;
  onComposerChange: (value: string) => void;
  renderComposer: (config: ComposerRenderConfig) => ReactNode;
  onExecute: (goal: string) => void | Promise<void>;
}) {
  const [goalError, setGoalError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function startTask() {
    const goal = composerValue.trim();
    if (!goal || starting) {
      if (!goal) setGoalError("请用一句话说明你想完成什么文案。");
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
      <header className="flex h-[var(--cp-topbar-height)] shrink-0 items-center border-b border-[var(--cp-border-subtle)] px-5 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] bg-[#f2f1ed] text-[#655e4f]">
            <FileText className="size-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-semibold">文案生成</h1>
            <p className="m-0 truncate text-xs text-[var(--cp-text-faint)]">{modelLabel}</p>
          </div>
        </div>
      </header>

      <section className="flex min-h-0 w-full flex-1 flex-col justify-center px-5 py-16 md:px-8 xl:px-10">
        <div className="text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)] text-[var(--cp-text-soft)]">
            <Sparkles className="size-5" strokeWidth={1.8} />
          </span>
          <h2 className="mb-0 mt-5 text-[24px] font-semibold leading-tight">想完成什么文案？</h2>
        </div>
        <div className="mt-8">
          {renderComposer({
            placeholder: "例如：给这款轻量通勤包写一套小红书上新文案",
            disabled: starting,
            onSubmit: startTask,
          })}
        </div>
        {starting ? <p className="cp-running-shimmer mb-0 mt-3 text-center text-xs">正在创建文案任务</p> : null}
        {goalError || error ? (
          <p className="mb-0 mt-3 text-center text-xs text-[var(--cp-danger)]">{goalError || error}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {starterGoals.map((starter) => (
            <button
              key={starter}
              type="button"
              className="rounded-[var(--cp-radius-segment)] px-3 py-2 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)]"
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
