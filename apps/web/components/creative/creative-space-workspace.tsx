"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  ChevronDown,
  Clapperboard,
  FileText,
  ImageIcon,
  Link2,
  ListFilter,
  Pencil,
  Plus,
  Save,
  Search,
  Sparkles,
  Users,
  X,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { MyCreativeDashboardPage } from "@/components/creative/my-creative-dashboard";
import { ProductConfirmationWorkspace, readLatestProductBrief } from "@/components/creative/product-confirmation-workspace";
import { RequirementBriefWorkspace } from "@/components/creative/requirement-brief-workspace";
import { TopicPlanningWorkspace } from "@/components/creative/topic-planning-workspace";
import type { ConversationMessage, PendingAttachmentUpload } from "@/lib/agent/use-agent-thread";
import {
  creativeProjectChapters,
  creativeSpaceAdapter,
  type CreateCreativeProjectInput,
  type CreativeDocument,
  type CreativeProject,
  type CreativeProjectChapter,
  type CreativeSpaceSnapshot,
} from "@/lib/creative/creative-space-adapter";
import { requirementBriefAdapter } from "@/lib/creative/requirement-brief-adapter";
import { cn } from "@/lib/utils";

type CreativeSection = "my-work" | "projects" | "inspiration" | "toolbox";
type CreativeRoute =
  | { kind: "section"; section: CreativeSection }
  | { kind: "create-project"; preselectedTaskId?: string }
  | {
      kind: "project";
      projectId: string;
      chapter?: CreativeProjectChapter;
      returnSection: "my-work" | "projects";
    };

const sectionItems: Array<{ id: CreativeSection; label: string }> = [
  { id: "my-work", label: "我的创作" },
  { id: "projects", label: "内容项目" },
  { id: "inspiration", label: "灵感与案例" },
  { id: "toolbox", label: "AI 工具箱" },
];

export function CreativeSpaceWorkspace({ onOpenCopywriting, onRunProductInsight, productInsight, onRunRequirementUnderstanding, requirementUnderstanding, onRunTopicPlanning, topicPlanning }: {
  onOpenCopywriting: () => void;
  onRunProductInsight: (projectId: string, prompt: string, attachments: PendingAttachmentUpload[]) => Promise<boolean>;
  productInsight: { status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed"; error: string | null; messages: ConversationMessage[]; projectId: string | null };
  onRunRequirementUnderstanding: (prompt: string) => Promise<boolean>;
  requirementUnderstanding: { status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed"; error: string | null; messages: ConversationMessage[] };
  onRunTopicPlanning: (prompt: string) => Promise<boolean>;
  topicPlanning: { status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed"; error: string | null; messages: ConversationMessage[] };
}) {
  const [snapshot, setSnapshot] = useState<CreativeSpaceSnapshot>(() => creativeSpaceAdapter.getSnapshot());
  const [route, setRoute] = useState<CreativeRoute>({ kind: "section", section: "my-work" });
  const appliedProductBriefRef = useRef<string | null>(null);

  useEffect(() => {
    setSnapshot(creativeSpaceAdapter.hydrate());
  }, []);

  useEffect(() => {
    if (!productInsight.projectId) return;
    const generated = readLatestProductBrief(productInsight.messages);
    const applicationId = generated ? `${productInsight.projectId}:${generated.messageId}` : null;
    if (!generated || productInsight.status !== "completed" || applicationId === appliedProductBriefRef.current) return;
    try {
      creativeSpaceAdapter.updateProductBrief({ projectId: productInsight.projectId, brief: generated.brief });
      appliedProductBriefRef.current = applicationId;
      setSnapshot(creativeSpaceAdapter.getSnapshot());
    } catch { /* The project may have been deleted while the model was running. */ }
  }, [productInsight.messages, productInsight.projectId, productInsight.status]);

  const activeSection: CreativeSection =
    route.kind === "section" ? route.section : route.kind === "project" || route.kind === "create-project" ? "projects" : "my-work";

  function openSection(section: CreativeSection) {
    setRoute({ kind: "section", section });
  }

  function createProject(input: CreateCreativeProjectInput) {
    const project = creativeSpaceAdapter.createProject(input);
    setSnapshot(creativeSpaceAdapter.getSnapshot());
    setRoute({ kind: "project", projectId: project.id, returnSection: "projects" });
  }

  function createProjectFromTask(projectId: string) {
    const sourceProject = snapshot.projects.find((project) => project.id === projectId);
    const task = sourceProject?.linkedTasks[0];
    if (!task) {
      setRoute({ kind: "create-project" });
      return;
    }
    const project = creativeSpaceAdapter.createProject({
      name: task.name,
      linkedTaskIds: [task.id],
      productIds: [],
      platforms: sourceProject?.platforms.length ? sourceProject.platforms : ["抖音"],
      contentGoal: `完成「${task.name}」对应的视频内容。`,
      leadId: sourceProject?.lead.id ?? snapshot.people[0]?.id ?? "",
      memberIds: [],
    });
    setSnapshot(creativeSpaceAdapter.getSnapshot());
    setRoute({ kind: "project", projectId: project.id, returnSection: "my-work" });
  }

  function updateChapter(input: { projectId: string; chapter: Exclude<CreativeProjectChapter, "概览">; body: string; documentIds: string[] }) {
    creativeSpaceAdapter.updateChapter(input);
    setSnapshot(creativeSpaceAdapter.getSnapshot());
  }

  function updateProductBrief(input: { projectId: string; brief: import("@/lib/creative/creative-space-adapter").CreativeProductBrief }) {
    creativeSpaceAdapter.updateProductBrief(input);
    setSnapshot(creativeSpaceAdapter.getSnapshot());
  }

  function updateTopicPlan(input: { projectId: string; plan: import("@/lib/creative/creative-space-adapter").CreativeTopicPlan }) {
    creativeSpaceAdapter.updateTopicPlan(input);
    setSnapshot(creativeSpaceAdapter.getSnapshot());
  }

  const selectedProject =
    route.kind === "project" ? snapshot.projects.find((project) => project.id === route.projectId) ?? null : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--cp-bg)] pt-14 md:pt-0">
      <header className="shrink-0 border-b border-[var(--cp-border-subtle)] bg-[rgba(255,255,255,0.94)]">
        <div className="flex h-[var(--cp-topbar-height)] items-center px-5 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] bg-[#f2f1ed] text-[#655e4f]">
              <Clapperboard className="size-[18px]" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-base font-semibold">创作空间</h1>
              <p className="m-0 truncate text-xs text-[var(--cp-text-faint)]">让内容在同一个上下文里持续生长</p>
            </div>
          </div>
        </div>
        <nav className="cp-hidden-scrollbar flex min-w-0 gap-6 overflow-x-auto px-5 md:px-8" aria-label="创作空间导航">
          {sectionItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "relative h-10 shrink-0 text-sm text-[var(--cp-text-muted)] transition-colors hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                activeSection === item.id && "font-medium text-[var(--cp-text)]",
              )}
              aria-current={activeSection === item.id ? "page" : undefined}
              onClick={() => openSection(item.id)}
            >
              {item.label}
              {activeSection === item.id ? (
                <span className="absolute inset-x-0 bottom-0 h-px bg-[var(--cp-text)]" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {route.kind === "section" && route.section === "my-work" ? (
          <MyCreativeDashboardPage
            projects={snapshot.projects}
            onOpenProject={(projectId, chapter) => setRoute({ kind: "project", projectId, chapter, returnSection: "my-work" })}
            onCreateProjectForTask={createProjectFromTask}
          />
        ) : null}
        {route.kind === "section" && route.section === "projects" ? (
          <ContentProjectList
            projects={snapshot.projects}
            onCreate={() => setRoute({ kind: "create-project" })}
            onOpenProject={(projectId) => setRoute({ kind: "project", projectId, returnSection: "projects" })}
          />
        ) : null}
        {route.kind === "create-project" ? (
          <ProjectCreateForm snapshot={snapshot} initialTaskId={route.preselectedTaskId} onCancel={() => openSection("projects")} onCreate={createProject} />
        ) : null}
        {route.kind === "project" && selectedProject ? (
          <ContentProjectWorkspace
            project={selectedProject}
            documents={snapshot.documents}
            initialChapter={route.chapter}
            backLabel={route.returnSection === "my-work" ? "我的创作" : "内容项目"}
            onBack={() => openSection(route.returnSection)}
            onSaveChapter={updateChapter}
            onSaveProductBrief={updateProductBrief}
            onSaveTopicPlan={updateTopicPlan}
            onRunProductInsight={onRunProductInsight}
            productInsight={productInsight}
            onRunRequirementUnderstanding={onRunRequirementUnderstanding}
            requirementUnderstanding={requirementUnderstanding}
            onRunTopicPlanning={onRunTopicPlanning}
            topicPlanning={topicPlanning}
          />
        ) : null}
        {route.kind === "section" && route.section === "inspiration" ? (
          <InspirationWorkspace snapshot={snapshot} />
        ) : null}
        {route.kind === "section" && route.section === "toolbox" ? (
          <AiToolbox onOpenCopywriting={onOpenCopywriting} />
        ) : null}
      </div>
    </div>
  );
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 border-b border-[var(--cp-border-subtle)] pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-[650px]">
        {eyebrow ? <p className="mb-2 mt-0 text-xs text-[var(--cp-text-faint)]">{eyebrow}</p> : null}
        <h2 className="m-0 text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">{title}</h2>
        <p className="mb-0 mt-3 text-sm leading-relaxed text-[var(--cp-text-muted)]">{description}</p>
      </div>
      {action}
    </div>
  );
}

function ContentProjectList({ projects, onCreate, onOpenProject }: { projects: CreativeProject[]; onCreate: () => void; onOpenProject: (projectId: string) => void }) {
  const [query, setQuery] = useState("");
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) =>
      [project.name, project.coreDirection, ...project.products.map((product) => product.name), ...project.platforms].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [projects, query]);

  return (
    <section className="w-full px-5 py-10 md:px-8 md:py-12 xl:px-10">
      <PageIntro
        title="内容项目"
        description="每个项目围绕一个核心选题持续创作，脚本、剪辑和平台版本都保留在同一上下文中。"
        action={<Button type="button" onClick={onCreate}><Plus className="size-4" />创建内容项目</Button>}
      />

      <div className="flex items-center gap-3 border-b border-[var(--cp-border-subtle)] py-6">
        <Search className="size-4 shrink-0 text-[var(--cp-text-faint)]" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索项目、产品或内容方向"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--cp-text-faint)]"
          aria-label="搜索内容项目"
        />
        <ListFilter className="size-4 text-[var(--cp-text-faint)]" aria-hidden="true" />
      </div>

      <div>
        {visibleProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            className="group grid w-full gap-3 border-b border-[var(--cp-border-subtle)] py-7 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)] md:grid-cols-[minmax(0,1fr)_220px] md:gap-10"
            onClick={() => onOpenProject(project.id)}
          >
            <span className="min-w-0">
              <span className="block text-lg font-semibold leading-snug group-hover:underline">{project.name}</span>
              <span className="mt-2 block max-w-[680px] text-sm leading-relaxed text-[var(--cp-text-muted)]">{project.coreDirection}</span>
            </span>
            <span className="flex items-end justify-between gap-4 md:flex-col md:items-start md:justify-center">
              <span className="text-xs text-[var(--cp-text-faint)]">当前在「{project.currentChapter}」</span>
              <span className="text-xs text-[var(--cp-text-muted)]">{project.products.map((product) => product.name).join("、") || "暂未关联产品"} · {project.platforms.join(" / ")}</span>
            </span>
          </button>
        ))}
        {!visibleProjects.length ? (
          <div className="py-16 text-center">
            <p className="m-0 text-sm font-medium">没有找到对应项目</p>
            <p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">换一个关键词，或创建新的内容方向。</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

const fieldClassName = "mt-2 h-10 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 text-sm outline-none focus:border-[var(--cp-border-strong)] focus:ring-2 focus:ring-[var(--cp-focus)]";

type SearchableSelectOption = { id: string; label: string; detail?: string };

function SearchableSelect({ options, value, onChange, placeholder, multiple = true, emptyLabel = "没有匹配的选项" }: { options: SearchableSelectOption[]; value: string[]; onChange: (value: string[]) => void; placeholder: string; multiple?: boolean; emptyLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = options.filter((option) => value.includes(option.id));
  function toggle(id: string) { onChange(multiple ? value.includes(id) ? value.filter((item) => item !== id) : [...value, id] : [id]); if (!multiple) setOpen(false); }
  useEffect(() => { if (!open) return; const closeOnOutsidePointer = (event: PointerEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", closeOnOutsidePointer); return () => document.removeEventListener("pointerdown", closeOnOutsidePointer); }, [open]);
  return <div ref={rootRef} className="relative mt-2"><button type="button" className="flex min-h-10 w-full items-center gap-2 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span className="flex min-w-0 flex-1 flex-wrap gap-1.5">{selected.length ? selected.map((option) => <span key={option.id} className="inline-flex max-w-full items-center gap-1 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] px-2 py-1 text-xs text-[var(--cp-text-soft)]">{option.label}<span role="button" tabIndex={0} aria-label={`移除${option.label}`} className="shrink-0 text-[var(--cp-text-faint)] hover:text-[var(--cp-text)]" onClick={(event) => { event.stopPropagation(); onChange(value.filter((item) => item !== option.id)); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChange(value.filter((item) => item !== option.id)); } }}><X className="size-3" /></span></span>) : <span className="py-0.5 text-[var(--cp-text-faint)]">{placeholder}</span>}</span><ChevronDown className={cn("size-4 shrink-0 text-[var(--cp-text-faint)] transition-transform", open && "rotate-180")} /></button>{open ? <div className="absolute z-20 mt-1 w-full rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] p-2 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"><label className="flex h-9 items-center gap-2 border-b border-[var(--cp-border-subtle)] px-1"><Search className="size-3.5 text-[var(--cp-text-faint)]" /><span className="sr-only">搜索选项</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--cp-text-faint)]" placeholder="搜索" /></label><div className="max-h-52 overflow-y-auto py-1">{visible.map((option) => <button key={option.id} type="button" className="flex w-full items-start gap-2 rounded-[var(--cp-radius-item)] px-2 py-2 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={() => toggle(option.id)}><span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border", value.includes(option.id) ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white" : "border-[var(--cp-border-strong)]")}>{value.includes(option.id) ? <Check className="size-3" /> : null}</span><span><span className="block text-sm">{option.label}</span>{option.detail ? <span className="mt-0.5 block text-xs text-[var(--cp-text-faint)]">{option.detail}</span> : null}</span></button>)}{!visible.length ? <p className="m-0 px-2 py-4 text-center text-xs text-[var(--cp-text-faint)]">{emptyLabel}</p> : null}</div></div> : null}</div>;
}

function ProjectCreateForm({ snapshot, initialTaskId, onCancel, onCreate }: { snapshot: CreativeSpaceSnapshot; initialTaskId?: string; onCancel: () => void; onCreate: (input: CreateCreativeProjectInput) => void }) {
  const [name, setName] = useState("");
  const [linkedTaskIds, setLinkedTaskIds] = useState<string[]>(initialTaskId ? [initialTaskId] : []);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [platforms, setPlatforms] = useState<string[]>(["抖音"]);
  const [contentGoal, setContentGoal] = useState("");
  const [leadId, setLeadId] = useState(snapshot.people[0]?.id ?? "");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !contentGoal.trim() || !leadId || !platforms.length) {
      setError("请填写项目名称、内容目标、平台和项目负责人。");
      return;
    }
    onCreate({
      name,
      linkedTaskIds,
      productIds,
      platforms,
      contentGoal,
      leadId,
      memberIds,
    });
  }

  return (
    <section className="w-full px-5 py-10 md:px-8 md:py-12 xl:px-10">
      <button type="button" className="mb-8 inline-flex items-center gap-2 text-sm text-[var(--cp-text-muted)] hover:text-[var(--cp-text)]" onClick={onCancel}>
        <ArrowLeft className="size-4" />返回内容项目
      </button>
      <PageIntro eyebrow="新的核心内容方向" title="创建内容项目" description="先建立必要上下文，其余内容可以进入项目后逐步补充。" />

      <form className="py-8" onSubmit={submit}>
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          <label className="text-sm font-medium md:col-span-2">
            项目名称
            <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClassName} placeholder="产品｜核心选题或内容方向" />
          </label>
          <label className="text-sm font-medium">
            关联短视频任务 <span className="font-normal text-[var(--cp-text-faint)]">可多选；单条任务项目只选一条即可</span>
            <SearchableSelect options={snapshot.tasks.map((task) => ({ id: task.id, label: task.name }))} value={linkedTaskIds} onChange={setLinkedTaskIds} placeholder="搜索并关联短视频任务" />
          </label>
          <label className="text-sm font-medium">
            关联产品 <span className="font-normal text-[var(--cp-text-faint)]">可多选</span>
            <SearchableSelect options={snapshot.products.map((product) => ({ id: product.id, label: product.name }))} value={productIds} onChange={setProductIds} placeholder="搜索并关联产品" />
          </label>
          <fieldset className="md:col-span-2">
            <legend className="text-sm font-medium">平台</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {["抖音", "小红书", "视频号", "快手", "其他"].map((platform) => {
                const selected = platforms.includes(platform);
                return (
                  <button
                    key={platform}
                    type="button"
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-[var(--cp-radius-segment)] border px-3 text-sm",
                      selected ? "border-[var(--cp-text)] bg-[var(--cp-text)] text-white" : "border-[var(--cp-border)] text-[var(--cp-text-muted)] hover:border-[var(--cp-border-strong)]",
                    )}
                    aria-pressed={selected}
                    onClick={() => setPlatforms((current) => selected ? current.filter((item) => item !== platform) : [...current, platform])}
                  >
                    {selected ? <Check className="size-3.5" /> : null}{platform}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="text-sm font-medium md:col-span-2">
            内容目标
            <textarea value={contentGoal} onChange={(event) => setContentGoal(event.target.value)} className="mt-2 min-h-24 w-full resize-y rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-3 py-2.5 text-sm leading-relaxed outline-none focus:border-[var(--cp-border-strong)] focus:ring-2 focus:ring-[var(--cp-focus)]" placeholder="这条内容希望让谁理解什么、产生什么行动？" />
          </label>
          <label className="text-sm font-medium">
            项目负责人
            <SearchableSelect multiple={false} options={snapshot.people.map((person) => ({ id: person.id, label: person.name, detail: person.role }))} value={leadId ? [leadId] : []} onChange={(value) => { const nextLeadId = value[0] ?? ""; setLeadId(nextLeadId); setMemberIds((current) => current.filter((id) => id !== nextLeadId)); }} placeholder="搜索并选择项目负责人" />
          </label>
          <label className="text-sm font-medium">
            参与成员
            <SearchableSelect options={snapshot.people.filter((person) => person.id !== leadId).map((person) => ({ id: person.id, label: person.name, detail: person.role }))} value={memberIds} onChange={setMemberIds} placeholder="搜索并添加参与成员" />
          </label>
        </div>

        {error ? <p className="mb-0 mt-5 text-sm text-[var(--cp-danger)]">{error}</p> : null}
        <div className="mt-8 flex items-center justify-end gap-3 border-t border-[var(--cp-border-subtle)] pt-6">
          <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
          <Button type="submit">创建并进入项目</Button>
        </div>
      </form>
    </section>
  );
}

function ContentProjectWorkspace({ project, documents, initialChapter = "概览", backLabel, onBack, onSaveChapter, onSaveProductBrief, onSaveTopicPlan, onRunProductInsight, productInsight, onRunRequirementUnderstanding, requirementUnderstanding, onRunTopicPlanning, topicPlanning }: { project: CreativeProject; documents: CreativeDocument[]; initialChapter?: CreativeProjectChapter; backLabel: string; onBack: () => void; onSaveChapter: (input: { projectId: string; chapter: Exclude<CreativeProjectChapter, "概览">; body: string; documentIds: string[] }) => void; onSaveProductBrief: (input: { projectId: string; brief: import("@/lib/creative/creative-space-adapter").CreativeProductBrief }) => void; onSaveTopicPlan: (input: { projectId: string; plan: import("@/lib/creative/creative-space-adapter").CreativeTopicPlan }) => void; onRunProductInsight: (projectId: string, prompt: string, attachments: PendingAttachmentUpload[]) => Promise<boolean>; productInsight: { status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed"; error: string | null; messages: ConversationMessage[]; projectId: string | null }; onRunRequirementUnderstanding: (prompt: string) => Promise<boolean>; requirementUnderstanding: { status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed"; error: string | null; messages: ConversationMessage[] }; onRunTopicPlanning: (prompt: string) => Promise<boolean>; topicPlanning: { status: "idle" | "connecting" | "running" | "completed" | "interrupted" | "failed"; error: string | null; messages: ConversationMessage[] } }) {
  const [chapter, setChapter] = useState<CreativeProjectChapter>(initialChapter);
  const [, setRequirementRevision] = useState(0);
  const requirement = requirementBriefAdapter.get(project);
  const refreshRequirement = () => setRequirementRevision((value) => value + 1);
  return (
    <article className="min-h-full">
      <div className="w-full px-5 pt-8 md:px-8 md:pt-10 xl:px-10">
        <button type="button" className="inline-flex items-center gap-2 text-sm text-[var(--cp-text-muted)] hover:text-[var(--cp-text)]" onClick={onBack}>
          <ArrowLeft className="size-4" />{backLabel}
        </button>
        <div className="grid gap-5 pb-8 pt-6 md:grid-cols-[minmax(0,1fr)_240px] md:items-end">
          <div>
            <p className="m-0 text-xs text-[var(--cp-text-faint)]">{project.products.map((product) => product.name).join("、") || "未关联产品"} · {project.platforms.join(" / ")} · {project.linkedTasks.length ? `${project.linkedTasks.length} 条关联任务` : "未关联任务"}</p>
            <h2 className="mb-0 mt-2 max-w-[760px] text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[36px]">{project.name}</h2>
          </div>
          <div className="text-xs leading-relaxed text-[var(--cp-text-faint)] md:text-right">
            {project.lead.name} 负责 · {project.members.length} 人参与<br />{project.updatedBy} {project.updatedAt} 编辑
          </div>
        </div>
      </div>

      <nav className="sticky top-0 z-10 border-y border-[var(--cp-border-subtle)] bg-[rgba(255,255,255,0.96)]" aria-label="项目创作章节">
        <div className="cp-hidden-scrollbar flex w-full gap-6 overflow-x-auto px-5 md:px-8 xl:px-10">
          {creativeProjectChapters.map((item) => (
            <button
              key={item}
              type="button"
              className={cn(
                "relative h-12 shrink-0 text-sm text-[var(--cp-text-muted)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                chapter === item && "font-medium text-[var(--cp-text)]",
              )}
              aria-current={chapter === item ? "page" : undefined}
              onClick={() => setChapter(item)}
            >
              {item}
              {chapter === item ? <span className="absolute inset-x-0 bottom-0 h-px bg-[var(--cp-text)]" /> : null}
            </button>
          ))}
        </div>
      </nav>

      <div className="w-full px-5 py-10 md:px-8 md:py-12 xl:px-10">
        {chapter === "概览" ? <ProjectOverview project={project} /> : chapter === "产品确认" ? <ProductConfirmationWorkspace project={project} documents={documents} saved={project.chapters["产品确认"] ?? { body: "", documentIds: [] }} onSave={onSaveChapter} onSaveBrief={onSaveProductBrief} onRunAnalysis={onRunProductInsight} analysisStatus={productInsight.status} analysisError={productInsight.error} analysisMessages={productInsight.messages} /> : <><ProductBriefContext brief={project.productBrief} onOpenProduct={() => setChapter("产品确认")} />{chapter === "需求" ? <RequirementBriefWorkspace project={project} state={requirement} onQuestion={(questionId, answer, status) => { requirementBriefAdapter.answerQuestion({ project, questionId, answer, status }); refreshRequirement(); }} onConfirm={() => { requirementBriefAdapter.confirm(project); refreshRequirement(); }} onRunAnalysis={onRunRequirementUnderstanding} onApplyAnalysis={(analysis, questions) => { requirementBriefAdapter.applyAnalysis({ project, analysis, questions }); refreshRequirement(); }} analysisStatus={requirementUnderstanding.status} analysisError={requirementUnderstanding.error} analysisMessages={requirementUnderstanding.messages} /> : chapter === "选题" ? <TopicPlanningWorkspace project={project} onSave={(plan) => onSaveTopicPlan({ projectId: project.id, plan })} onRun={onRunTopicPlanning} ai={topicPlanning} onContinueToExpression={() => setChapter("表现形式")} /> : <ChapterWorkspace key={`${project.id}-${chapter}`} chapter={chapter} project={project} documents={documents} onSave={onSaveChapter} />}</>}
      </div>
    </article>
  );
}

function ProductBriefContext({ brief, onOpenProduct }: { brief: CreativeProject["productBrief"]; onOpenProduct: () => void }) {
  if (!brief) return <aside className="mb-8 flex flex-col gap-4 border border-dashed border-[var(--cp-border)] bg-[var(--cp-bg-subtle)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="m-0 text-[11px] font-semibold tracking-[0.1em] text-[var(--cp-text-faint)]">产品创作简报</p><p className="mb-0 mt-1.5 text-sm text-[var(--cp-text-muted)]">当前项目尚未关联简报；需求 AI 不会在缺少产品事实的情况下推断卖点或结构。</p></div><Button type="button" variant="outline" className="shrink-0" onClick={onOpenProduct}>前往产品确认</Button></aside>;
  const points = brief.coreSellingPoints.slice(0, 3).map((point) => point.fact).join(" · ");
  return <aside className="mb-8 border border-[#d8c08b] bg-[#fffcf6] px-5 py-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="m-0 text-[11px] font-semibold tracking-[0.1em] text-[#315c49]">已关联 · 产品创作简报</p><p className="mb-0 mt-1.5 text-sm font-semibold leading-relaxed text-[var(--cp-text)]">{brief.oneLineExpression}</p>{points ? <p className="mb-0 mt-2 text-xs leading-relaxed text-[var(--cp-text-muted)]">核心事实：{points}</p> : null}</div><Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={onOpenProduct}>查看简报</Button></div></aside>;
}

function ProjectOverview({ project }: { project: CreativeProject }) {
  return (
    <div>
      <p className="m-0 text-xs font-medium text-[var(--cp-text-faint)]">核心内容方向</p>
      <p className="mb-0 mt-4 max-w-[760px] text-xl leading-relaxed text-[var(--cp-text-soft)] md:text-[23px]">{project.coreDirection}</p>

      <dl className="mt-12 grid gap-x-10 gap-y-7 border-t border-[var(--cp-border-subtle)] pt-8 sm:grid-cols-2">
        <ContextLine term="内容目标" detail={project.contentGoal} />
        <ContextLine term="关联任务" detail={project.linkedTasks.map((task) => task.name).join("、") || "由创作空间直接创建"} />
        <ContextLine term="关联产品" detail={project.products.map((product) => product.name).join("、") || "尚未关联"} />
        <ContextLine term="发布平台" detail={project.platforms.join("、")} />
        <ContextLine term="项目负责人" detail={`${project.lead.name} · ${project.lead.role}`} />
        <ContextLine term="参与成员" detail={project.members.map((member) => `${member.name}（${member.role}）`).join("、")} />
      </dl>

      <div className="mt-12 border-t border-[var(--cp-border-subtle)] pt-8">
        <div className="flex items-center gap-3">
          <Users className="size-4 text-[var(--cp-text-faint)]" />
          <h3 className="m-0 text-sm font-semibold">共同创作记录</h3>
        </div>
        <p className="mb-0 mt-4 text-sm leading-relaxed text-[var(--cp-text-muted)]">项目中的脚本版本、剪辑版本和平台版本将保留在各自章节历史中。团队资产仅在项目结束后由成员人工确认沉淀。</p>
      </div>
    </div>
  );
}

function ContextLine({ term, detail }: { term: string; detail: string }) {
  return <div><dt className="text-xs text-[var(--cp-text-faint)]">{term}</dt><dd className="mb-0 ml-0 mt-2 text-sm leading-relaxed text-[var(--cp-text-soft)]">{detail}</dd></div>;
}

const chapterExamples: Record<Exclude<CreativeProjectChapter, "概览">, string> = {
  需求: "记录来源任务、业务背景、受众和必须回应的问题。",
  产品确认: "关联产品与 SKU，确认当前版本，保留已验证的产品事实、资料和待补充项；需求理解只读取这份事实快照。",
  选题: "明确这条内容唯一的核心选题，以及舍弃的备选方向。",
  表现形式: "描述视角、结构、节奏和适合当前平台的呈现方式。",
  脚本: "未来承载 AI 生成、AI 预审、人工修改、版本历史和最终拍摄版。",
  拍摄: "未来承载拍摄准备、执行记录和现场补充信息。",
  剪辑: "未来承载素材交接、剪辑重点、视频版本、审核与修改记录。",
  成片: "保留不同平台发布版本及其最终文件。",
  数据: "在发布后连接真实表现数据，不在项目中制造管理型仪表盘。",
  复盘: "沉淀结论、可复用方法，并由成员决定是否成为团队资产。",
};

function ChapterWorkspace({ chapter, project, documents, onSave }: { chapter: Exclude<CreativeProjectChapter, "概览">; project: CreativeProject; documents: CreativeDocument[]; onSave: (input: { projectId: string; chapter: Exclude<CreativeProjectChapter, "概览">; body: string; documentIds: string[] }) => void }) {
  const saved = project.chapters[chapter] ?? { body: "", documentIds: [] };
  const [isEditing, setIsEditing] = useState(!saved.body && !saved.documentIds.length);
  const [body, setBody] = useState(saved.body);
  const [documentIds, setDocumentIds] = useState(saved.documentIds);
  const linkedDocuments = documents.filter((document) => saved.documentIds.includes(document.id));

  function save() {
    onSave({ projectId: project.id, chapter, body, documentIds });
    setIsEditing(false);
  }

  function cancel() {
    setBody(saved.body);
    setDocumentIds(saved.documentIds);
    setIsEditing(false);
  }

  return (
    <div className="min-h-[360px] max-w-[900px]">
      <p className="m-0 text-xs text-[var(--cp-text-faint)]">{project.name}</p>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><h3 className="m-0 text-[28px] font-semibold tracking-[-0.02em]">{chapter}</h3><p className="mb-0 mt-4 max-w-[650px] text-base leading-relaxed text-[var(--cp-text-muted)]">{chapterExamples[chapter]}</p></div>
        {!isEditing ? <Button type="button" variant="outline" className="shrink-0" onClick={() => setIsEditing(true)}><Pencil className="size-4" />编辑信息</Button> : null}
      </div>
      {isEditing ? <div className="mt-9 border-y border-[var(--cp-border-subtle)] py-7"><div className="flex items-center gap-2"><FileText className="size-4 text-[var(--cp-text-muted)]" /><h4 className="m-0 text-sm font-semibold">章节信息</h4></div><textarea value={body} onChange={(event) => setBody(event.target.value)} className="mt-4 min-h-40 w-full resize-y rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-surface)] px-4 py-3 text-sm leading-7 text-[var(--cp-text-soft)] outline-none focus:border-[var(--cp-border-strong)] focus:ring-2 focus:ring-[var(--cp-focus)]" placeholder={`记录与「${chapter}」相关的事实、判断和下一步。`} aria-label={`${chapter}章节信息`} /><div className="mt-7 flex items-center gap-2"><Link2 className="size-4 text-[var(--cp-text-muted)]" /><h4 className="m-0 text-sm font-semibold">关联系统文档</h4><span className="text-xs text-[var(--cp-text-faint)]">选择后会保留在当前章节上下文中</span></div><div className="mt-3 divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border-subtle)]">{documents.map((document) => { const selected = documentIds.includes(document.id); return <label key={document.id} className="flex cursor-pointer gap-3 py-4 text-sm"><input type="checkbox" checked={selected} onChange={(event) => setDocumentIds((current) => event.target.checked ? [...current, document.id] : current.filter((id) => id !== document.id))} className="mt-1 size-4 shrink-0 accent-[var(--cp-text)]" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="font-medium text-[var(--cp-text)]">{document.title}</span><span className="text-[11px] text-[var(--cp-text-faint)]">{document.source} · {document.updatedAt}</span></span><span className="mt-1 block text-xs leading-relaxed text-[var(--cp-text-muted)]">{document.summary}</span></span></label>; })}</div><div className="mt-6 flex justify-end gap-3"><Button type="button" variant="ghost" onClick={cancel}><X className="size-4" />取消</Button><Button type="button" onClick={save}><Save className="size-4" />保存信息</Button></div></div> : <div className="mt-10 space-y-8">{saved.body ? <div className="border-l-2 border-[var(--cp-border)] pl-5"><p className="m-0 whitespace-pre-wrap text-sm leading-7 text-[var(--cp-text-soft)]">{saved.body}</p></div> : <div className="border-l-2 border-[var(--cp-border)] pl-5"><p className="m-0 text-sm font-medium">这一章节还没有内容</p><p className="mb-0 mt-2 text-sm text-[var(--cp-text-faint)]">可直接补充信息，或关联已有系统文档后继续编辑。</p></div>}{linkedDocuments.length ? <div><p className="m-0 flex items-center gap-2 text-sm font-semibold"><Link2 className="size-4 text-[var(--cp-text-muted)]" />已关联文档</p><div className="mt-3 divide-y divide-[var(--cp-border-subtle)] border-y border-[var(--cp-border-subtle)]">{linkedDocuments.map((document) => <div key={document.id} className="py-4"><p className="m-0 text-sm font-medium">{document.title}</p><p className="mb-0 mt-1 text-xs text-[var(--cp-text-muted)]">{document.source} · {document.updatedAt} · {document.summary}</p></div>)}</div></div> : null}</div>}
    </div>
  );
}

function InspirationWorkspace({ snapshot }: { snapshot: CreativeSpaceSnapshot }) {
  return (
    <section className="w-full px-5 py-10 md:px-8 md:py-12 xl:px-10">
      <PageIntro title="灵感与案例" description="先留住值得继续看的问题、画面和表达方法，未来可以引用到具体内容项目。" />
      <div className="mt-7 flex flex-wrap gap-2 text-xs text-[var(--cp-text-muted)]" aria-label="灵感内容类型">
        {["灵感", "参考视频", "案例", "用户评论", "项目引用"].map((label) => <span key={label} className="rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-subtle)] px-3 py-2">{label}</span>)}
      </div>
      <div className="mt-7 border-t border-[var(--cp-border-subtle)]">
        {snapshot.inspiration.map((item) => (
          <div key={item.id} className="grid gap-2 border-b border-[var(--cp-border-subtle)] py-6 md:grid-cols-[120px_minmax(0,1fr)_120px] md:gap-6">
            <span className="text-xs text-[var(--cp-text-faint)]">{item.type}</span>
            <div><h3 className="m-0 text-base font-semibold">{item.title}</h3><p className="mb-0 mt-2 text-sm leading-relaxed text-[var(--cp-text-muted)]">{item.note}</p></div>
            <span className="text-xs text-[var(--cp-text-faint)] md:text-right">{item.source}</span>
          </div>
        ))}
      </div>
      <p className="mb-0 mt-8 text-xs text-[var(--cp-text-faint)]">收藏、拆解与项目引用将在后续阶段接入。</p>
    </section>
  );
}

function AiToolbox({ onOpenCopywriting }: { onOpenCopywriting: () => void }) {
  const tools = [
    { label: "文案生成", description: "沿用现有对话式文案能力", icon: FileText, available: true },
    { label: "脚本生成", description: "快速生成临时脚本，不绑定内容项目", icon: BookOpenText, available: false },
    { label: "图片生成", description: "生成商品图与创意素材", icon: ImageIcon, available: false },
    { label: "视频生成", description: "生成视频草稿与视觉片段", icon: Video, available: false },
  ];
  return (
    <section className="w-full px-5 py-10 md:px-8 md:py-12 xl:px-10">
      <PageIntro title="AI 工具箱" description="适合临时、独立的创作需求。正式内容生产仍建议从内容项目开始。" />
      <div className="mt-8 border-t border-[var(--cp-border-subtle)]">
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            disabled={!tool.available}
            className="group flex w-full items-center gap-4 border-b border-[var(--cp-border-subtle)] py-6 text-left disabled:cursor-default disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
            onClick={tool.available ? onOpenCopywriting : undefined}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] text-[var(--cp-text-soft)]"><tool.icon className="size-[18px]" /></span>
            <span className="min-w-0 flex-1"><span className="block text-base font-semibold group-enabled:group-hover:underline">{tool.label}</span><span className="mt-1 block text-sm text-[var(--cp-text-muted)]">{tool.description}</span></span>
            <span className="shrink-0 text-xs text-[var(--cp-text-faint)]">{tool.available ? "立即使用" : "尚未开放"}</span>
            {tool.available ? <ArrowRight className="size-4 shrink-0 text-[var(--cp-text-faint)]" /> : null}
          </button>
        ))}
      </div>
      <div className="mt-10 flex items-start gap-3 text-sm leading-relaxed text-[var(--cp-text-muted)]">
        <Sparkles className="mt-0.5 size-4 shrink-0" /><p className="m-0">工具箱产出未来可以人工加入内容项目，但不会自动成为正式团队资产。</p>
      </div>
    </section>
  );
}
