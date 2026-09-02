"use client";

import { CheckCircle2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeProject, CreativeProjectChapter } from "@/lib/creative/creative-space-adapter";

export type ProjectAiRevision = { id: string; chapter: "产品确认" | "需求" | "选题"; instruction: string };
type CopilotMessage = { id: string; role: "user" | "assistant"; content: string };

const starterPrompts: Partial<Record<CreativeProjectChapter, string[]>> = {
  产品确认: ["补充这条产品事实需要确认什么", "重新整理得更适合短视频创作"],
  需求: ["把本轮目标说得更聚焦", "补充本次不能忽略的限制"],
  选题: ["多生成生活化的痛点选题", "更适合小红书，少讲原理"],
  表现形式: ["建议更适合的表现方式"],
  脚本: ["检查这版表达是否清楚"],
};

function scopeLabels(project: CreativeProject, chapter: CreativeProjectChapter) {
  const labels = ["项目任务", `当前：${chapter}`];
  if (project.productBrief) labels.push("产品创作简报");
  if (chapter === "选题") labels.push("需求理解");
  return labels;
}

export function ProjectAiCopilot({ project, chapter, running, error, onApply }: { project: CreativeProject; chapter: CreativeProjectChapter; running: boolean; error: string | null; onApply: (revision: ProjectAiRevision) => void }) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [proposal, setProposal] = useState<ProjectAiRevision | null>(null);
  const supported = chapter === "产品确认" || chapter === "需求" || chapter === "选题";
  const scopes = useMemo(() => scopeLabels(project, chapter), [project, chapter]);

  function propose(raw: string) {
    const instruction = raw.trim();
    if (!instruction || running) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: instruction }]);
    setValue("");
    if (!supported) {
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `我已基于「${chapter}」和项目资料记录这条调整建议。该环节暂不自动写回，建议先在正文中编辑并保存。` }]);
      return;
    }
    const next: ProjectAiRevision = { id: crypto.randomUUID(), chapter, instruction };
    setProposal(next);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `我会只使用当前项目已确认的上下文，按你的要求重新生成「${chapter}」的草案。应用前不会覆盖现有内容。` }]);
  }

  function apply() {
    if (!proposal || running) return;
    onApply(proposal);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", content: `正在生成新的「${proposal.chapter}」草案；完成后会写回当前环节。` }]);
    setProposal(null);
  }

  return <aside className="xl:sticky xl:top-5 xl:max-h-[calc(100dvh-2.5rem)]"><div className="overflow-hidden rounded-[14px] border border-[var(--cp-border)] bg-[var(--cp-surface)] shadow-[0_12px_28px_rgba(55,43,25,0.08)]"><div className="flex items-start justify-between border-b border-[var(--cp-border-subtle)] px-4 py-4"><div className="flex min-w-0 items-start gap-2.5"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[#edf4ed] text-[#315c49]"><Sparkles className="size-3.5" /></span><div><p className="m-0 text-sm font-semibold">项目协作 AI</p><p className="mb-0 mt-1 text-xs leading-5 text-[var(--cp-text-faint)]">基于当前项目与「{chapter}」协作</p></div></div><button type="button" className="rounded p-1 text-[var(--cp-text-faint)] hover:bg-[var(--cp-bg-subtle)]" aria-label={open ? "收起项目协作 AI" : "展开项目协作 AI"} onClick={() => setOpen((current) => !current)}>{open ? <X className="size-4" /> : <MessageCircle className="size-4" />}</button></div>{open ? <div className="flex max-h-[min(680px,calc(100dvh-8rem))] flex-col"><div className="border-b border-[var(--cp-border-subtle)] px-4 py-3"><p className="m-0 text-[11px] text-[var(--cp-text-faint)]">本次会读取</p><div className="mt-2 flex flex-wrap gap-1.5">{scopes.map((label) => <span key={label} className="rounded-full bg-[var(--cp-bg-subtle)] px-2 py-1 text-[11px] text-[var(--cp-text-muted)]">{label}</span>)}</div></div><div className="min-h-[190px] flex-1 space-y-3 overflow-y-auto px-4 py-4">{!messages.length ? <div className="rounded-[10px] bg-[#f7faf6] p-3"><p className="m-0 text-xs leading-5 text-[var(--cp-text-muted)]">直接说你想怎么调整。我会先生成变更草案，确认后才写回项目。</p></div> : null}{messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-6 rounded-[10px] bg-[#315c49] px-3 py-2 text-xs leading-5 text-white" : "mr-3 rounded-[10px] bg-[var(--cp-bg-subtle)] px-3 py-2 text-xs leading-5 text-[var(--cp-text-soft)]"}>{message.content}</div>)}{running ? <div className="mr-3 flex items-center gap-2 rounded-[10px] bg-[var(--cp-bg-subtle)] px-3 py-2 text-xs text-[var(--cp-text-muted)]"><Sparkles className="size-3 animate-pulse" />正在基于项目上下文生成…</div> : null}{error ? <p className="m-0 text-xs leading-5 text-[var(--cp-danger)]">生成失败：{error}</p> : null}</div>{proposal ? <div className="border-t border-[#c7d8ca] bg-[#f3f8f1] px-4 py-3"><div className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#315c49]" /><div><p className="m-0 text-xs font-semibold">准备更新「{proposal.chapter}」</p><p className="mb-0 mt-1 line-clamp-2 text-xs leading-5 text-[var(--cp-text-muted)]">{proposal.instruction}</p></div></div><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setProposal(null)}>取消</Button><Button type="button" size="sm" disabled={running} onClick={apply}>生成草案</Button></div></div> : null}<div className="border-t border-[var(--cp-border-subtle)] p-3"><div className="flex flex-wrap gap-1.5">{(starterPrompts[chapter] ?? ["帮我检查这一环节还缺什么"]).slice(0, 2).map((prompt) => <button key={prompt} type="button" disabled={running} onClick={() => propose(prompt)} className="rounded-full border border-[var(--cp-border)] px-2 py-1 text-[11px] text-[var(--cp-text-muted)] hover:border-[#315c49] hover:text-[#315c49] disabled:opacity-50">{prompt}</button>)}</div><div className="mt-3 flex items-end gap-2"><textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); propose(value); } }} className="min-h-10 flex-1 resize-none rounded-[9px] border border-[var(--cp-border)] bg-white px-3 py-2 text-xs leading-5 outline-none focus:border-[var(--cp-border-strong)] focus:ring-2 focus:ring-[var(--cp-focus)]" placeholder={`调整「${chapter}」的输出…`} /><Button type="button" size="icon" disabled={!value.trim() || running} onClick={() => propose(value)} aria-label="发送调整要求"><Send className="size-3.5" /></Button></div><p className="mb-0 mt-2 text-[10px] text-[var(--cp-text-faint)]">Ctrl / ⌘ + Enter 发送</p></div></div> : null}</div></aside>;
}
