"use client";

import { Check, ChevronDown, FileUp, Link2, LoaderCircle, Save, Search, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ConversationMessage, PendingAttachmentUpload } from "@/lib/agent/use-agent-thread";
import type { CreativeChapterContent, CreativeDocument, CreativeProductBrief, CreativeProductEvidence, CreativeProject } from "@/lib/creative/creative-space-adapter";

type EvidencePoint = CreativeProductEvidence;
type AudienceScene = CreativeProductBrief["audienceScenes"][number];
type ExpressionBoundary = CreativeProductBrief["expressionBoundaries"][number];
type ProductInsightResult = CreativeProductBrief;

export function ProductConfirmationWorkspace({ project, documents, saved, onSave, onSaveBrief, onRunAnalysis, analysisStatus, analysisError, analysisMessages }: {
  project: CreativeProject;
  documents: CreativeDocument[];
  saved: CreativeChapterContent;
  onSave: (input: { projectId: string; chapter: "产品确认"; body: string; documentIds: string[] }) => void;
  onSaveBrief: (input: { projectId: string; brief: CreativeProductBrief }) => void;
  onRunAnalysis: (prompt: string, attachments: PendingAttachmentUpload[]) => Promise<boolean>;
  analysisStatus: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed";
  analysisError: string | null;
  analysisMessages: ConversationMessage[];
}) {
  const [body, setBody] = useState(saved.body);
  const [documentIds, setDocumentIds] = useState(saved.documentIds);
  const [files, setFiles] = useState<PendingAttachmentUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const running = analysisStatus === "connecting" || analysisStatus === "running";
  const latestResult = useMemo(() => readLatestResult(analysisMessages), [analysisMessages]);
  const [awaitingResult, setAwaitingResult] = useState(false);
  const resultBaselineRef = useRef<string | null>(null);
  const result = latestResult?.brief ?? project.productBrief;
  const selectedDocuments = documents.filter((document) => documentIds.includes(document.id));

  useEffect(() => {
    if (!awaitingResult || !latestResult || latestResult.messageId === resultBaselineRef.current) return;
    onSaveBrief({ projectId: project.id, brief: latestResult.brief });
    setAwaitingResult(false);
  }, [awaitingResult, latestResult, onSaveBrief, project.id]);

  function saveSnapshot() { onSave({ projectId: project.id, chapter: "产品确认", body, documentIds }); }
  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next = Array.from(fileList).slice(0, Math.max(0, 8 - files.length)).map((file) => ({ id: crypto.randomUUID(), name: file.name, mimeType: file.type || "application/octet-stream", size: file.size, kind: "document" as const, url: URL.createObjectURL(file), file, local: true as const }));
    setFiles((current) => [...current, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  async function runAnalysis() {
    saveSnapshot();
    const sourceSummary = selectedDocuments.length ? selectedDocuments.map((document) => `- ${document.title}（${document.source}，${document.summary}）`).join("\n") : "未关联系统文档。";
    const prompt = `请基于以下资料生成「短视频创作产品简报」。\n\n项目：${project.name}\n关联产品：${project.products.map((product) => product.name).join("、") || "尚未关联，请标记缺失"}\n关联任务：${project.linkedTasks.map((task) => task.name).join("、") || "无"}\n\n已确认的产品事实快照：\n${body.trim() || "尚未填写，请标记缺失。"}\n\n已关联系统文档：\n${sourceSummary}\n\n上传附件是本次补充资料。只输出短视频创作直接可用的信息：一句核心表达、一个关键可拍证据、核心卖点、常规卖点、目标人群与场景、表达边界、缺失与冲突。每类最多 3 条。不要输出竞品分析、内容机会、选题方向、长篇产品介绍。严格区分事实、资料支持的推断、待确认项，禁止补充未提供的产品结论。`;
    resultBaselineRef.current = latestResult?.messageId ?? null;
    const submitted = await onRunAnalysis(prompt, files);
    if (submitted) { files.forEach((file) => URL.revokeObjectURL(file.url)); setFiles([]); setAwaitingResult(true); }
  }

  return <section className="w-full">
    <p className="m-0 text-xs text-[var(--cp-text-faint)]">产品事实快照 · 需求理解和后续 AI 只读取已确认资料</p>
    <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="m-0 text-[28px] font-semibold tracking-[-0.02em]">产品确认</h3><p className="mb-0 mt-4 max-w-[700px] text-base leading-relaxed text-[var(--cp-text-muted)]">先确认产品资料，再提炼短视频创作需要的用户价值、可拍证据与表达边界。</p></div><Button type="button" className="shrink-0" disabled={running} onClick={() => void runAnalysis()}>{running ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{running ? "正在整理" : "生成创作简报"}</Button></div>
    <div className="mt-9 grid gap-8 border-y border-[var(--cp-border-subtle)] py-7 lg:grid-cols-[minmax(0,1fr)_300px]"><div><div className="flex items-center justify-between gap-3"><h4 className="m-0 text-sm font-semibold">已确认的产品事实与当前版本</h4><button type="button" className="text-xs text-[var(--cp-text-muted)] hover:text-[var(--cp-text)]" onClick={saveSnapshot}><Save className="mr-1 inline size-3.5" />保存快照</button></div><textarea value={body} onChange={(event) => setBody(event.target.value)} className="mt-4 min-h-52 w-full resize-y rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 py-3 text-sm leading-7 text-[var(--cp-text-soft)] outline-none focus:border-[var(--cp-border-strong)] focus:ring-2 focus:ring-[var(--cp-focus)]" placeholder="手动输入产品版本、结构、规格、已验证卖点、资料来源，以及待确认或冲突的信息。" aria-label="产品事实快照" /><p className="mb-0 mt-2 text-xs leading-relaxed text-[var(--cp-text-faint)]">只填写已验证信息；不确定内容请直接标记为待确认。</p></div><div><div className="flex items-center gap-2"><Link2 className="size-4 text-[var(--cp-text-muted)]" /><h4 className="m-0 text-sm font-semibold">关联系统文档</h4></div><DocumentMultiSelect documents={documents} value={documentIds} onChange={setDocumentIds} /><input ref={fileInputRef} type="file" className="sr-only" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json" onChange={(event) => addFiles(event.target.files)} /><Button type="button" variant="outline" className="mt-5 w-full" onClick={() => fileInputRef.current?.click()}><FileUp className="size-4" />上传补充文档</Button><p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">可上传 PDF、Word、表格、文本；每次最多 8 份附件。</p>{files.length ? <ul className="mt-3 space-y-2 p-0">{files.map((file) => <li key={file.id} className="flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate">{file.name}</span><button type="button" aria-label={`移除${file.name}`} className="text-[var(--cp-text-faint)] hover:text-[var(--cp-text)]" onClick={() => { URL.revokeObjectURL(file.url); setFiles((current) => current.filter((item) => item.id !== file.id)); }}><X className="size-3.5" /></button></li>)}</ul> : null}</div></div>
    {analysisError ? <p className="mt-5 text-sm text-[var(--cp-danger)]">产品简报未完成：{analysisError}</p> : null}
    {result ? <BriefLayout result={result} /> : <div className="mt-9 border-l-2 border-[var(--cp-border)] pl-5"><p className="m-0 text-sm font-medium">尚未生成创作简报</p><p className="mb-0 mt-2 text-sm leading-relaxed text-[var(--cp-text-faint)]">补充事实与资料后生成；选题方向会在后续「选题」环节单独完成。</p></div>}
  </section>;
}

function DocumentMultiSelect({ documents, value, onChange }: { documents: CreativeDocument[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = documents.filter((document) => value.includes(document.id));
  const visible = documents.filter((document) => `${document.title} ${document.source} ${document.summary}`.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  function toggle(id: string) { onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]); }
  return <div ref={rootRef} className="relative mt-3"><button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex min-h-10 w-full items-center gap-2 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"><span className="min-w-0 flex-1 truncate text-[var(--cp-text-soft)]">{selected.length ? selected.map((document) => document.title).join("、") : "搜索并关联已有文档"}</span><ChevronDown className={`size-4 shrink-0 text-[var(--cp-text-faint)] transition-transform ${open ? "rotate-180" : ""}`} /></button>{open ? <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-2 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"><label className="flex h-9 items-center gap-2 border-b border-[var(--cp-border-subtle)] px-1"><Search className="size-3.5 text-[var(--cp-text-faint)]" /><span className="sr-only">搜索系统文档</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--cp-text-faint)]" placeholder="搜索文档名称或内容" /></label><div className="max-h-64 overflow-y-auto py-1">{visible.length ? visible.map((document) => { const checked = value.includes(document.id); return <button key={document.id} type="button" onClick={() => toggle(document.id)} className="flex w-full items-start gap-2 rounded-[var(--cp-radius-item)] px-2 py-2.5 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"><span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${checked ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white" : "border-[var(--cp-border-strong)]"}`}>{checked ? <Check className="size-3" /> : null}</span><span className="min-w-0"><span className="block text-sm font-medium">{document.title}</span><span className="mt-1 block text-xs leading-relaxed text-[var(--cp-text-faint)]">{document.source} · {document.summary}</span></span></button>; }) : <p className="m-0 px-2 py-4 text-center text-xs text-[var(--cp-text-faint)]">没有匹配的文档</p>}</div></div> : null}</div>;
}

function BriefLayout({ result }: { result: ProductInsightResult }) {
  return <div className="mt-10 space-y-9">
    <div className="border-l-4 border-[var(--cp-text)] bg-[var(--cp-bg-subtle)] px-6 py-5"><p className="m-0 text-[11px] font-semibold tracking-[0.12em] text-[var(--cp-text-faint)]">短视频创作产品简报</p><p className="mb-0 mt-2 text-[22px] font-semibold leading-relaxed tracking-[-0.02em] text-[var(--cp-text)]">{result.oneLineExpression}</p></div>
    <section><SectionTitle title="关键可拍证据" hint="先用一个真实画面解释核心价值" /><EvidenceTable items={[result.keyProof]} /></section>
    <div className="grid gap-8 xl:grid-cols-2"><section><SectionTitle title="核心卖点" hint="优先讲清楚的 1–3 件事" /><EvidenceTable items={result.coreSellingPoints} /></section><section><SectionTitle title="常规卖点" hint="辅助理解，不抢主表达" /><EvidenceTable items={result.routineSellingPoints} /></section></div>
    <div className="grid gap-8 xl:grid-cols-2"><section><SectionTitle title="目标人群与使用场景" hint="谁在什么时刻会在意" /><div className="mt-3 overflow-hidden rounded-[var(--cp-radius-control)] border border-[var(--cp-border)]"><div className="grid grid-cols-3 bg-[var(--cp-bg-subtle)] px-4 py-2.5 text-[11px] font-medium text-[var(--cp-text-faint)]"><span>目标人群</span><span>使用场景</span><span>情景痛点</span></div>{result.audienceScenes.length ? result.audienceScenes.map((item, index) => <div key={`${item.audience}-${index}`} className="grid grid-cols-3 border-t border-[var(--cp-border-subtle)] text-sm"><PlainCell value={item.audience} /><PlainCell value={item.scene} divided /><PlainCell value={item.painPoint} divided /></div>) : <EmptyCard />}</div></section><section><SectionTitle title="表达边界" hint="脚本前先避开没有依据的说法" /><div className="mt-3 overflow-hidden rounded-[var(--cp-radius-control)] border border-[var(--cp-border)]"><div className="grid grid-cols-[0.8fr_1fr_1.2fr] bg-[var(--cp-bg-subtle)] px-4 py-2.5 text-[11px] font-medium text-[var(--cp-text-faint)]"><span>注意事项</span><span>原因</span><span>建议表达</span></div>{result.expressionBoundaries.length ? result.expressionBoundaries.map((item, index) => <div key={`${item.item}-${index}`} className="grid grid-cols-[0.8fr_1fr_1.2fr] border-t border-[var(--cp-border-subtle)] text-sm"><PlainCell value={item.item} /><PlainCell value={item.reason} divided /><PlainCell value={item.recommendedExpression} divided /></div>) : <EmptyCard />}</div></section></div>
    {result.missingInformation.length || result.conflicts.length ? <div className="grid gap-5 border-t border-[var(--cp-border-subtle)] pt-5 md:grid-cols-2"><ShortList title="待补充确认" items={result.missingInformation} /><ShortList title="资料存在冲突" items={result.conflicts} /></div> : null}
  </div>;
}

function SectionTitle({ title, hint }: { title: string; hint: string }) { return <div className="flex items-baseline gap-3 border-b border-[var(--cp-border-subtle)] pb-3"><h4 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{title}</h4><p className="m-0 text-xs text-[var(--cp-text-faint)]">{hint}</p></div>; }
function EvidenceTable({ items }: { items: EvidencePoint[] }) { return <div className="mt-3 overflow-hidden rounded-[var(--cp-radius-control)] border border-[var(--cp-border)]"><div className="grid grid-cols-3 bg-[var(--cp-bg-subtle)] px-4 py-2.5 text-[11px] font-medium text-[var(--cp-text-faint)]"><span>产品事实</span><span>用户为什么在意</span><span>可拍画面</span></div>{items.length ? items.map((item, index) => <div key={`${item.fact}-${index}`} className="grid grid-cols-3 border-t border-[var(--cp-border-subtle)] text-sm"><PlainCell value={item.fact} /><PlainCell value={item.userValue} divided /><PlainCell value={item.visualProof} divided /></div>) : <EmptyCard />}</div>; }
function PlainCell({ value, divided = false }: { value: string; divided?: boolean }) { return <p className={`m-0 min-w-0 px-4 py-3 text-sm leading-6 text-[var(--cp-text-soft)] ${divided ? "border-l border-[var(--cp-border-subtle)]" : ""}`}>{value}</p>; }
function ShortList({ title, items }: { title: string; items: string[] }) { return <div><p className="m-0 text-xs font-semibold text-[var(--cp-text-muted)]">{title}</p>{items.length ? <ul className="mb-0 mt-2 space-y-1.5 pl-4 text-sm leading-relaxed text-[var(--cp-text-soft)]">{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="mb-0 mt-2 text-sm text-[var(--cp-text-faint)]">无</p>}</div>; }
function EmptyCard() { return <p className="m-0 rounded-[var(--cp-radius-control)] border border-dashed border-[var(--cp-border)] px-4 py-4 text-sm text-[var(--cp-text-faint)]">资料不足，生成后会在这里显示。</p>; }

function readLatestResult(messages: ConversationMessage[]): { messageId: string; brief: ProductInsightResult } | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || message.status !== "completed") continue;
    try { const parsed = JSON.parse(message.content) as Partial<ProductInsightResult>; if (typeof parsed.oneLineExpression !== "string" || !isEvidencePoint(parsed.keyProof)) continue; return { messageId: message.id, brief: { oneLineExpression: parsed.oneLineExpression, keyProof: parsed.keyProof, coreSellingPoints: readEvidencePoints(parsed.coreSellingPoints), routineSellingPoints: readEvidencePoints(parsed.routineSellingPoints), audienceScenes: readAudienceScenes(parsed.audienceScenes), expressionBoundaries: readExpressionBoundaries(parsed.expressionBoundaries), missingInformation: readStrings(parsed.missingInformation), conflicts: readStrings(parsed.conflicts) } }; } catch { /* Ignore messages not produced by this workflow. */ }
  }
  return null;
}
function readStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function isEvidencePoint(value: unknown): value is EvidencePoint { return Boolean(value && typeof value === "object" && "fact" in value && "userValue" in value && "visualProof" in value && typeof value.fact === "string" && typeof value.userValue === "string" && typeof value.visualProof === "string"); }
function readEvidencePoints(value: unknown): EvidencePoint[] { return Array.isArray(value) ? value.filter(isEvidencePoint) : []; }
function isAudienceScene(value: unknown): value is AudienceScene { return Boolean(value && typeof value === "object" && "audience" in value && "scene" in value && "painPoint" in value && typeof value.audience === "string" && typeof value.scene === "string" && typeof value.painPoint === "string"); }
function readAudienceScenes(value: unknown): AudienceScene[] { return Array.isArray(value) ? value.filter(isAudienceScene) : []; }
function isExpressionBoundary(value: unknown): value is ExpressionBoundary { return Boolean(value && typeof value === "object" && "item" in value && "reason" in value && "recommendedExpression" in value && typeof value.item === "string" && typeof value.reason === "string" && typeof value.recommendedExpression === "string"); }
function readExpressionBoundaries(value: unknown): ExpressionBoundary[] { return Array.isArray(value) ? value.filter(isExpressionBoundary) : []; }
