"use client";

import { CheckCircle2, ChevronDown, FileText, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ProjectAiRevision } from "@/components/creative/project-ai-copilot";
import type { CreativeProject } from "@/lib/creative/creative-space-adapter";
import type { RequirementAnalysis, RequirementQuestion, RequirementQuestionStatus, RequirementWorkspaceState } from "@/lib/creative/requirement-brief-adapter";
import type { ConversationMessage } from "@/lib/agent/use-agent-thread";
import { cn } from "@/lib/utils";

type RequirementBriefWorkspaceProps = {
  project: CreativeProject;
  state: RequirementWorkspaceState;
  onQuestion: (questionId: string, answer: string, status: Extract<RequirementQuestionStatus, "已补充" | "暂不确认" | "已忽略">) => void;
  onConfirm: () => void;
  onRunAnalysis: (prompt: string) => Promise<boolean>;
  onApplyAnalysis: (analysis: RequirementAnalysis, questions: Array<{ title: string; reason: string }>) => void;
  analysisStatus: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed";
  analysisError: string | null;
  analysisMessages: ConversationMessage[];
  revision?: ProjectAiRevision | null;
};

export function RequirementBriefWorkspace({ project, state, onQuestion, onConfirm, onRunAnalysis, onApplyAnalysis, analysisStatus, analysisError, analysisMessages, revision }: RequirementBriefWorkspaceProps) {
  const [expanded, setExpanded] = useState(false);
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const latestAnalysis = useMemo(() => readLatestAnalysis(analysisMessages), [analysisMessages]);
  const [awaitingAnalysis, setAwaitingAnalysis] = useState(false);
  const baselineRef = useRef<string | null>(null);
  const appliedRevisionRef = useRef<string | null>(null);
  const running = analysisStatus === "connecting" || analysisStatus === "running";

  useEffect(() => {
    if (!awaitingAnalysis || !latestAnalysis || latestAnalysis.messageId === baselineRef.current) return;
    onApplyAnalysis(latestAnalysis.analysis, latestAnalysis.questions);
    setAwaitingAnalysis(false);
  }, [awaitingAnalysis, latestAnalysis, onApplyAnalysis]);

  function submitAnswer(status: Extract<RequirementQuestionStatus, "已补充" | "暂不确认" | "已忽略">) { if (!questionId) return; onQuestion(questionId, answer, status); setQuestionId(null); setAnswer(""); }
  async function runUnderstanding(instruction = "") {
    if (!project.productBrief) return;
    const prompt = `请理解以下短视频需求。只使用需求方任务信息和已确认产品创作简报。\n\n需求方任务信息：\n- 任务：${project.linkedTasks.map((task) => task.name).join("、") || project.name}\n- 原始需求：${state.source.rawContent}\n- 平台：${state.source.platforms.join("、")}\n- 数量：${state.source.quantity ?? "未说明"}\n- 必须出现：${state.source.mustInclude.join("、") || "未说明"}\n\n已确认产品创作简报：\n${JSON.stringify(project.productBrief)}\n\n用户本次调整要求：${instruction || "无"}\n\n不要引用其他资料，不要生成选题或脚本。`;
    baselineRef.current = latestAnalysis?.messageId ?? null;
    if (await onRunAnalysis(prompt)) setAwaitingAnalysis(true);
  }

  useEffect(() => {
    if (!revision || revision.chapter !== "需求" || revision.id === appliedRevisionRef.current || running) return;
    appliedRevisionRef.current = revision.id;
    void runUnderstanding(revision.instruction);
  }, [revision, running]);

  return (
    <section className="mx-auto max-w-[1180px] pb-10">
      <header className="border-b border-[var(--cp-border-subtle)] pb-8">
        <p className="m-0 text-xs text-[var(--cp-text-faint)]">{project.platforms.join(" · ")} · {project.products.map((product) => product.name).join("、") || "未关联产品"} · 来源：{state.source.sourceType} · 负责人：{project.lead.name}</p>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="m-0 flex items-center gap-2 text-xs text-[var(--cp-text-muted)]"><span className={cn("size-1.5 rounded-full", state.status === "已确认" ? "bg-[var(--cp-success)]" : "bg-[#d86643]")} />{state.status}</p><h2 className="mb-0 mt-3 text-[30px] font-semibold leading-tight tracking-[-0.03em] text-[#315c49] md:text-[38px]">先把这次要做的事情想清楚</h2><p className="mb-0 mt-3 text-sm leading-relaxed text-[var(--cp-text-muted)]">结合需求方任务与已确认产品简报，整理真正影响创作的目标、重点和限制。</p></div><div className="flex items-center gap-3">{state.brief ? <span className="text-xs text-[var(--cp-text-faint)]">需求理解 V{state.brief.version} · {state.brief.confirmedAt} 确认</span> : null}<Button type="button" disabled={running || !project.productBrief} onClick={() => void runUnderstanding()}>{running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{running ? "正在理解" : "AI 理解需求"}</Button></div></div>
      </header>

      {!project.productBrief ? <p className="mb-0 mt-5 border-l-2 border-[var(--cp-border)] pl-4 text-sm text-[var(--cp-text-faint)]">请先在「产品确认」生成并确认产品创作简报，需求理解只使用任务信息与该简报。</p> : null}
      {analysisError ? <p className="mb-0 mt-5 text-sm text-[var(--cp-danger)]">需求理解未完成：{analysisError}</p> : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(280px,0.78fr)_minmax(0,1.4fr)]">
        <ReceivedRequirement project={project} state={state} expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        <AiUnderstanding state={state} />
      </div>

      <section className="mt-10 border-t border-[var(--cp-border-subtle)] pt-8" aria-labelledby="requirement-questions-title">
        <p className="m-0 text-xs text-[var(--cp-text-faint)]">AI 发现</p><h3 id="requirement-questions-title" className="mb-0 mt-2 text-xl font-semibold">还有这些需要确认</h3><p className="mb-0 mt-2 text-sm text-[var(--cp-text-muted)]">这些问题会影响后续产品理解与创作表达；可以补充答案、暂不确认或忽略。</p>
        <div className="mt-5 divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border-subtle)]">{state.questions.map((question) => <QuestionRow key={question.id} question={question} open={questionId === question.id} answer={answer} onOpen={() => { setQuestionId(question.id); setAnswer(question.answer ?? ""); }} onChange={setAnswer} onSubmit={submitAnswer} />)}</div>
      </section>

      <section className="mt-10 border-t border-[var(--cp-border-subtle)] pt-8" aria-labelledby="requirement-brief-title">
        {state.brief && state.status === "已确认" ? <ConfirmedBrief brief={state.brief} historyCount={state.briefHistory.length} /> : <div className="flex flex-col gap-5 bg-[#f4efe4] px-5 py-6 sm:flex-row sm:items-center sm:justify-between"><div><p className="m-0 text-xs text-[#315c49]">正式项目上下文</p><h3 id="requirement-brief-title" className="mb-0 mt-2 text-xl font-semibold text-[#222a25]">{state.brief ? "确认更新后的需求理解" : "确认这版需求理解"}</h3><p className="mb-0 mt-2 max-w-[620px] text-sm leading-relaxed text-[var(--cp-text-muted)]">确认后会生成 Requirement Brief，后续阶段默认读取该版本；以后仍可修改并形成新版本。</p></div><Button type="button" className="shrink-0 bg-[#315c49] hover:bg-[#2f5746]" onClick={onConfirm}><CheckCircle2 className="size-4" />{state.brief ? "确认更新版本" : "确认这版需求理解"}</Button></div>}
      </section>
    </section>
  );
}

function ReceivedRequirement({ project, state, expanded, onToggle }: { project: CreativeProject; state: RequirementWorkspaceState; expanded: boolean; onToggle: () => void }) {
  const source = state.source;
  return <section className="bg-[#fffcf6] px-5 py-6 shadow-[0_8px_24px_rgba(88,70,45,0.07)]"><p className="m-0 text-xs text-[#9c7651]">事实快照 · {source.sourceType}</p><h3 className="mb-0 mt-2 text-xl font-semibold">收到的需求</h3><p className="mb-0 mt-1 text-xs text-[var(--cp-text-faint)]">{source.sourceVersion}</p><dl className="mt-6 space-y-5"><Fact label="关联任务" value={project.linkedTasks.map((task) => task.name).join("、") || "由创作空间直接创建"} /><Fact label="产品" value={source.product} /><Fact label="目标平台" value={source.platforms.join("、")} /><Fact label="内容数量" value={source.quantity} /><Fact label="必须出现" value={source.mustInclude.join("、")} /></dl><div className="mt-6 border-t border-[#eadfce] pt-5"><p className="m-0 text-xs font-medium text-[var(--cp-text-muted)]">原始需求</p><p className={cn("mb-0 mt-2 whitespace-pre-wrap text-sm leading-7 text-[var(--cp-text-soft)]", !expanded && "line-clamp-3")}>{source.rawContent}</p><button type="button" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#315c49] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={onToggle}>{expanded ? "收起原文" : "展开完整原文"}<ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} /></button></div>{source.attachments.length ? <div className="mt-5 border-t border-[#eadfce] pt-5"><p className="m-0 text-xs font-medium text-[var(--cp-text-muted)]">任务附件 / 参考资料</p>{source.attachments.map((item) => <p key={item} className="mb-0 mt-2 flex items-center gap-2 text-xs text-[#315c49]"><FileText className="size-3.5" />{item}</p>)}</div> : null}</section>;
}

function Fact({ label, value }: { label: string; value: string | null }) { return value ? <div><dt className="text-[11px] text-[var(--cp-text-faint)]">{label}</dt><dd className="mb-0 mt-1 text-sm text-[var(--cp-text-soft)]">{value}</dd></div> : null; }

function AiUnderstanding({ state }: { state: RequirementWorkspaceState }) { const analysis = state.analysis; return <section className="border-l border-[#d8c08b] pl-6 sm:pl-8"><p className="m-0 flex items-center gap-2 text-xs text-[#315c49]"><Sparkles className="size-3.5" />AI 整理草稿 · 推理层</p><h3 className="mb-0 mt-2 text-[24px] font-semibold">AI 帮我理解</h3><div className="mt-6 space-y-7"><Insight title="这次为什么做"><p>{analysis.purpose}</p></Insight><Insight title="这次最想让用户记住什么"><ul>{analysis.keyMessage.map((item) => <li key={item}>{item}</li>)}</ul></Insight><Insight title="主要面对谁" note={analysis.audience.inferred ? "AI 推测，待确认" : undefined}><p>{analysis.audience.text}</p></Insight><Insight title="用户可能在意什么"><ul>{analysis.userQuestions.map((item) => <li key={item}>{item}</li>)}</ul></Insight><Insight title="这次必须讲清楚什么">{analysis.mustInclude.map((item) => <p key={item.text} className="mb-2 flex gap-2"><span className="text-[#d86643]">•</span><span>{item.text}<em className="ml-2 not-italic text-[11px] text-[var(--cp-text-faint)]">{item.source}</em></span></p>)}</Insight><Insight title="有哪些限制">{analysis.constraints.map((item) => <p key={item.text} className="mb-2 flex gap-2"><span className="text-[#9c7651]">—</span><span>{item.text}<em className="ml-2 not-italic text-[11px] text-[var(--cp-text-faint)]">{item.source}</em></span></p>)}</Insight></div></section>; }

function Insight({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) { return <div><h4 className="m-0 text-sm font-semibold">{title}{note ? <span className="ml-2 text-[11px] font-normal text-[#9c7651]">{note}</span> : null}</h4><div className="mt-2 text-sm leading-7 text-[var(--cp-text-muted)] [&_p]:m-0 [&_ul]:m-0 [&_ul]:space-y-1 [&_ul]:pl-4">{children}</div></div>; }

function QuestionRow({ question, open, answer, onOpen, onChange, onSubmit }: { question: RequirementQuestion; open: boolean; answer: string; onOpen: () => void; onChange: (value: string) => void; onSubmit: (status: Extract<RequirementQuestionStatus, "已补充" | "暂不确认" | "已忽略">) => void }) { const resolved = question.status !== "待确认"; return <div className="py-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="m-0 text-sm font-semibold">{question.title}</p><p className="mb-0 mt-2 max-w-[760px] text-sm leading-6 text-[var(--cp-text-muted)]">{question.reason}</p>{question.answer ? <p className="mb-0 mt-2 text-xs text-[#315c49]">已记录：{question.answer}</p> : null}</div><button type="button" className="w-fit text-xs font-medium text-[#315c49] disabled:text-[var(--cp-text-faint)]" disabled={resolved} onClick={onOpen}>{resolved ? question.status : "处理此项"}</button></div>{open ? <div className="mt-4 bg-[var(--cp-bg-subtle)] p-4"><textarea value={answer} onChange={(event) => onChange(event.target.value)} className="min-h-20 w-full resize-y border-0 bg-transparent text-sm leading-6 outline-none placeholder:text-[var(--cp-text-faint)]" placeholder="补充你已经确认的信息（可选）" /><div className="mt-3 flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => onSubmit("已忽略")}>忽略本项</Button><Button type="button" variant="outline" size="sm" onClick={() => onSubmit("暂不确认")}>暂不确认</Button><Button type="button" size="sm" onClick={() => onSubmit("已补充")}>保存补充</Button></div></div> : null}</div>; }

function ConfirmedBrief({ brief, historyCount }: { brief: NonNullable<RequirementWorkspaceState["brief"]>; historyCount: number }) { return <div className="border border-[#d8c08b] bg-[#fffcf6] px-5 py-6"><p className="m-0 flex items-center gap-2 text-xs text-[#315c49]"><CheckCircle2 className="size-3.5" />已确认创作简报 · 需求理解 V{brief.version}</p><h3 className="mb-0 mt-2 text-xl font-semibold">后续创作将默认读取这一版</h3><div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2"><BriefLine title="内容目标" value={brief.analysis.purpose} /><BriefLine title="核心认知" value={brief.analysis.keyMessage.join("；")} /><BriefLine title="目标用户" value={brief.analysis.audience.text} /><BriefLine title="核心问题" value={brief.analysis.userQuestions.join("；")} /><BriefLine title="必讲内容" value={brief.analysis.mustInclude.map((item) => item.text).join("；")} /><BriefLine title="限制与风险" value={brief.analysis.constraints.map((item) => item.text).join("；")} /></div><p className="mb-0 mt-6 text-xs text-[var(--cp-text-faint)]">{brief.confirmedBy} 于 {brief.confirmedAt} 确认 · 基于 {brief.sourceVersion} · 已保留 {historyCount} 个版本</p></div>; }

function BriefLine({ title, value }: { title: string; value: string }) { return <div><p className="m-0 text-xs text-[var(--cp-text-faint)]">{title}</p><p className="mb-0 mt-2 text-sm leading-6 text-[var(--cp-text-soft)]">{value}</p></div>; }

function readLatestAnalysis(messages: ConversationMessage[]): { messageId: string; analysis: RequirementAnalysis; questions: Array<{ title: string; reason: string }> } | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || message.status !== "completed") continue;
    try {
      const value = JSON.parse(message.content) as Record<string, unknown>;
      if (typeof value.purpose !== "string" || !Array.isArray(value.keyMessage) || !isRecord(value.audience)) continue;
      const sourceItems = (input: unknown): RequirementAnalysis["mustInclude"] => Array.isArray(input) ? input.filter((item): item is { text: string; source: "原始需求" | "产品简报" | "AI推断" } => isRecord(item) && typeof item.text === "string" && (item.source === "原始需求" || item.source === "产品简报" || item.source === "AI推断")) : [];
      const questions = Array.isArray(value.clarifyingQuestions) ? value.clarifyingQuestions.filter((item): item is { title: string; reason: string } => isRecord(item) && typeof item.title === "string" && typeof item.reason === "string") : [];
      return { messageId: message.id, analysis: { purpose: value.purpose, keyMessage: readStrings(value.keyMessage), audience: { text: typeof value.audience.text === "string" ? value.audience.text : "目标人群信息不足，需确认。", inferred: value.audience.inferred !== false }, userQuestions: readStrings(value.userQuestions), mustInclude: sourceItems(value.mustInclude), constraints: sourceItems(value.constraints) }, questions };
    } catch { /* Ignore messages produced by other workflows. */ }
  }
  return null;
}

function readStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
