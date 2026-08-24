"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Sparkles,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AgentThreadStatus,
  ConversationMessage,
  PendingRequestUserInput,
  RequestUserInputQuestion,
} from "@/lib/agent/use-agent-thread";
import {
  tryParseStructuredCopywritingDraft,
  type CopywritingDraft,
} from "@/lib/copywriting/brief";
import {
  buildCopywritingRecipeQuestions,
  summarizeRecipeAnswers,
} from "@/lib/copywriting/recipe";
import { cn } from "@/lib/utils";

type UserInputAnswers = Record<string, { answers: string[] }>;
type RecipePhase = "idle" | "intake" | "executing" | "completed";
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
  messages,
  status,
  durationMs,
  startedAt,
  error,
  pendingUserInput,
  answeringUserInput,
  modelLabel,
  composerValue,
  onComposerChange,
  renderComposer,
  onAnswerUserInput,
  onExecute,
  onAdjust,
  onInterrupt,
}: {
  messages: ConversationMessage[];
  status: AgentThreadStatus;
  durationMs: number | null;
  startedAt: number | null;
  error: string | null;
  pendingUserInput: PendingRequestUserInput | null;
  answeringUserInput: boolean;
  modelLabel: string;
  composerValue: string;
  onComposerChange: (value: string) => void;
  renderComposer: (config: ComposerRenderConfig) => ReactNode;
  onAnswerUserInput: (answers: UserInputAnswers) => Promise<boolean>;
  onExecute: (goal: string, answerSummary: string) => void | Promise<void>;
  onAdjust: (instruction: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
}) {
  const [submittedGoal, setSubmittedGoal] = useState("");
  const [phase, setPhase] = useState<RecipePhase>("idle");
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [editableDraft, setEditableDraft] = useState<CopywritingDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [recipeQuestions, setRecipeQuestions] = useState<RequestUserInputQuestion[]>([]);
  const running = status === "connecting" || status === "running";
  const elapsedSeconds = useElapsedSeconds(running, startedAt, durationMs);
  const restoredGoal = useMemo(() => readOriginalRecipeGoal(messages), [messages]);
  const drafts = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            message.role === "assistant" &&
            message.status === "completed" &&
            message.phase !== "commentary" &&
            message.content.trim(),
        )
        .sort((left, right) => left.sequence - right.sequence)
        .map((message) => ({ id: message.id, draft: tryParseStructuredCopywritingDraft(message.content) }))
        .filter((entry): entry is { id: string; draft: CopywritingDraft } => Boolean(entry.draft)),
    [messages],
  );

  useEffect(() => {
    if (restoredGoal && !submittedGoal) {
      setSubmittedGoal(restoredGoal);
      setPhase(drafts.length ? "completed" : "intake");
    }
  }, [drafts.length, restoredGoal, submittedGoal]);

  useEffect(() => {
    if (pendingUserInput) setPhase("intake");
  }, [pendingUserInput]);

  useEffect(() => {
    if (!drafts.length) {
      setSelectedDraftIndex(0);
      setEditableDraft(null);
      return;
    }
    setSelectedDraftIndex(drafts.length - 1);
    setPhase("completed");
  }, [drafts.length]);

  useEffect(() => {
    const selected = drafts[selectedDraftIndex];
    setEditableDraft(selected ? { ...selected.draft } : null);
  }, [drafts, selectedDraftIndex]);

  async function startIntake() {
    const normalizedGoal = composerValue.trim();
    if (!normalizedGoal) {
      setGoalError("请用一句话说明你想完成什么文案。");
      return;
    }
    setGoalError(null);
    setSubmittedGoal(normalizedGoal);
    onComposerChange("");
    const questions = buildCopywritingRecipeQuestions(normalizedGoal);
    if (!questions.length) {
      setPhase("executing");
      await onExecute(normalizedGoal, "");
      return;
    }
    setRecipeQuestions(questions);
    setPhase("intake");
  }

  async function answerQuestions(answers: UserInputAnswers, summary: string) {
    if (recipeQuestions.length) {
      const recipeSummary = summary || summarizeRecipeAnswers(recipeQuestions, answers);
      setRecipeQuestions([]);
      setPhase("executing");
      await onExecute(submittedGoal, recipeSummary);
      return;
    }
    const accepted = await onAnswerUserInput(answers);
    if (!accepted) return;
  }

  async function submitAdjustment() {
    const instruction = composerValue.trim();
    if (!instruction || running) return;
    onComposerChange("");
    setPhase("executing");
    await onAdjust(instruction);
  }

  async function copyDraft() {
    if (!editableDraft) return;
    const content = [editableDraft.title, editableDraft.body, editableDraft.callToAction]
      .filter(Boolean)
      .join("\n\n");
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)] pt-14 md:pt-0">
      <header className="flex h-[var(--cp-topbar-height)] shrink-0 items-center justify-between border-b border-[var(--cp-border-subtle)] px-5 md:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] bg-[#f2f1ed] text-[#655e4f]">
            <FileText className="size-[18px]" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-semibold">文案生成</h1>
            <p className="m-0 truncate text-xs text-[var(--cp-text-faint)]">{modelLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <span className="cp-running-shimmer hidden text-xs sm:inline">
              {pendingUserInput ? "等待你的回答" : `正在处理 ${elapsedSeconds} 秒`}
            </span>
          ) : drafts.length ? (
            <span className="hidden text-xs text-[var(--cp-text-faint)] sm:inline">{drafts.length} 个版本</span>
          ) : null}
          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="size-9 rounded-full" aria-label="停止任务" onClick={onInterrupt}>
                  <Square className="size-3.5 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>停止任务</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      {submittedGoal ? (
        <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--cp-border-subtle)] px-5 md:px-8">
          <span className="shrink-0 text-xs font-medium text-[var(--cp-text-faint)]">任务目标</span>
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--cp-text-soft)]">{submittedGoal}</span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {!submittedGoal ? (
          <CopywritingStarter
            error={goalError}
            onStarterSelect={onComposerChange}
            composer={renderComposer({
              placeholder: "例如：给这款轻量通勤包写一套小红书上新文案",
              onSubmit: startIntake,
            })}
          />
        ) : pendingUserInput || recipeQuestions.length ? (
          <RequestUserInputPanel
            questions={pendingUserInput?.questions ?? recipeQuestions}
            submitting={answeringUserInput}
            onSubmit={answerQuestions}
          />
        ) : drafts.length && editableDraft ? (
          <CopywritingEditor
            drafts={drafts}
            selectedDraftIndex={selectedDraftIndex}
            editableDraft={editableDraft}
            copied={copied}
            error={error}
            onSelectDraft={setSelectedDraftIndex}
            onDraftChange={setEditableDraft}
            onCopy={copyDraft}
            composer={renderComposer({
              placeholder: "继续调整语气、结构或卖点顺序",
              onSubmit: submitAdjustment,
            })}
          />
        ) : (
          <div className="flex min-h-full items-center justify-center px-5 py-16">
            <div className="text-center">
              <span className="cp-running-shimmer text-sm">
                {phase === "intake" ? "正在理解任务并确认关键信息" : "正在生成可编辑文案"}
              </span>
              {error ? <p className="mb-0 mt-4 text-xs text-[var(--cp-danger)]">{error}</p> : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CopywritingStarter({
  error,
  onStarterSelect,
  composer,
}: {
  error: string | null;
  onStarterSelect: (value: string) => void;
  composer: ReactNode;
}) {
  return (
    <section className="mx-auto flex min-h-full w-full max-w-[760px] flex-col justify-center px-5 py-16 md:px-8">
      <div className="text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-muted)] text-[var(--cp-text-soft)]">
          <Sparkles className="size-5" strokeWidth={1.8} />
        </span>
        <h2 className="mb-0 mt-5 text-[24px] font-semibold leading-tight">想完成什么文案？</h2>
      </div>
      <div className="mt-8">{composer}</div>
      {error ? <p className="mb-0 mt-3 text-center text-xs text-[var(--cp-danger)]">{error}</p> : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {starterGoals.map((starter) => (
          <button
            key={starter}
            type="button"
            className="rounded-[var(--cp-radius-segment)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)] hover:text-[var(--cp-text)]"
            onClick={() => onStarterSelect(starter)}
          >
            {starter}
          </button>
        ))}
      </div>
    </section>
  );
}

function RequestUserInputPanel({
  questions,
  submitting,
  onSubmit,
}: {
  questions: RequestUserInputQuestion[];
  submitting: boolean;
  onSubmit: (answers: UserInputAnswers, summary: string) => void | Promise<void>;
}) {
  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const question = questions[index];
  if (!question) return null;
  const selected = selections[question.id] ?? "";
  const note = notes[question.id] ?? "";
  const canContinue = Boolean(selected && (selected !== "__other__" || note.trim()));
  const last = index === questions.length - 1;

  async function submitAnswers() {
    const answers: UserInputAnswers = {};
    const summary: string[] = [];
    for (const item of questions) {
      const selection = selections[item.id];
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
    <section className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center px-5 py-14 md:px-8">
      <div className="rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-5 shadow-[var(--cp-shadow-soft)] md:p-7">
        <div className="flex items-center justify-between gap-4 text-xs text-[var(--cp-text-faint)]">
          <span>{question.header}</span>
          <span>问题 {index + 1}/{questions.length}</span>
        </div>
        <h2 className="mb-0 mt-4 text-[19px] font-semibold leading-7">{question.question}</h2>
        <div className="mt-5 space-y-2">
          {question.options.map((option) => {
            const cleanLabel = option.label.replace(/\s*\(Recommended\)\s*/i, "");
            const recommended = /\(Recommended\)/i.test(option.label);
            return (
              <button
                key={option.label}
                type="button"
                className={cn(
                  "grid w-full grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-[var(--cp-radius-item)] border px-4 py-3 text-left",
                  selected === option.label
                    ? "border-[var(--cp-text)] bg-[var(--cp-bg-subtle)]"
                    : "border-[var(--cp-border)] hover:bg-[var(--cp-bg-subtle)]",
                )}
                onClick={() => setSelections((current) => ({ ...current, [question.id]: option.label }))}
              >
                <span className={cn("mt-0.5 size-4 rounded-full border", selected === option.label ? "border-[5px] border-[var(--cp-text)]" : "border-[var(--cp-border-strong)]")} />
                <span>
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {cleanLabel}
                    {recommended ? <span className="text-[10px] font-normal text-[var(--cp-success)]">推荐</span> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--cp-text-muted)]">{option.description}</span>
                </span>
              </button>
            );
          })}
          {question.isOther ? (
            <button
              type="button"
              className={cn(
                "grid w-full grid-cols-[20px_minmax(0,1fr)] gap-3 rounded-[var(--cp-radius-item)] border px-4 py-3 text-left",
                selected === "__other__" ? "border-[var(--cp-text)] bg-[var(--cp-bg-subtle)]" : "border-[var(--cp-border)] hover:bg-[var(--cp-bg-subtle)]",
              )}
              onClick={() => setSelections((current) => ({ ...current, [question.id]: "__other__" }))}
            >
              <span className={cn("mt-0.5 size-4 rounded-full border", selected === "__other__" ? "border-[5px] border-[var(--cp-text)]" : "border-[var(--cp-border-strong)]")} />
              <span className="text-sm font-medium">其他</span>
            </button>
          ) : null}
        </div>
        <textarea
          value={note}
          onChange={(event) => setNotes((current) => ({ ...current, [question.id]: event.target.value }))}
          rows={2}
          className="mt-4 max-h-28 min-h-[64px] w-full resize-y rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 text-sm leading-6 outline-none placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-text-muted)]"
          placeholder={selected === "__other__" ? "填写你的答案" : "补充说明（可选）"}
        />
        <div className="mt-5 flex items-center justify-between gap-3">
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
            {last ? (submitting ? "正在提交" : "开始生成") : "下一题"}
            {!last ? <ChevronRight className="size-4" /> : null}
          </Button>
        </div>
      </div>
    </section>
  );
}

function CopywritingEditor({
  drafts,
  selectedDraftIndex,
  editableDraft,
  copied,
  error,
  onSelectDraft,
  onDraftChange,
  onCopy,
  composer,
}: {
  drafts: Array<{ id: string; draft: CopywritingDraft }>;
  selectedDraftIndex: number;
  editableDraft: CopywritingDraft;
  copied: boolean;
  error: string | null;
  onSelectDraft: (index: number) => void;
  onDraftChange: (draft: CopywritingDraft) => void;
  onCopy: () => void | Promise<void>;
  composer: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--cp-border-subtle)] px-5 md:px-8">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-2">
          {drafts.map((draft, index) => (
            <button
              key={draft.id}
              type="button"
              className={cn(
                "h-8 shrink-0 rounded-[var(--cp-radius-segment)] px-3 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)]",
                selectedDraftIndex === index && "bg-[var(--cp-bg-muted)] font-medium text-[var(--cp-text)]",
              )}
              onClick={() => onSelectDraft(index)}
            >
              版本 {index + 1}
            </button>
          ))}
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-9" aria-label="复制文案" onClick={onCopy}>
          {copied ? <Check className="size-4 text-[var(--cp-success)]" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-5 py-8 md:px-10 md:py-10">
          <input
            value={editableDraft.title}
            onChange={(event) => onDraftChange({ ...editableDraft, title: event.target.value })}
            className="w-full border-0 bg-transparent text-[24px] font-semibold leading-tight text-[var(--cp-text)] outline-none"
          />
          <textarea
            value={editableDraft.body}
            onChange={(event) => onDraftChange({ ...editableDraft, body: event.target.value })}
            className="mt-6 min-h-[320px] w-full flex-1 resize-none border-0 bg-transparent text-[15px] leading-8 text-[var(--cp-text-soft)] outline-none"
          />
          <div className="mt-6 border-t border-[var(--cp-border-subtle)] pt-5">
            <label className="text-xs font-medium text-[var(--cp-text-muted)]" htmlFor="copywriting-cta">行动引导</label>
            <input
              id="copywriting-cta"
              value={editableDraft.callToAction}
              onChange={(event) => onDraftChange({ ...editableDraft, callToAction: event.target.value })}
              className="mt-2 w-full border-0 bg-transparent text-sm text-[var(--cp-text-soft)] outline-none placeholder:text-[var(--cp-text-faint)]"
              placeholder="可选"
            />
          </div>
          {editableDraft.complianceNotes.length ? (
            <div className="mt-6 flex items-start gap-2 border-t border-[var(--cp-border-subtle)] pt-5 text-xs leading-5 text-[var(--cp-warning)]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
              <div>{editableDraft.complianceNotes.map((note) => <p key={note} className="m-0">{note}</p>)}</div>
            </div>
          ) : null}
          {error ? <p className="mt-5 text-xs text-[var(--cp-danger)]">{error}</p> : null}
        </div>
      </div>
      <div className="shrink-0 border-t border-[var(--cp-border-subtle)] bg-[var(--cp-bg)] px-4 py-3 md:px-8">
        {composer}
      </div>
    </div>
  );
}

function readOriginalRecipeGoal(messages: ConversationMessage[]): string {
  const firstUserMessage = [...messages]
    .filter((message) => message.role === "user")
    .sort((left, right) => left.sequence - right.sequence)[0];
  if (!firstUserMessage) return "";
  const content = firstUserMessage.content
    .replace(/^\$commerce-copywriting(?:-intake)?\s*/i, "")
    .trim();
  const goal = content.match(/^用户目标：(.+)$/m)?.[1]?.trim();
  return goal || content;
}

function useElapsedSeconds(running: boolean, startedAt: number | null, durationMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [running, startedAt]);
  if (running && startedAt) return Math.max(1, Math.floor((now - startedAt) / 1_000));
  if (durationMs) return Math.max(1, Math.round(durationMs / 1_000));
  return 1;
}
