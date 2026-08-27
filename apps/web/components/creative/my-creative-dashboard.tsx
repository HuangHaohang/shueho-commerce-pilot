"use client";

import {
  ArrowLeft,
  ArrowRight,
  Camera,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Lightbulb,
  ListTodo,
  Search,
  Scissors,
  Send,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeProject, CreativeProjectChapter } from "@/lib/creative/creative-space-adapter";
import {
  filterMyCreativeDashboard,
  getMockMyCreativeDashboard,
  type MyCreativeAction,
  type MyCreativeFocus,
  type MyCreativeRecentTab,
  type MyCreativeStage,
  type MyCreativeTimeRange,
} from "@/lib/creative/my-creative-adapter";
import { cn } from "@/lib/utils";

type OpenCreativeProject = (projectId: string, chapter?: CreativeProjectChapter) => void;

type MyCreativeDashboardPageProps = {
  projects: CreativeProject[];
  onOpenProject: OpenCreativeProject;
};

const timeRanges: Array<{ id: MyCreativeTimeRange; label: string }> = [
  { id: "today", label: "今天" },
  { id: "week", label: "本周" },
  { id: "7days", label: "近 7 天" },
];

const recentTabs: MyCreativeRecentTab[] = ["最近创作", "最近产出", "即将开始"];

export function MyCreativeDashboardPage({ projects, onOpenProject }: MyCreativeDashboardPageProps) {
  const [range, setRange] = useState<MyCreativeTimeRange>("week");
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [recentTab, setRecentTab] = useState<MyCreativeRecentTab>("最近创作");
  const [detailStage, setDetailStage] = useState<MyCreativeStage | null>(null);

  const dashboard = useMemo(() => getMockMyCreativeDashboard(projects), [projects]);
  const visible = useMemo(
    () => filterMyCreativeDashboard(dashboard, { range, role: "全部", stage: null, query }),
    [dashboard, query, range],
  );
  const overviewSummaries = dashboard.summaries.map((item) => {
    if (item.id === "pending") return { ...item, value: visible.actions.length };
    if (item.id === "today") return { ...item, value: visible.actions.filter((action) => action.group === "今天").length };
    if (item.id === "risk") return { ...item, value: dashboard.risks.length };
    return item;
  });
  const overviewStages = dashboard.stages.map((item) => ({
    ...item,
    count: visible.actions.filter((action) => action.stage === item.stage).length,
  }));
  const focus = visible.focuses[focusIndex % Math.max(visible.focuses.length, 1)] ?? null;
  const recent = visible.recent.filter((item) => item.tab === recentTab);

  function switchFocus(direction: number) {
    if (visible.focuses.length < 2) return;
    setFocusIndex((current) => (current + direction + visible.focuses.length) % visible.focuses.length);
  }

  if (detailStage) {
    return (
      <MyCreativeStagePage
        dashboard={dashboard}
        stage={detailStage}
        query={query}
        range={range}
        onBack={() => setDetailStage(null)}
        onQueryChange={setQuery}
        onRangeChange={setRange}
        onStageChange={setDetailStage}
        onOpenProject={onOpenProject}
      />
    );
  }

  return (
    <div className="min-h-full bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <section className="w-full px-5 py-7 md:px-7 md:py-8 xl:px-8">
        <MyCreativeHeader
          headline={dashboard.headline}
          query={query}
          range={range}
          onQueryChange={(value) => { setQuery(value); setFocusIndex(0); }}
          onRangeChange={(value) => { setRange(value); setFocusIndex(0); }}
        />

        <MyWorkOverview summaries={overviewSummaries} stages={overviewStages} onOpenStage={setDetailStage} />

        <div className="mt-5 grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <MyTaskList actions={visible.actions} onOpenProject={onOpenProject} />
            <MyRecentTabs activeTab={recentTab} items={recent} onTabChange={setRecentTab} onOpenProject={onOpenProject} />
          </div>

          <div className="min-w-0 space-y-5">
            <MyFocusPanel
              focus={focus}
              total={visible.focuses.length}
              index={focusIndex}
              onPrevious={() => switchFocus(-1)}
              onNext={() => switchFocus(1)}
              onOpenProject={onOpenProject}
            />
            <MyAttentionPanel risks={dashboard.risks} aiReminders={dashboard.aiReminders} />
            <MyActivityFeed activities={visible.activities} onOpenProject={onOpenProject} />
          </div>
        </div>
      </section>
    </div>
  );
}

function MyCreativeHeader({ headline, query, range, onQueryChange, onRangeChange }: {
  headline: string;
  query: string;
  range: MyCreativeTimeRange;
  onQueryChange: (value: string) => void;
  onRangeChange: (value: MyCreativeTimeRange) => void;
}) {
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="m-0 text-xs text-[var(--cp-text-faint)]">我的工作台</p>
        <h2 className="mb-0 mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">我的创作</h2>
        <p className="mb-0 mt-3 text-sm text-[var(--cp-text-muted)]">{headline}</p>
      </div>
      <WorkFilters query={query} range={range} onQueryChange={onQueryChange} onRangeChange={onRangeChange} />
    </header>
  );
}

function WorkFilters({ query, range, onQueryChange, onRangeChange }: {
  query: string;
  range: MyCreativeTimeRange;
  onQueryChange: (value: string) => void;
  onRangeChange: (value: MyCreativeTimeRange) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="flex h-10 min-w-0 items-center gap-2 rounded-[var(--cp-radius-control)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-3 sm:w-[260px]">
        <Search className="size-3.5 shrink-0 text-[var(--cp-text-faint)]" aria-hidden="true" />
        <span className="sr-only">搜索我的任务</span>
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none placeholder:text-[var(--cp-text-faint)]" placeholder="搜索项目或下一步动作" />
      </label>
      <div className="inline-flex w-fit rounded-[var(--cp-radius-control)] bg-[var(--cp-bg-subtle)] p-1" aria-label="时间范围">
        {timeRanges.map((item) => <button key={item.id} type="button" className={cn("h-8 rounded-[var(--cp-radius-item)] px-3 text-xs text-[var(--cp-text-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]", range === item.id && "bg-[var(--cp-text)] font-medium text-[var(--cp-text-inverse)]")} aria-pressed={range === item.id} onClick={() => onRangeChange(item.id)}>{item.label}</button>)}
      </div>
    </div>
  );
}

function MyWorkOverview({ summaries, stages, onOpenStage }: {
  summaries: ReturnType<typeof getMockMyCreativeDashboard>["summaries"];
  stages: ReturnType<typeof getMockMyCreativeDashboard>["stages"];
  onOpenStage: (stage: MyCreativeStage) => void;
}) {
  const summaryStyles = {
    pending: { icon: ListTodo, className: "bg-[var(--cp-info-bg)] text-[var(--cp-info)]" },
    today: { icon: CalendarClock, className: "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]" },
    overdue: { icon: CheckCircle2, className: "bg-[var(--cp-success-bg)] text-[var(--cp-success)]" },
    risk: { icon: TriangleAlert, className: "bg-[var(--cp-danger-bg)] text-[var(--cp-danger)]" },
  } as const;
  const stageStyles: Record<MyCreativeStage, { icon: typeof Lightbulb; className: string }> = {
    策划: { icon: Lightbulb, className: "bg-[var(--cp-warning-bg)] text-[var(--cp-warning)]" },
    拍摄: { icon: Camera, className: "bg-[var(--cp-info-bg)] text-[var(--cp-info)]" },
    剪辑: { icon: Scissors, className: "bg-[#f3f0ff] text-[#6750a4]" },
    审核: { icon: ShieldCheck, className: "bg-[var(--cp-success-bg)] text-[var(--cp-success)]" },
    待发布: { icon: Send, className: "bg-[#fff2eb] text-[#b54708]" },
  };
  return (
    <section className="mt-7" aria-labelledby="my-work-overview-title">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {summaries.map((item) => {
          const style = summaryStyles[item.id];
          const Icon = style.icon;
          return (
            <article key={item.id} className="flex min-h-[96px] items-center gap-3 rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-4 py-4 sm:gap-4 sm:px-5">
              <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)]", style.className)}><Icon className="size-[18px]" /></span>
              <div className="min-w-0"><p className="m-0 text-xs text-[var(--cp-text-muted)]">{item.label}</p><p className="mb-0 mt-1 flex items-baseline gap-1"><span className="text-[30px] font-semibold leading-none tracking-[-0.04em]">{item.value}</span><span className="text-xs text-[var(--cp-text-faint)]">{item.unit}</span></p></div>
            </article>
          );
        })}
      </div>

      <div className="mt-4 rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <h3 id="my-work-overview-title" className="m-0 text-base font-semibold">负责环节</h3>
          <span className="text-xs text-[var(--cp-text-faint)]">点击查看全部任务</span>
        </div>
        <div className="cp-hidden-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1">
          {stages.map((item) => {
            const style = stageStyles[item.stage];
            const Icon = style.icon;
            return <button key={item.stage} type="button" className="group flex min-w-[156px] flex-1 items-center gap-3 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--cp-bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={() => onOpenStage(item.stage)} aria-label={`查看我的${item.stage}任务，共 ${item.count} 件`}><span className={cn("flex size-9 shrink-0 items-center justify-center rounded-[var(--cp-radius-item)]", style.className)}><Icon className="size-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{item.stage}</span><span className="mt-0.5 block text-xs text-[var(--cp-text-muted)]">{item.count} 件</span></span><ArrowRight className="size-3.5 shrink-0 text-[var(--cp-text-faint)] transition-transform group-hover:translate-x-0.5" /></button>;
          })}
        </div>
      </div>
    </section>
  );
}

function MyTaskList({ actions, onOpenProject, title = "待办任务", description = "" }: { actions: MyCreativeAction[]; onOpenProject: OpenCreativeProject; title?: string; description?: string }) {
  const groups = (["今天", "明天", "之后"] as const).map((label) => ({ label, items: actions.filter((item) => item.group === label) })).filter((group) => group.items.length);
  return (
    <section className="overflow-hidden rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-bg)]" aria-labelledby="my-task-list-title">
      <header className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6"><div><h3 id="my-task-list-title" className="m-0 text-lg font-semibold">{title}</h3>{description ? <p className="mb-0 mt-1 text-xs text-[var(--cp-text-muted)]">{description}</p> : null}</div><span className="shrink-0 rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--cp-text-muted)]">{actions.length} 件</span></header>
      <div className="border-t border-[var(--cp-border-subtle)]">
        {groups.map((group) => <section key={group.label} aria-label={`${group.label}的任务`}><p className="m-0 flex items-center gap-2 border-b border-[var(--cp-border-subtle)] bg-[var(--cp-bg-subtle)] px-5 py-2 text-[10px] font-semibold text-[var(--cp-text-muted)] sm:px-6"><span className={cn("size-1.5 rounded-full", group.label === "今天" ? "bg-[var(--cp-danger)]" : "bg-[var(--cp-text-faint)]")} />{group.label}</p>{group.items.map((action) => <button key={action.id} type="button" className="group grid w-full gap-2 border-b border-[var(--cp-border-subtle)] px-5 py-4 text-left transition-colors hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cp-focus)] sm:px-6 md:grid-cols-[86px_minmax(0,1fr)_120px] md:items-center" onClick={() => onOpenProject(action.projectId, action.chapter)}><span className="w-fit rounded-[var(--cp-radius-segment)] bg-[var(--cp-bg-subtle)] px-2.5 py-1 text-[10px] font-medium text-[var(--cp-text-soft)]">{action.stage}</span><span className="min-w-0"><span className="block text-sm font-semibold leading-relaxed group-hover:underline">{action.title}</span><span className="mt-1 block truncate text-xs text-[var(--cp-text-muted)]">{action.projectName} · {action.status}</span></span><span className="flex items-center justify-between gap-3 text-xs text-[var(--cp-text-muted)] md:justify-end"><Clock3 className="size-3.5 text-[var(--cp-text-faint)]" /><span>{action.schedule}</span><ChevronRight className="size-4 text-[var(--cp-text-faint)] transition-transform group-hover:translate-x-0.5" /></span></button>)}</section>)}
        {!actions.length ? <div className="px-6 py-12"><p className="m-0 text-sm font-medium">当前没有需要处理的任务</p><p className="mb-0 mt-2 text-xs text-[var(--cp-text-muted)]">调整时间范围或搜索条件后再查看。</p></div> : null}
      </div>
    </section>
  );
}

function MyFocusPanel({ focus, total, index, onPrevious, onNext, onOpenProject }: { focus: MyCreativeFocus | null; total: number; index: number; onPrevious: () => void; onNext: () => void; onOpenProject: OpenCreativeProject }) {
  return (
    <aside className="overflow-hidden rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-bg-subtle)]" aria-labelledby="today-focus-title">
      <header className="flex items-center justify-between border-b border-[var(--cp-border)] px-5 py-4"><div className="flex items-center gap-2"><CalendarCheck2 className="size-4 text-[var(--cp-text-muted)]" /><h3 id="today-focus-title" className="m-0 text-sm font-semibold">今天先做这件</h3></div><div className="flex items-center gap-1"><span className="mr-1 text-[10px] text-[var(--cp-text-faint)]">{total ? `${(index % total) + 1} / ${total}` : "0 / 0"}</span><button type="button" className="flex size-7 items-center justify-center rounded-full hover:bg-[var(--cp-bg-muted)] disabled:opacity-30" onClick={onPrevious} disabled={total < 2} aria-label="上一个今日重点"><ChevronLeft className="size-4" /></button><button type="button" className="flex size-7 items-center justify-center rounded-full hover:bg-[var(--cp-bg-muted)] disabled:opacity-30" onClick={onNext} disabled={total < 2} aria-label="下一个今日重点"><ChevronRight className="size-4" /></button></div></header>
      {focus ? <div className="p-5"><span className="text-[10px] text-[var(--cp-text-faint)]">{focus.stage} · {focus.versionLabel}</span><p className="mb-0 mt-3 text-lg font-semibold leading-snug">{focus.projectName}</p><p className="mb-0 mt-4 text-sm font-medium leading-relaxed text-[var(--cp-text-soft)]">{focus.todayGoal}</p><p className="mb-0 mt-3 flex items-center gap-2 text-xs text-[var(--cp-text-muted)]"><Clock3 className="size-3.5 text-[var(--cp-text-faint)]" />{focus.deadline}</p><Button type="button" className="mt-5 w-full" onClick={() => onOpenProject(focus.projectId, focus.chapter)}>继续处理 <ArrowRight className="size-4" /></Button></div> : <div className="p-5 text-xs text-[var(--cp-text-muted)]">当前筛选下没有今日重点。</div>}
    </aside>
  );
}

function MyAttentionPanel({ risks, aiReminders }: { risks: string[]; aiReminders: string[] }) {
  return <aside className="rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-danger-bg)] p-5" aria-labelledby="attention-title"><h3 id="attention-title" className="m-0 flex items-center gap-2 text-base font-semibold"><TriangleAlert className="size-4 text-[var(--cp-danger)]" />需要留意</h3><ul className="mb-0 mt-4 space-y-3 pl-4 text-xs leading-5 text-[var(--cp-text-muted)] marker:text-[var(--cp-danger)]">{risks.map((item) => <li key={item}>{item}</li>)}</ul><details className="mt-4 border-t border-[color:rgba(217,45,32,0.14)] pt-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium"><Sparkles className="size-3.5 text-[var(--cp-text-muted)]" />创作提示</summary><ul className="mb-0 mt-3 space-y-2 pl-4 text-xs leading-5 text-[var(--cp-text-muted)]">{aiReminders.map((item) => <li key={item}>{item}</li>)}</ul></details></aside>;
}

function MyActivityFeed({ activities, onOpenProject }: { activities: ReturnType<typeof getMockMyCreativeDashboard>["activities"]; onOpenProject: OpenCreativeProject }) {
  return <section className="rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-bg)] p-5" aria-labelledby="activity-feed-title"><div className="flex items-center justify-between"><h3 id="activity-feed-title" className="m-0 text-base font-semibold">与我有关的动态</h3><span className="text-[10px] text-[var(--cp-text-faint)]">最近</span></div><div className="mt-4 border-t border-[var(--cp-border-subtle)]">{activities.slice(0, 4).map((item) => <button key={item.id} type="button" className="group flex w-full gap-2.5 border-b border-[var(--cp-border-subtle)] py-3 text-left hover:bg-[var(--cp-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={() => onOpenProject(item.projectId, item.chapter)}><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--cp-text-faint)]" /><span className="min-w-0 flex-1 text-xs leading-5"><span className="font-medium">{item.actor}</span> {item.verb}<span className="block truncate font-medium group-hover:underline">{item.target}</span></span><span className="shrink-0 text-[9px] text-[var(--cp-text-faint)]">{item.time}</span></button>)}</div></section>;
}

function MyRecentTabs({ activeTab, items, onTabChange, onOpenProject }: { activeTab: MyCreativeRecentTab; items: ReturnType<typeof getMockMyCreativeDashboard>["recent"]; onTabChange: (tab: MyCreativeRecentTab) => void; onOpenProject: OpenCreativeProject }) {
  return (
    <section className="mt-5 rounded-[var(--cp-radius-panel)] border border-[var(--cp-border)] bg-[var(--cp-bg)] px-5 py-5" aria-labelledby="recent-content-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h3 id="recent-content-title" className="m-0 text-base font-semibold">最近处理</h3><div className="cp-hidden-scrollbar flex gap-5 overflow-x-auto border-b border-[var(--cp-border)]" role="tablist" aria-label="最近内容类型">{recentTabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={cn("relative h-8 shrink-0 text-xs text-[var(--cp-text-muted)]", activeTab === tab && "font-medium text-[var(--cp-text)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-[var(--cp-text)]")} onClick={() => onTabChange(tab)}>{tab}</button>)}</div></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{items.map((item) => <button key={item.id} type="button" className="group min-w-0 rounded-[var(--cp-radius-item)] bg-[var(--cp-bg-subtle)] p-4 text-left transition-colors hover:bg-[var(--cp-bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={() => onOpenProject(item.projectId, item.chapter)}><span className="flex items-center justify-between gap-3"><span className="text-[10px] text-[var(--cp-text-faint)]">{item.kind}</span><ArrowRight className="size-3.5 text-[var(--cp-text-faint)] transition-transform group-hover:translate-x-0.5" /></span><span className="mt-3 block truncate text-sm font-semibold group-hover:underline">{item.title}</span><span className="mt-1.5 block truncate text-xs text-[var(--cp-text-muted)]">{item.projectName}</span><span className="mt-3 block text-[10px] text-[var(--cp-text-muted)]">{item.meta}</span></button>)}</div>
      {!items.length ? <div className="py-8"><p className="m-0 text-xs font-medium">这里还没有内容</p><p className="mb-0 mt-2 text-[11px] text-[var(--cp-text-muted)]">调整时间范围后再查看。</p></div> : null}
    </section>
  );
}

function MyCreativeStagePage({ dashboard, stage, query, range, onBack, onQueryChange, onRangeChange, onStageChange, onOpenProject }: { dashboard: ReturnType<typeof getMockMyCreativeDashboard>; stage: MyCreativeStage; query: string; range: MyCreativeTimeRange; onBack: () => void; onQueryChange: (value: string) => void; onRangeChange: (value: MyCreativeTimeRange) => void; onStageChange: (stage: MyCreativeStage) => void; onOpenProject: OpenCreativeProject }) {
  const stagePool = useMemo(() => filterMyCreativeDashboard(dashboard, { range, role: "全部", stage: null, query }), [dashboard, query, range]);
  const visible = useMemo(() => ({ ...stagePool, actions: stagePool.actions.filter((action) => action.stage === stage) }), [stage, stagePool]);
  const stageCounts = dashboard.stages.map((item) => ({ ...item, count: stagePool.actions.filter((action) => action.stage === item.stage).length }));
  const current = dashboard.stages.find((item) => item.stage === stage);
  return (
    <div className="min-h-full bg-[var(--cp-bg)] text-[var(--cp-text)]">
      <section className="mx-auto w-full max-w-[1040px] px-5 py-8 md:px-8 md:py-10">
        <button type="button" className="inline-flex items-center gap-2 text-sm text-[var(--cp-text-muted)] hover:text-[var(--cp-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={onBack}><ArrowLeft className="size-4" />返回我的创作</button>
        <header className="mt-6 flex flex-col gap-5 border-b border-[var(--cp-border-subtle)] pb-7 md:flex-row md:items-end md:justify-between"><div><p className="m-0 text-xs text-[var(--cp-text-faint)]">我的负责环节</p><h2 className="mb-0 mt-2 text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">我的{stage}任务</h2><p className="mb-0 mt-2 text-sm text-[var(--cp-text-muted)]">{current?.note} · 当前范围共 {visible.actions.length} 件</p></div><WorkFilters query={query} range={range} onQueryChange={onQueryChange} onRangeChange={onRangeChange} /></header>
        <nav className="cp-hidden-scrollbar mt-5 flex gap-2 overflow-x-auto pb-1" aria-label="我的任务环节">{stageCounts.map((item) => <button key={item.stage} type="button" className={cn("flex min-w-[122px] items-center justify-between rounded-[var(--cp-radius-item)] px-4 py-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]", stage === item.stage ? "bg-[var(--cp-text)] font-semibold text-[var(--cp-text-inverse)]" : "bg-[var(--cp-bg-subtle)] text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-muted)]")} aria-current={stage === item.stage ? "page" : undefined} onClick={() => onStageChange(item.stage)}><span>{item.stage}</span><span className={stage === item.stage ? "text-white/75" : "text-[var(--cp-text-faint)]"}>{item.count}</span></button>)}</nav>
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <MyTaskList actions={visible.actions} title={`${stage}任务`} description="点击任务会直接进入项目中需要处理的章节。" onOpenProject={onOpenProject} />
          <aside className="rounded-[var(--cp-radius-panel)] bg-[var(--cp-bg-subtle)] p-5 text-xs leading-6 text-[var(--cp-text-muted)]"><h3 className="m-0 flex items-center gap-2 text-base font-semibold text-[var(--cp-text)]"><CheckCircle2 className="size-4" />这个视图只看什么</h3><p className="mb-0 mt-4">这里汇总你在“{stage}”环节需要负责或确认的事项，不会建立新的任务实体。</p><div className="mt-4 border-t border-[var(--cp-border)] pt-4"><p className="m-0 flex items-center gap-2 font-semibold text-[var(--cp-text)]"><CircleAlert className="size-3.5 text-[var(--cp-danger)]" />处理建议</p><p className="mb-0 mt-2">先处理今天到期，再打开对应项目章节继续创作。</p></div></aside>
        </div>
      </section>
    </div>
  );
}
