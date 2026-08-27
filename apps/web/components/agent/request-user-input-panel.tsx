"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { RequestUserInputQuestion } from "@/lib/agent/use-agent-thread";
import { cn } from "@/lib/utils";

type UserInputAnswers = Record<string, { answers: string[] }>;

export function AgentRequestUserInputPanel({
  questions,
  submitting,
  submitLabel = "确认",
  onSubmit,
}: {
  questions: RequestUserInputQuestion[];
  submitting: boolean;
  submitLabel?: string;
  onSubmit: (answers: UserInputAnswers, summary: string) => void | Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const question = questions[index];
  if (!question) return null;
  const freeformOnly = question.options.length === 0;
  const selected = freeformOnly ? "__other__" : selections[question.id] ?? "";
  const note = notes[question.id] ?? "";
  const canContinue = Boolean(selected && (selected !== "__other__" || note.trim()));
  const last = index === questions.length - 1;

  async function submitAnswers() {
    const answers: UserInputAnswers = {};
    const summary: string[] = [];
    for (const item of questions) {
      const itemFreeformOnly = item.options.length === 0;
      const selection = itemFreeformOnly ? "__other__" : selections[item.id];
      const itemNote = notes[item.id]?.trim() ?? "";
      if (!selection || (selection === "__other__" && !itemNote)) return;
      const selectedLabel = selection === "__other__" ? itemNote : selection;
      const values = [selectedLabel, ...(selection !== "__other__" && itemNote ? [`补充：${itemNote}`] : [])];
      answers[item.id] = { answers: values };
      summary.push(`${item.question} ${values.join("；")}`);
    }
    await onSubmit(answers, summary.join("\n"));
  }

  return (
    <section className="mx-auto flex w-full max-w-[768px] flex-col px-1" data-agent-user-input>
      <div className="max-h-[60vh] overflow-y-auto overscroll-contain rounded-[20px] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-3 shadow-[var(--cp-shadow-popover)] md:p-4">
        <div className="flex items-start justify-between gap-4 px-1">
          <div>
            <div className="text-[11px] text-[var(--cp-text-faint)]">{question.header}</div>
            <h2 className="mb-0 mt-1 text-[15px] font-semibold leading-6">{question.question}</h2>
          </div>
          <span className="shrink-0 pt-0.5 text-[11px] text-[var(--cp-text-faint)]">{index + 1}/{questions.length}</span>
        </div>

        <div className="mt-3 space-y-1">
          {question.options.map((option, optionIndex) => {
            const cleanLabel = option.label.replace(/\s*\(Recommended\)\s*/i, "");
            const recommended = /\(Recommended\)/i.test(option.label);
            const active = selected === option.label;
            return (
              <button
                key={option.label}
                type="button"
                className={cn(
                  "grid w-full grid-cols-[28px_minmax(0,1fr)_20px] items-center gap-3 rounded-[var(--cp-radius-item)] px-2 py-2.5 text-left transition-colors",
                  active ? "bg-[var(--cp-bg-subtle)]" : "hover:bg-[var(--cp-bg-subtle)]",
                )}
                onClick={() => setSelections((current) => ({ ...current, [question.id]: option.label }))}
              >
                <span className="flex size-7 items-center justify-center rounded-full border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] text-xs text-[var(--cp-text-muted)]">
                  {optionIndex + 1}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {cleanLabel}
                    {recommended ? <span className="text-[10px] font-normal text-[var(--cp-text-faint)]">推荐</span> : null}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--cp-text-muted)]">{option.description}</span>
                </span>
                <ArrowRight className={cn("size-4", active ? "text-[var(--cp-text)]" : "text-transparent")} />
              </button>
            );
          })}

          {question.isOther && !freeformOnly ? (
            <button
              type="button"
              className={cn(
                "grid w-full grid-cols-[28px_minmax(0,1fr)] items-center gap-3 rounded-[var(--cp-radius-item)] px-2 py-2.5 text-left transition-colors",
                selected === "__other__" ? "bg-[var(--cp-bg-subtle)]" : "hover:bg-[var(--cp-bg-subtle)]",
              )}
              onClick={() => setSelections((current) => ({ ...current, [question.id]: "__other__" }))}
            >
              <span className="flex size-7 items-center justify-center rounded-full border border-[var(--cp-border)] text-[var(--cp-text-muted)]">
                <Plus className="size-3.5" />
              </span>
              <span className="text-sm font-medium">其他</span>
            </button>
          ) : null}
        </div>

        {question.isSecret ? (
          <input
            type="password"
            value={note}
            onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))}
            className="mt-2 h-10 w-full rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm outline-none placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-text-muted)]"
            placeholder="填写你的答案"
            autoComplete="off"
          />
        ) : (
          <textarea
            value={note}
            onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))}
            rows={1}
            className="mt-2 max-h-20 min-h-10 w-full resize-y rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-sm leading-6 outline-none placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-text-muted)]"
            placeholder={selected === "__other__" ? "填写你的答案" : "补充说明（可选）"}
          />
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" className="h-9" disabled={index === 0 || submitting} onClick={() => setIndex((current) => current - 1)}>
            <ChevronLeft className="size-4" />
            上一题
          </Button>
          <Button
            type="button"
            className="h-9 bg-[var(--cp-text)] px-4 text-white hover:bg-[#262626]"
            disabled={!canContinue || submitting}
            onClick={() => (last ? void submitAnswers() : setIndex((current) => current + 1))}
          >
            {last ? (submitting ? "正在提交" : submitLabel) : "下一题"}
            {!last ? <ChevronRight className="size-4" /> : null}
          </Button>
        </div>
      </div>
    </section>
  );
}
