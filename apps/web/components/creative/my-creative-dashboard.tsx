"use client";

import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Leaf,
  Paperclip,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeProject } from "@/lib/creative/creative-space-adapter";
import {
  filterMyCreativeDashboard,
  getMockMyCreativeDashboard,
  type MyCreativeAction,
  type MyCreativeRecentTab,
  type MyCreativeRole,
  type MyCreativeStage,
  type MyCreativeTimeRange,
} from "@/lib/creative/my-creative-adapter";
import { cn } from "@/lib/utils";

type MyCreativeDashboardPageProps = {
  projects: CreativeProject[];
  onOpenProject: (projectId: string) => void;
};

const timeRanges: Array<{ id: MyCreativeTimeRange; label: string }> = [
  { id: "today", label: "今天" },
  { id: "week", label: "本周" },
  { id: "7days", label: "近 7 天" },
];

const recentTabs: MyCreativeRecentTab[] = ["最近创作", "最近产出", "即将开始"];

export function MyCreativeDashboardPage({ projects, onOpenProject }: MyCreativeDashboardPageProps) {
  const [range, setRange] = useState<MyCreativeTimeRange>("week");
  const [role, setRole] = useState<MyCreativeRole>("全部");
  const [stage, setStage] = useState<MyCreativeStage | null>(null);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [recentTab, setRecentTab] = useState<MyCreativeRecentTab>("最近创作");

  const dashboard = useMemo(() => getMockMyCreativeDashboard(projects), [projects]);
  const visible = useMemo(
    () => filterMyCreativeDashboard(dashboard, { range, role, stage, query }),
    [dashboard, query, range, role, stage],
  );
  const focus = visible.focuses[focusIndex % Math.max(visible.focuses.length, 1)] ?? null;
  const recent = visible.recent.filter((item) => item.tab === recentTab);

  function switchFocus(direction: number) {
    if (visible.focuses.length < 2) return;
    setFocusIndex((current) => (current + direction + visible.focuses.length) % visible.focuses.length);
  }

  return (
    <div className="min-h-full bg-[#f4f1e9] text-[#222a25]">
    <section className="mx-auto w-full max-w-[1280px] px-5 py-9 md:px-8 md:py-12 xl:px-10">
      <MyCreativeHeader
        headline={dashboard.headline}
        query={query}
        range={range}
        role={role}
        onQueryChange={(value) => { setQuery(value); setFocusIndex(0); }}
        onRangeChange={(value) => { setRange(value); setFocusIndex(0); }}
        onRoleChange={(value) => { setRole(value); setFocusIndex(0); }}
      />

      <MyProductionProgress
        stages={dashboard.stages}
        selectedStage={stage}
        onSelect={(value) => setStage((current) => current === value ? null : value)}
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_310px] lg:gap-7">
        <MyFocusPanel
          focus={focus}
          total={visible.focuses.length}
          index={focusIndex}
          onPrevious={() => switchFocus(-1)}
          onNext={() => switchFocus(1)}
          onOpenProject={onOpenProject}
        />
        <MyTodayPanel today={dashboard.today} risks={dashboard.risks} aiReminders={dashboard.aiReminders} />
      </div>

      <div className="grid min-w-0 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)] lg:gap-7">
        <MyPendingActions actions={visible.actions} activeStage={stage} onClearStage={() => setStage(null)} onOpenProject={onOpenProject} />
        <MyActivityFeed activities={visible.activities} onOpenProject={onOpenProject} />
      </div>

      <MyRecentTabs
        activeTab={recentTab}
        items={recent}
        onTabChange={setRecentTab}
        onOpenProject={onOpenProject}
      />
    </section>
    </div>
  );
}

function MyCreativeHeader({
  headline,
  query,
  range,
  role,
  onQueryChange,
  onRangeChange,
  onRoleChange,
}: {
  headline: string;
  query: string;
  range: MyCreativeTimeRange;
  role: MyCreativeRole;
  onQueryChange: (value: string) => void;
  onRangeChange: (value: MyCreativeTimeRange) => void;
  onRoleChange: (value: MyCreativeRole) => void;
}) {
  return (
    <header className="relative pb-8">
      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_230px_300px] xl:items-center">
        <div className="max-w-[650px]">
          <p className="m-0 text-xs font-medium tracking-[0.14em] text-[#6f7d74]">MY CREATIVE DESK</p>
          <h2 className="mb-0 mt-3 font-serif text-[44px] font-semibold leading-none tracking-[0.04em] text-[#315c49] md:text-[58px]">我的创作</h2>
          <p className="mb-0 mt-4 text-sm leading-relaxed text-[#6e746f]">{headline}</p>
        </div>
        <div className="relative hidden h-[132px] xl:block" aria-hidden="true">
          <div className="absolute left-6 top-0 h-4 w-20 rotate-[-5deg] bg-[#d8c08b]/70" />
          <div className="absolute left-3 top-3 h-[112px] w-[155px] rotate-[-3deg] bg-[#fcfaf3] p-2 shadow-[0_8px_20px_rgba(65,55,39,0.12)]">
            <div className="relative h-full overflow-hidden bg-[linear-gradient(135deg,#d9dfd2_0%,#f0e7d4_48%,#a9b59d_49%,#c9a878_100%)]">
              <span className="absolute bottom-3 left-3 rounded-sm bg-[#f7f2e5]/90 px-2 py-1 font-serif text-[11px] text-[#315c49]">场景 · 产品 · 光线</span>
            </div>
          </div>
          <div className="absolute bottom-1 right-0 rotate-2 bg-[#eee3c9] px-3 py-2 font-serif text-[12px] leading-relaxed text-[#6f5c43] shadow-sm">make it<br />feel lived-in</div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end xl:self-end">
          <div className="inline-flex w-fit rounded-[10px] bg-[#ebe7dc] p-1" aria-label="时间范围">
            {timeRanges.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "h-8 rounded-[calc(var(--cp-radius-segment)-2px)] px-3 text-xs text-[var(--cp-text-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]",
                  range === item.id && "bg-[#315c49] font-medium text-white shadow-sm",
                )}
                aria-pressed={range === item.id}
                onClick={() => onRangeChange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-[#ddd6c8] bg-[#f9f6ee]/80 px-3 sm:w-[220px]">
              <Search className="size-3.5 shrink-0 text-[var(--cp-text-faint)]" aria-hidden="true" />
              <span className="sr-only">搜索我的创作</span>
              <input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-[var(--cp-text-faint)]"
                placeholder="搜索项目或下一步动作"
              />
            </label>
            <select
              value={role}
              onChange={(event) => onRoleChange(event.target.value as MyCreativeRole)}
              className="h-10 rounded-[10px] border border-[#ddd6c8] bg-[#f9f6ee]/80 px-3 text-xs text-[#686f69] outline-none focus:border-[#9c7651]"
              aria-label="按创作角色筛选"
            >
              {(["全部", "策划", "拍摄", "剪辑", "审核"] as MyCreativeRole[]).map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
        </div>
      </div>
    </header>
  );
}

function MyProductionProgress({
  stages,
  selectedStage,
  onSelect,
}: {
  stages: Array<{ stage: MyCreativeStage; count: number; note: string }>;
  selectedStage: MyCreativeStage | null;
  onSelect: (stage: MyCreativeStage) => void;
}) {
  return (
    <section className="relative overflow-hidden rounded-[10px] bg-[#315c49] px-5 py-6 text-[#f8f4e9] shadow-[0_10px_28px_rgba(52,62,52,0.14)] md:px-7" aria-labelledby="production-progress-title">
      <span className="absolute -left-3 bottom-4 hidden rotate-[-8deg] bg-[#d8c08b] px-4 py-1.5 text-[10px] font-semibold tracking-[0.12em] text-[#5f4b32] shadow-sm lg:block" aria-hidden="true">KEEP CREATING</span>
      <div className="mb-4 flex items-baseline justify-between gap-4 lg:pl-16">
        <h3 id="production-progress-title" className="m-0 text-sm font-semibold">我的制作进度</h3>
        <p className="m-0 text-xs text-[#c8d2cc]">选择环节，聚焦下方待推进内容</p>
      </div>
      <div className="cp-hidden-scrollbar flex overflow-x-auto lg:pl-16" role="group" aria-label="制作阶段筛选">
        {stages.map((item, index) => {
          const active = selectedStage === item.stage;
          return (
            <button
              key={item.stage}
              type="button"
              className={cn(
                "group relative min-w-[158px] flex-1 rounded-[5px] py-3 pr-5 text-left text-[#f8f4e9] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#d8c08b]",
                index > 0 && "pl-5",
                active ? "bg-white/14" : "hover:bg-white/7",
              )}
              aria-pressed={active}
              onClick={() => onSelect(item.stage)}
            >
              <span className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{item.stage}</span>
                <span className="text-2xl font-semibold tracking-[-0.04em]">{item.count}</span>
              </span>
              <span className="mt-2 block text-xs text-[#c8d2cc]">{item.note}</span>
              {index < stages.length - 1 ? <span className="absolute right-0 top-3 h-10 w-px bg-white/16" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MyFocusPanel({ focus, total, index, onPrevious, onNext, onOpenProject }: {
  focus: ReturnType<typeof getMockMyCreativeDashboard>["focuses"][number] | null;
  total: number;
  index: number;
  onPrevious: () => void;
  onNext: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <section className="mt-6 min-w-0" aria-labelledby="today-focus-title">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-5 w-0.5 bg-[#315c49]" aria-hidden="true" />
          <h3 id="today-focus-title" className="m-0 text-sm font-semibold">今日重点</h3>
          {total ? <span className="text-xs text-[var(--cp-text-faint)]">{(index % total) + 1} / {total}</span> : null}
        </div>
        <div className="flex gap-1">
          <button type="button" className="flex size-8 items-center justify-center rounded-full text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={onPrevious} disabled={total < 2} aria-label="上一个今日重点"><ChevronLeft className="size-4" /></button>
          <button type="button" className="flex size-8 items-center justify-center rounded-full text-[var(--cp-text-muted)] hover:bg-[var(--cp-bg-subtle)] disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]" onClick={onNext} disabled={total < 2} aria-label="下一个今日重点"><ChevronRight className="size-4" /></button>
        </div>
      </div>

      {focus ? (
        <article className="relative overflow-hidden rounded-[6px] border border-[#e5ddce] bg-[#fbf8ef] px-6 py-7 shadow-[0_10px_24px_rgba(75,61,43,0.12)] sm:px-8 sm:py-8">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-[#9c7651]" aria-hidden="true" />
          <span className="absolute right-7 top-[-7px] h-5 w-24 rotate-2 bg-[#d8c08b]/55" aria-hidden="true" />
          <Paperclip className="absolute right-5 top-5 size-5 rotate-12 text-[#9c7651]/65" aria-hidden="true" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-[var(--cp-text-faint)]">
            <span>{focus.stage}</span><span aria-hidden="true">·</span><span>来自任务：{focus.sourceTask}</span>
          </div>
          <h4 className="mb-0 mt-5 max-w-[700px] pr-7 font-serif text-[23px] font-semibold leading-snug tracking-[0.015em] text-[#315c49] sm:text-[26px] md:text-[30px]">{focus.projectName}</h4>
          <p className="mb-0 mt-2 text-sm text-[var(--cp-text-muted)]">{focus.topic}</p>

          <div className="mt-7 grid gap-6 border-t border-black/6 pt-6 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div>
              <p className="m-0 text-xs font-medium text-[var(--cp-text-faint)]">今天要完成</p>
              <p className="mb-0 mt-2 text-base font-medium leading-relaxed">{focus.todayGoal}</p>
            </div>
            <div>
              <p className="m-0 text-xs font-medium text-[var(--cp-text-faint)]">截止时间</p>
              <p className="mb-0 mt-2 flex items-center gap-2 text-sm"><Clock3 className="size-3.5 text-[var(--cp-text-faint)]" />{focus.deadline}</p>
            </div>
          </div>

          <blockquote className="mb-0 mt-7 border-l border-[var(--cp-border-strong)] pl-4 text-sm leading-7 text-[var(--cp-text-soft)]">{focus.summary}</blockquote>
          <div className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-[var(--cp-text-muted)]">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[#9c7651]" />
            <p className="m-0"><span className="font-medium text-[var(--cp-text-soft)]">AI 提醒：</span>{focus.aiHint}</p>
          </div>
          <div className="mt-7">
            <Button type="button" className="bg-[#315c49] text-white hover:bg-[#294c3d]" onClick={() => onOpenProject(focus.projectId)}>继续创作 <ArrowRight className="size-4" /></Button>
          </div>
        </article>
      ) : (
        <div className="min-h-[320px] rounded-[6px] bg-[#fbf8ef] px-7 py-10 shadow-[0_10px_24px_rgba(75,61,43,0.1)]">
          <p className="m-0 text-sm font-medium">当前筛选下没有今日重点</p>
          <p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">调整角色、时间或搜索关键词后再查看。</p>
        </div>
      )}
    </section>
  );
}

function MyTodayPanel({ today, risks, aiReminders }: { today: Array<{ label: string; value: number }>; risks: string[]; aiReminders: string[] }) {
  return (
    <aside className="relative mt-6 self-start rounded-[6px] border border-[#e5ddce] bg-[#f9f5ea] px-6 py-6 shadow-[0_9px_22px_rgba(75,61,43,0.11)]" aria-label="我的今天和提醒">
      <span className="absolute -right-2 -top-2 h-10 w-10 rotate-6 border-r-2 border-t-2 border-[#d8c08b]/70" aria-hidden="true" />
      <h3 className="m-0 flex items-center gap-2 text-base font-semibold text-[#315c49]"><span className="size-2 rounded-full bg-[#d86643]" />我的今天</h3>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5">
        {today.map((item) => <div key={item.label}><dt className="text-xs text-[var(--cp-text-faint)]">{item.label}</dt><dd className="mb-0 ml-0 mt-1 text-xl font-semibold">{item.value}</dd></div>)}
      </dl>
      <div className="mt-7 border-t border-[#ddd5c7] pt-6">
        <h4 className="m-0 flex items-center gap-2 text-xs font-semibold"><CircleAlert className="size-3.5 text-[var(--cp-warning)]" />风险提醒</h4>
        <ul className="mb-0 mt-4 space-y-3 pl-4 text-xs leading-relaxed text-[var(--cp-text-muted)] marker:text-[var(--cp-border-strong)]">
          {risks.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
      <div className="mt-6 border-t border-[#ddd5c7] pt-6">
        <h4 className="m-0 flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-3.5 text-[#9c7651]" />AI 提醒</h4>
        <ul className="mb-0 mt-4 space-y-3 pl-4 text-xs leading-relaxed text-[var(--cp-text-muted)] marker:text-[var(--cp-border-strong)]">
          {aiReminders.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </div>
    </aside>
  );
}

function MyPendingActions({ actions, activeStage, onClearStage, onOpenProject }: {
  actions: MyCreativeAction[];
  activeStage: MyCreativeStage | null;
  onClearStage: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const groups = (["今天", "明天", "之后"] as const).map((label) => ({ label, items: actions.filter((item) => item.group === label) })).filter((group) => group.items.length);
  return (
    <section className="relative mt-7 min-w-0 rounded-[5px] bg-[#faf6ec] px-5 py-6 shadow-[0_7px_18px_rgba(75,61,43,0.09)] sm:px-6" aria-labelledby="pending-actions-title">
      <span className="absolute right-10 top-[-6px] h-4 w-24 rotate-3 bg-[#d86643]/60" aria-hidden="true" />
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-3"><h3 id="pending-actions-title" className="m-0 text-base font-semibold">待我推进</h3>{activeStage ? <button type="button" className="text-xs text-[var(--cp-text-muted)] underline underline-offset-4" onClick={onClearStage}>{activeStage} · 清除筛选</button> : null}</div>
        <span className="text-xs text-[var(--cp-text-faint)]">按下一步动作排序</span>
      </div>
      <div className="mt-5 border-t border-[#dfd7c9]">
        {groups.map((group) => (
          <div key={group.label} className="grid grid-cols-[minmax(0,1fr)] border-b border-[#e4ddcf] sm:grid-cols-[78px_minmax(0,1fr)]">
            <p className="m-0 py-5 text-xs font-medium text-[var(--cp-text-faint)]">{group.label}</p>
            <div>
              {group.items.map((action) => (
                <button key={action.id} type="button" className="group flex min-w-0 w-full items-start gap-3 border-b border-[#e4ddcf] py-4 text-left transition-transform duration-200 last:border-b-0 hover:-translate-y-px hover:bg-[#f5efe2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#9c7651] sm:gap-5" onClick={() => onOpenProject(action.projectId)}>
                  <span className="min-w-0 flex-1"><span className="block text-sm font-medium group-hover:underline">{action.title}</span><span className="mt-1.5 block truncate text-xs text-[var(--cp-text-faint)]">{action.projectName} · {action.stage} · {action.status}</span></span>
                  <span className="shrink-0 pt-0.5 text-xs text-[var(--cp-text-muted)]">{action.schedule}</span>
                  <ArrowRight className="mt-0.5 size-4 shrink-0 text-[var(--cp-text-faint)] transition-transform group-hover:translate-x-0.5" />
                </button>
              ))}
            </div>
          </div>
        ))}
        {!actions.length ? <div className="py-10"><p className="m-0 text-sm font-medium">当前筛选下没有待推进内容</p><p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">清除阶段筛选或切换时间范围后再查看。</p></div> : null}
      </div>
    </section>
  );
}

function MyActivityFeed({ activities, onOpenProject }: {
  activities: ReturnType<typeof getMockMyCreativeDashboard>["activities"];
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <section className="relative mt-7 min-w-0 self-start rounded-[5px] border border-[#e5ddce] bg-[#f9f5ea] px-5 py-6 shadow-[0_8px_20px_rgba(75,61,43,0.1)]" aria-labelledby="activity-feed-title">
      <span className="absolute right-5 top-[-8px] rotate-2 bg-[#d8c08b] px-3 py-1 text-[9px] font-semibold tracking-[0.12em] text-[#695537]" aria-hidden="true">UPDATES</span>
      <h3 id="activity-feed-title" className="m-0 flex items-center gap-2 text-base font-semibold text-[#315c49]"><span className="size-2 rounded-full bg-[#d86643]" />与我有关的动态</h3>
      <div className="mt-5 border-t border-[#ddd5c7]">
        {activities.map((item) => (
          <button key={item.id} type="button" className="group flex w-full gap-3 border-b border-[#e1d9cb] py-4 text-left transition-colors hover:bg-[#f4edde] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#9c7651]" onClick={() => onOpenProject(item.projectId)}>
            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#d86643]" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-xs leading-relaxed"><span className="font-medium text-[var(--cp-text)]">{item.actor}</span> <span className="text-[var(--cp-text-muted)]">{item.verb}</span><span className="mt-0.5 block font-medium group-hover:underline">{item.target}</span>{item.detail ? <span className="mt-1 block text-[var(--cp-text-faint)]">{item.detail}</span> : null}</span>
            <span className="shrink-0 text-[11px] text-[var(--cp-text-faint)]">{item.time}</span>
          </button>
        ))}
        {!activities.length ? <p className="mb-0 py-8 text-xs text-[var(--cp-text-faint)]">当前筛选下没有新的协作动态。</p> : null}
      </div>
    </section>
  );
}

function MyRecentTabs({ activeTab, items, onTabChange, onOpenProject }: {
  activeTab: MyCreativeRecentTab;
  items: ReturnType<typeof getMockMyCreativeDashboard>["recent"];
  onTabChange: (tab: MyCreativeRecentTab) => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <section className="py-10" aria-labelledby="recent-content-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 id="recent-content-title" className="m-0 flex items-center gap-3 font-serif text-xl font-semibold text-[#315c49]"><span className="size-2 rounded-full bg-[#d86643]" />创作承接</h3>
        <div className="cp-hidden-scrollbar flex gap-5 overflow-x-auto border-b border-[var(--cp-border-subtle)]" role="tablist" aria-label="最近内容类型">
          {recentTabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={cn("relative h-9 shrink-0 text-xs text-[var(--cp-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cp-focus)]", activeTab === tab && "font-medium text-[var(--cp-text)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-[var(--cp-text)]")} onClick={() => onTabChange(tab)}>{tab}</button>)}
        </div>
      </div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <button key={item.id} type="button" className="group grid min-w-0 grid-cols-[64px_minmax(0,1fr)] gap-4 rounded-[4px] bg-[#faf6ec] p-3 text-left shadow-[0_5px_14px_rgba(75,61,43,0.08)] transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9c7651]" onClick={() => onOpenProject(item.projectId)}>
            <span className="flex h-16 items-center justify-center overflow-hidden bg-[linear-gradient(145deg,#dce3d7,#c8b99b)] text-[#315c49]" aria-hidden="true"><Leaf className="size-6 opacity-70" /></span>
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3"><span className="min-w-0"><span className="block truncate text-sm font-medium group-hover:underline">{item.title}</span><span className="mt-1.5 block truncate text-xs text-[var(--cp-text-faint)]">{item.projectName}</span></span>
            <span className="text-right"><span className="block text-xs text-[var(--cp-text-muted)]">{item.kind}</span><span className="mt-1.5 block text-[11px] text-[var(--cp-text-faint)]">{item.meta}</span></span>
            </span>
          </button>
        ))}
        {!items.length ? <div className="py-10"><p className="m-0 text-sm font-medium">这里还没有内容</p><p className="mb-0 mt-2 text-xs text-[var(--cp-text-faint)]">调整角色或时间范围后再查看。</p></div> : null}
      </div>
    </section>
  );
}
