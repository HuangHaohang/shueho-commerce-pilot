"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Check,
  Clapperboard,
  FileText,
  ImageIcon,
  ListFilter,
  Plus,
  Search,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  creativeProjectChapters,
  creativeSpaceAdapter,
  type CreateCreativeProjectInput,
  type CreativeProject,
  type CreativeProjectChapter,
  type CreativeSpaceSnapshot,
} from "@/lib/creative/creative-space-adapter";
import { cn } from "@/lib/utils";

type CreativeSection = "my-work" | "projects" | "inspiration" | "toolbox";
type CreativeRoute =
  | { kind: "section"; section: CreativeSection }
  | { kind: "create-project" }
  | { kind: "project"; projectId: string };

const sectionItems: Array<{ id: CreativeSection; label: string }> = [
  { id: "my-work", label: "我的创作" },
  { id: "projects", label: "内容项目" },
  { id: "inspiration", label: "灵感与案例" },
  { id: "toolbox", label: "AI 工具箱" },
];

export function CreativeSpaceWorkspace({ onOpenCopywriting }: { onOpenCopywriting: () => void }) {
  const [snapshot, setSnapshot] = useState<CreativeSpaceSnapshot>(() => creativeSpaceAdapter.getSnapshot());
  const [route, setRoute] = useState<CreativeRoute>({ kind: "section", section: "my-work" });

  const activeSection: CreativeSection =
    route.kind === "section" ? route.section : route.kind === "project" || route.kind === "create-project" ? "projects" : "my-work";

  function openSection(section: CreativeSection) {
    setRoute({ kind: "section", section });
  }

  function createProject(input: CreateCreativeProjectInput) {
    const project = creativeSpaceAdapter.createProject(input);
    setSnapshot(creativeSpaceAdapter.getSnapshot());
    setRoute({ kind: "project", projectId: project.id });
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
          <MyCreativeWork projects={snapshot.projects} onOpenProject={(projectId) => setRoute({ kind: "project", projectId })} />
        ) : null}
        {route.kind === "section" && route.section === "projects" ? (
          <ContentProjectList
            projects={snapshot.projects}
            onCreate={() => setRoute({ kind: "create-project" })}
            onOpenProject={(projectId) => setRoute({ kind: "project", projectId })}
          />
        ) : null}
        {route.kind === "create-project" ? (
          <ProjectCreateForm snapshot={snapshot} onCancel={() => openSection("projects")} onCreate={createProject} />
        ) : null}
        {route.kind === "project" && selectedProject ? (
          <ContentProjectWorkspace project={selectedProject} onBack={() => openSection("projects")} />
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

function MyCreativeWork({ projects, onOpenProject }: { projects: CreativeProject[]; onOpenProject: (projectId: string) => void }) {
  const focusProject = projects[0];
  return (
    <section className="mx-auto w-full max-w-[1040px] px-5 py-10 md:px-10 md:py-14">
      <PageIntro title="我的创作" description="从你参与的内容项目中，继续最近的创作和需要推进的内容。当前为任务系统接入前的示例视图。" />

      {focusProject ? (
        <section className="grid gap-6 border-b border-[var(--cp-border-subtle)] py-9 md:grid-cols-[180px_minmax(0,1fr)]">
          <div>
            <p className="m-0 text-xs font-medium text-[var(--cp-text-muted)]">继续创作</p>
            <p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">上次停在「{focusProject.currentChapter}」</p>
          </div>
          <button type="button" className="group min-w-0 text-left focus-visible:outline-none" onClick={() => onOpenProject(focusProject.id)}>
            <h3 className="m-0 text-xl font-semibold leading-snug group-hover:underline">{focusProject.name}</h3>
            <p className="mb-0 mt-3 max-w-[680px] text-sm leading-relaxed text-[var(--cp-text-muted)]">{focusProject.coreDirection}</p>
            <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium">
              回到创作 <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        </section>
      ) : null}

      <div className="grid gap-x-12 md:grid-cols-2">
        <CreativeWorkSection title="待我推进" description="依据当前阶段与协作角色形成">
          {projects.slice(0, 2).map((project) => (
            <ProjectTextRow key={project.id} project={project} detail={`继续完善「${project.currentChapter}」`} onOpen={onOpenProject} />
          ))}
        </CreativeWorkSection>
        <CreativeWorkSection title="最近编辑" description="按最近创作行为排列">
          {projects.slice(1).map((project) => (
            <ProjectTextRow key={project.id} project={project} detail={`${project.updatedBy} · ${project.updatedAt}`} onOpen={onOpenProject} />
          ))}
        </CreativeWorkSection>
        <CreativeWorkSection title="最近产出" description="仍保留在项目历史中">
          {projects.filter((project) => project.recentOutput).map((project) => (
            <ProjectTextRow key={project.id} project={project} detail={project.recentOutput ?? ""} onOpen={onOpenProject} />
          ))}
        </CreativeWorkSection>
      </div>
    </section>
  );
}

function CreativeWorkSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="py-9">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        <span className="text-xs text-[var(--cp-text-faint)]">{description}</span>
      </div>
      <div className="border-t border-[var(--cp-border-subtle)]">{children}</div>
    </section>
  );
}

function ProjectTextRow({ project, detail, onOpen }: { project: CreativeProject; detail: string; onOpen: (projectId: string) => void }) {
  return (
    <button
      type="button"
      className="group flex w-full items-start justify-between gap-5 border-b border-[var(--cp-border-subtle)] py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]"
      onClick={() => onOpen(project.id)}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium group-hover:underline">{project.name}</span>
        <span className="mt-1 block text-xs text-[var(--cp-text-faint)]">{detail}</span>
      </span>
      <ArrowRight className="mt-1 size-4 shrink-0 text-[var(--cp-text-faint)] transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function ContentProjectList({ projects, onCreate, onOpenProject }: { projects: CreativeProject[]; onCreate: () => void; onOpenProject: (projectId: string) => void }) {
  const [query, setQuery] = useState("");
  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects;
    return projects.filter((project) =>
      [project.name, project.coreDirection, project.product?.name ?? "", ...project.platforms].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [projects, query]);

  return (
    <section className="mx-auto w-full max-w-[1040px] px-5 py-10 md:px-10 md:py-14">
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
              <span className="text-xs text-[var(--cp-text-muted)]">{project.product?.name ?? "暂未关联产品"} · {project.platforms.join(" / ")}</span>
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

function ProjectCreateForm({ snapshot, onCancel, onCreate }: { snapshot: CreativeSpaceSnapshot; onCancel: () => void; onCreate: (input: CreateCreativeProjectInput) => void }) {
  const [name, setName] = useState("");
  const [linkedTaskId, setLinkedTaskId] = useState("");
  const [productId, setProductId] = useState("");
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
      linkedTaskId: linkedTaskId || null,
      productId: productId || null,
      platforms,
      contentGoal,
      leadId,
      memberIds,
    });
  }

  return (
    <section className="mx-auto w-full max-w-[840px] px-5 py-10 md:px-10 md:py-14">
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
            关联任务 <span className="font-normal text-[var(--cp-text-faint)]">可选</span>
            <select value={linkedTaskId} onChange={(event) => setLinkedTaskId(event.target.value)} className={fieldClassName}>
              <option value="">不关联来源任务</option>
              {snapshot.tasks.map((task) => <option key={task.id} value={task.id}>{task.name}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">
            关联产品 <span className="font-normal text-[var(--cp-text-faint)]">可选</span>
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className={fieldClassName}>
              <option value="">进入项目后再关联</option>
              {snapshot.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
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
            <select value={leadId} onChange={(event) => setLeadId(event.target.value)} className={fieldClassName}>
              {snapshot.people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="text-sm font-medium">参与成员</legend>
            <div className="mt-2 flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--cp-border)] py-2">
              {snapshot.people.filter((person) => person.id !== leadId).map((person) => (
                <label key={person.id} className="flex items-center gap-2 text-sm font-normal text-[var(--cp-text-muted)]">
                  <input
                    type="checkbox"
                    checked={memberIds.includes(person.id)}
                    onChange={(event) => setMemberIds((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))}
                  />
                  {person.name}
                </label>
              ))}
            </div>
          </fieldset>
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

function ContentProjectWorkspace({ project, onBack }: { project: CreativeProject; onBack: () => void }) {
  const [chapter, setChapter] = useState<CreativeProjectChapter>("概览");
  return (
    <article className="min-h-full">
      <div className="mx-auto w-full max-w-[1120px] px-5 pt-8 md:px-10 md:pt-10">
        <button type="button" className="inline-flex items-center gap-2 text-sm text-[var(--cp-text-muted)] hover:text-[var(--cp-text)]" onClick={onBack}>
          <ArrowLeft className="size-4" />内容项目
        </button>
        <div className="grid gap-5 pb-8 pt-6 md:grid-cols-[minmax(0,1fr)_240px] md:items-end">
          <div>
            <p className="m-0 text-xs text-[var(--cp-text-faint)]">{project.product?.name ?? "未关联产品"} · {project.platforms.join(" / ")}</p>
            <h2 className="mb-0 mt-2 max-w-[760px] text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[36px]">{project.name}</h2>
          </div>
          <div className="text-xs leading-relaxed text-[var(--cp-text-faint)] md:text-right">
            {project.lead.name} 负责 · {project.members.length} 人参与<br />{project.updatedBy} {project.updatedAt} 编辑
          </div>
        </div>
      </div>

      <nav className="sticky top-0 z-10 border-y border-[var(--cp-border-subtle)] bg-[rgba(255,255,255,0.96)]" aria-label="项目创作章节">
        <div className="cp-hidden-scrollbar mx-auto flex w-full max-w-[1120px] gap-6 overflow-x-auto px-5 md:px-10">
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

      <div className="mx-auto w-full max-w-[920px] px-5 py-10 md:px-10 md:py-14">
        {chapter === "概览" ? <ProjectOverview project={project} /> : <ChapterPlaceholder chapter={chapter} project={project} />}
      </div>
    </article>
  );
}

function ProjectOverview({ project }: { project: CreativeProject }) {
  return (
    <div>
      <p className="m-0 text-xs font-medium text-[var(--cp-text-faint)]">核心内容方向</p>
      <p className="mb-0 mt-4 max-w-[760px] text-xl leading-relaxed text-[var(--cp-text-soft)] md:text-[23px]">{project.coreDirection}</p>

      <dl className="mt-12 grid gap-x-10 gap-y-7 border-t border-[var(--cp-border-subtle)] pt-8 sm:grid-cols-2">
        <ContextLine term="内容目标" detail={project.contentGoal} />
        <ContextLine term="来源任务" detail={project.linkedTask?.name ?? "由创作空间直接创建"} />
        <ContextLine term="关联产品" detail={project.product?.name ?? "尚未关联"} />
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
  产品: "引用产品资料，保留与当前内容方向相关的事实和使用证据。",
  选题: "明确这条内容唯一的核心选题，以及舍弃的备选方向。",
  表现形式: "描述视角、结构、节奏和适合当前平台的呈现方式。",
  脚本: "未来承载 AI 生成、AI 预审、人工修改、版本历史和最终拍摄版。",
  拍摄: "未来承载拍摄准备、执行记录和现场补充信息。",
  剪辑: "未来承载素材交接、剪辑重点、视频版本、审核与修改记录。",
  成片: "保留不同平台发布版本及其最终文件。",
  数据: "在发布后连接真实表现数据，不在项目中制造管理型仪表盘。",
  复盘: "沉淀结论、可复用方法，并由成员决定是否成为团队资产。",
};

function ChapterPlaceholder({ chapter, project }: { chapter: Exclude<CreativeProjectChapter, "概览">; project: CreativeProject }) {
  return (
    <div className="min-h-[360px]">
      <p className="m-0 text-xs text-[var(--cp-text-faint)]">{project.name}</p>
      <h3 className="mb-0 mt-3 text-[28px] font-semibold tracking-[-0.02em]">{chapter}</h3>
      <p className="mb-0 mt-5 max-w-[650px] text-base leading-relaxed text-[var(--cp-text-muted)]">{chapterExamples[chapter]}</p>
      <div className="mt-12 border-l-2 border-[var(--cp-border)] pl-5">
        <p className="m-0 text-sm font-medium">这一章节还没有内容</p>
        <p className="mb-0 mt-2 text-sm text-[var(--cp-text-faint)]">后续能力会在这里自然进入当前项目上下文。本阶段只保留正确的创作位置。</p>
      </div>
    </div>
  );
}

function InspirationWorkspace({ snapshot }: { snapshot: CreativeSpaceSnapshot }) {
  return (
    <section className="mx-auto w-full max-w-[960px] px-5 py-10 md:px-10 md:py-14">
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
    <section className="mx-auto w-full max-w-[900px] px-5 py-10 md:px-10 md:py-14">
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
