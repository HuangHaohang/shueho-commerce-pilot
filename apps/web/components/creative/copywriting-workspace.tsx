"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  RefreshCw,
  SendHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentThreadStatus, ConversationMessage } from "@/lib/agent/use-agent-thread";
import {
  copywritingChannels,
  copywritingLengths,
  copywritingTones,
  copywritingTypes,
  parseCopywritingBriefPrompt,
  parseCopywritingDraft,
  validateCopywritingBrief,
  type CopywritingBrief,
  type CopywritingDraft,
} from "@/lib/copywriting/brief";
import { cn } from "@/lib/utils";

const initialBrief: CopywritingBrief = {
  channel: "淘宝/天猫",
  copyType: "商品卖点",
  productName: "",
  sellingPoints: "",
  audience: "",
  tone: "专业克制",
  approximateLength: 150,
  requiredWording: "",
  prohibitedWording: "",
};

export function CopywritingWorkspace({
  messages,
  status,
  durationMs,
  startedAt,
  error,
  modelLabel,
  onGenerate,
  onAdjust,
  onInterrupt,
}: {
  messages: ConversationMessage[];
  status: AgentThreadStatus;
  durationMs: number | null;
  startedAt: number | null;
  error: string | null;
  modelLabel: string;
  onGenerate: (brief: CopywritingBrief) => void | Promise<void>;
  onAdjust: (instruction: string) => void | Promise<void>;
  onInterrupt: () => void | Promise<void>;
}) {
  const [brief, setBrief] = useState<CopywritingBrief>(initialBrief);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [editableDraft, setEditableDraft] = useState<CopywritingDraft | null>(null);
  const [adjustment, setAdjustment] = useState("");
  const [copied, setCopied] = useState(false);
  const hydratedBriefMessageIdRef = useRef<string | null>(null);
  const running = status === "connecting" || status === "running";
  const elapsedSeconds = useElapsedSeconds(running, startedAt, durationMs);
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
        .map((message) => ({ id: message.id, draft: parseCopywritingDraft(message.content) })),
    [messages],
  );
  const savedBriefMessage = useMemo(
    () => messages.find((message) => message.role === "user" && parseCopywritingBriefPrompt(message.content)),
    [messages],
  );

  useEffect(() => {
    if (!savedBriefMessage || hydratedBriefMessageIdRef.current === savedBriefMessage.id) return;
    const savedBrief = parseCopywritingBriefPrompt(savedBriefMessage.content);
    if (savedBrief) {
      setBrief(savedBrief);
      hydratedBriefMessageIdRef.current = savedBriefMessage.id;
    }
  }, [savedBriefMessage]);

  useEffect(() => {
    if (!drafts.length) {
      setSelectedDraftIndex(0);
      setEditableDraft(null);
      return;
    }
    setSelectedDraftIndex(drafts.length - 1);
  }, [drafts.length]);

  useEffect(() => {
    const selected = drafts[selectedDraftIndex];
    setEditableDraft(selected ? { ...selected.draft } : null);
  }, [drafts, selectedDraftIndex]);

  async function generateDraft() {
    const validationError = validateCopywritingBrief(brief);
    if (validationError) {
      setBriefError(validationError);
      return;
    }
    setBriefError(null);
    await onGenerate(brief);
  }

  async function submitAdjustment() {
    const instruction = adjustment.trim();
    if (!instruction || running) return;
    setAdjustment("");
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
              正在生成 {elapsedSeconds} 秒
            </span>
          ) : drafts.length ? (
            <span className="hidden text-xs text-[var(--cp-text-faint)] sm:inline">
              {drafts.length} 个版本
            </span>
          ) : null}
          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9 rounded-full"
                  aria-label="停止生成"
                  onClick={onInterrupt}
                >
                  <Square className="size-3.5 fill-current" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>停止生成</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[324px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-b border-[var(--cp-border)] bg-[var(--cp-sidebar)] md:border-b-0 md:border-r">
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-6">
            <BriefSection label="文案类型">
              <div className="grid grid-cols-2 gap-1 rounded-[var(--cp-radius-control)] bg-[var(--cp-bg-muted)] p-1">
                {copywritingTypes.map((copyType) => (
                  <button
                    key={copyType}
                    type="button"
                    className={cn(
                      "h-9 rounded-[var(--cp-radius-item)] px-2 text-xs text-[var(--cp-text-muted)] transition-colors hover:text-[var(--cp-text)]",
                      brief.copyType === copyType &&
                        "bg-[var(--cp-surface)] font-medium text-[var(--cp-text)] shadow-[var(--cp-shadow-soft)]",
                    )}
                    onClick={() => setBrief((current) => ({ ...current, copyType }))}
                  >
                    {copyType}
                  </button>
                ))}
              </div>
            </BriefSection>

            <BriefSection label="渠道">
              <SelectField
                value={brief.channel}
                onChange={(value) =>
                  setBrief((current) => ({ ...current, channel: value as CopywritingBrief["channel"] }))
                }
                options={copywritingChannels}
              />
            </BriefSection>

            <BriefSection label="商品名称" required>
              <input
                value={brief.productName}
                onChange={(event) => setBrief((current) => ({ ...current, productName: event.target.value }))}
                className={fieldClassName}
                placeholder="例如：轻量通勤双肩包"
                maxLength={120}
              />
            </BriefSection>

            <BriefSection label="核心卖点" required>
              <textarea
                value={brief.sellingPoints}
                onChange={(event) => setBrief((current) => ({ ...current, sellingPoints: event.target.value }))}
                className={cn(fieldClassName, "min-h-[92px] resize-y py-2.5 leading-5")}
                placeholder="每行一个卖点，尽量提供可核验事实"
                maxLength={1_200}
              />
            </BriefSection>

            <BriefSection label="目标人群">
              <input
                value={brief.audience}
                onChange={(event) => setBrief((current) => ({ ...current, audience: event.target.value }))}
                className={fieldClassName}
                placeholder="例如：城市通勤人群"
                maxLength={160}
              />
            </BriefSection>

            <BriefSection label="表达语气">
              <SelectField
                value={brief.tone}
                onChange={(value) =>
                  setBrief((current) => ({ ...current, tone: value as CopywritingBrief["tone"] }))
                }
                options={copywritingTones}
              />
            </BriefSection>

            <BriefSection label="目标字数">
              <div className="grid grid-cols-4 gap-1">
                {copywritingLengths.map((length) => (
                  <button
                    key={length}
                    type="button"
                    className={cn(
                      "h-9 rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)]",
                      brief.approximateLength === length &&
                        "border-[var(--cp-text)] bg-[var(--cp-text)] text-white hover:bg-[var(--cp-text)]",
                    )}
                    onClick={() => setBrief((current) => ({ ...current, approximateLength: length }))}
                  >
                    {length}
                  </button>
                ))}
              </div>
            </BriefSection>

            <BriefSection label="必须包含">
              <input
                value={brief.requiredWording}
                onChange={(event) => setBrief((current) => ({ ...current, requiredWording: event.target.value }))}
                className={fieldClassName}
                placeholder="品牌词、活动词或固定表达"
                maxLength={300}
              />
            </BriefSection>

            <BriefSection label="禁用词">
              <input
                value={brief.prohibitedWording}
                onChange={(event) => setBrief((current) => ({ ...current, prohibitedWording: event.target.value }))}
                className={fieldClassName}
                placeholder="用顿号分隔"
                maxLength={300}
              />
            </BriefSection>

          </div>
          <div className="shrink-0 border-t border-[var(--cp-border-subtle)] bg-[var(--cp-sidebar)] px-5 py-3">
            {briefError ? <p className="mb-2 mt-0 text-xs text-[var(--cp-danger)]">{briefError}</p> : null}
            <Button
              type="button"
              className="h-11 w-full rounded-[var(--cp-radius-control)] bg-[var(--cp-text)] text-white hover:bg-[#262626]"
              disabled={running}
              onClick={generateDraft}
            >
              {drafts.length ? <RefreshCw className="size-4" /> : <Sparkles className="size-4" />}
              {drafts.length ? "生成新版本" : "生成文案"}
            </Button>
          </div>
        </aside>

        <section className="flex min-h-[600px] min-w-0 flex-col md:min-h-0">
          <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-[var(--cp-border-subtle)] px-5 md:px-8">
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-2">
              {drafts.length ? (
                drafts.map((draft, index) => (
                  <button
                    key={draft.id}
                    type="button"
                    className={cn(
                      "h-8 shrink-0 rounded-[var(--cp-radius-segment)] px-3 text-xs text-[var(--cp-text-muted)] hover:bg-[var(--cp-surface-hover)]",
                      selectedDraftIndex === index && "bg-[var(--cp-bg-muted)] font-medium text-[var(--cp-text)]",
                    )}
                    onClick={() => setSelectedDraftIndex(index)}
                  >
                    版本 {index + 1}
                  </button>
                ))
              ) : (
                <span className="text-xs text-[var(--cp-text-faint)]">新文案</span>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={!editableDraft}
                  aria-label="复制文案"
                  onClick={copyDraft}
                >
                  {copied ? <Check className="size-4 text-[var(--cp-success)]" /> : <Copy className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? "已复制" : "复制文案"}</TooltipContent>
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col px-5 py-8 md:px-10 md:py-10">
              {running && !editableDraft ? (
                <div className="flex min-h-[420px] flex-1 items-center justify-center">
                  <span className="cp-running-shimmer text-sm">正在组织文案结构</span>
                </div>
              ) : (
                <>
                  <input
                    value={editableDraft?.title ?? ""}
                    onChange={(event) =>
                      setEditableDraft((current) => (current ? { ...current, title: event.target.value } : current))
                    }
                    className="w-full border-0 bg-transparent text-[24px] font-semibold leading-tight text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)]"
                    placeholder="文案标题"
                    disabled={!editableDraft}
                  />
                  <textarea
                    value={editableDraft?.body ?? ""}
                    onChange={(event) =>
                      setEditableDraft((current) => (current ? { ...current, body: event.target.value } : current))
                    }
                    className="mt-6 min-h-[360px] w-full flex-1 resize-none border-0 bg-transparent text-[15px] leading-8 text-[var(--cp-text-soft)] outline-none placeholder:text-[var(--cp-text-faint)]"
                    placeholder="生成后的正文"
                    disabled={!editableDraft}
                  />
                  {editableDraft ? (
                    <div className="mt-6 border-t border-[var(--cp-border-subtle)] pt-5">
                      <label className="text-xs font-medium text-[var(--cp-text-muted)]" htmlFor="copywriting-cta">
                        行动引导
                      </label>
                      <input
                        id="copywriting-cta"
                        value={editableDraft.callToAction}
                        onChange={(event) =>
                          setEditableDraft((current) =>
                            current ? { ...current, callToAction: event.target.value } : current,
                          )
                        }
                        className="mt-2 w-full border-0 bg-transparent text-sm text-[var(--cp-text-soft)] outline-none placeholder:text-[var(--cp-text-faint)]"
                        placeholder="可选"
                      />
                    </div>
                  ) : null}
                </>
              )}

              {editableDraft?.complianceNotes.length ? (
                <div className="mt-6 flex items-start gap-2 border-t border-[var(--cp-border-subtle)] pt-5 text-xs leading-5 text-[var(--cp-warning)]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                  <div>
                    {editableDraft.complianceNotes.map((note) => (
                      <p key={note} className="m-0">{note}</p>
                    ))}
                  </div>
                </div>
              ) : null}
              {error ? (
                <div className="mt-6 rounded-[var(--cp-radius-item)] bg-[var(--cp-danger-bg)] px-4 py-3 text-xs text-[var(--cp-danger)]">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-[var(--cp-border-subtle)] px-4 py-3 md:px-8">
            <div className="mx-auto flex min-h-11 w-full max-w-[820px] items-end gap-2 rounded-[var(--cp-radius-composer)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2 shadow-[var(--cp-shadow-soft)]">
              <textarea
                value={adjustment}
                onChange={(event) => setAdjustment(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitAdjustment();
                  }
                }}
                rows={1}
                className="max-h-24 min-h-7 flex-1 resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:text-[var(--cp-text-faint)]"
                placeholder={editableDraft ? "调整语气、结构或卖点顺序" : "生成后可以继续调整"}
                disabled={!editableDraft || running}
              />
              {running ? (
                <Button
                  type="button"
                  size="icon"
                  className="size-8 shrink-0 rounded-full bg-[var(--cp-text)] text-white"
                  aria-label="停止生成"
                  onClick={onInterrupt}
                >
                  <Square className="size-3 fill-current" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="icon"
                  className="size-8 shrink-0 rounded-full bg-[var(--cp-text)] text-white"
                  disabled={!editableDraft || !adjustment.trim()}
                  aria-label="提交调整"
                  onClick={submitAdjustment}
                >
                  <SendHorizontal className="size-4" />
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function BriefSection({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1 text-xs font-medium text-[var(--cp-text-muted)]">
        <span>{label}</span>
        {required ? <span className="text-[var(--cp-danger)]">*</span> : null}
      </div>
      {children}
    </div>
  );
}

function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly (string | number)[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(fieldClassName, "appearance-none pr-9")}
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--cp-text-faint)]" />
    </div>
  );
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

const fieldClassName =
  "h-10 w-full rounded-[var(--cp-radius-item)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm text-[var(--cp-text)] outline-none placeholder:text-[var(--cp-text-faint)] focus:border-[var(--cp-text-muted)] focus:ring-2 focus:ring-[var(--cp-focus)]";
