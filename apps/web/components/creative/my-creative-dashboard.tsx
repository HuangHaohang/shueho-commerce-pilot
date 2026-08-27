"use client";

import {
  Archive,
  ArrowRight,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox,
  Layers3,
  Link2,
  Pin,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { CreativeProject } from "@/lib/creative/creative-space-adapter";
import {
  filterMyCreativeDashboard,
  getMockMyCreativeDashboard,
  type MyCreativeAction,
  type MyCreativeFocus,
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
      <section className="mx-auto w-full max-w-[1500px] px-5 py-6 md:px-7 md:py-8 xl:px-8">
        <MyCreativeHeader
          headline={dashboard.headline}
          query={query}
          range={range}
          role={role}
          onQueryChange={(value) => { setQuery(value); setFocusIndex(0); }}
          onRangeChange={(value) => { setRange(value); setFocusIndex(0); }}
          onRoleChange={(value) => { setRole(value); setFocusIndex(0); }}
        />

        <CreativeSummaryStrip summaries={dashboard.summaries} />

        <div className="mt-5 grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0">
            <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[250px_minmax(0,1fr)]">
              <div className="order-2 min-w-0 xl:order-1">
                <MyCreativeQueue actions={visible.actions} stages={dashboard.stages} selectedStage={stage} onSelectStage={setStage} onOpenProject={onOpenProject} />
              </div>

              <div className="order-1 min-w-0 xl:order-2">
                <MyFocusWorkspace
                  focus={focus}
                  total={visible.focuses.length}
                  index={focusIndex}
                  stages={dashboard.stages}
                  selectedStage={stage}
                  onSelectStage={setStage}
                  onPrevious={() => switchFocus(-1)}
                  onNext={() => switchFocus(1)}
                  onOpenProject={onOpenProject}
                />
              </div>
            </div>

            <MyRecentTabs activeTab={recentTab} items={recent} onTabChange={setRecentTab} onOpenProject={onOpenProject} />
          </div>

          <div className="min-w-0 space-y-5">
            <SmartDetailPanel focus={focus} onOpenProject={onOpenProject} />
            <MyTodayPanel today={dashboard.today} risks={dashboard.risks} aiReminders={dashboard.aiReminders} />
            <MyActivityFeed activities={visible.activities} onOpenProject={onOpenProject} />
          </div>
        </div>
      </section>
    </div>
  );
}

function MyCreativeHeader({ headline, query, range, role, onQueryChange, onRangeChange, onRoleChange }: {
  headline: string;
  query: string;
  range: MyCreativeTimeRange;
  role: MyCreativeRole;
  onQueryChange: (value: string) => void;
  onRangeChange: (value: MyCreativeTimeRange) => void;
  onRoleChange: (value: MyCreativeRole) => void;
}) {
  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="m-0 text-[11px] font-medium tracking-[0.14em] text-[#718078]">MY CREATIVE DESK</p>
        <h2 className="mb-0 mt-2 font-serif text-[34px] font-semibold leading-none tracking-[0.04em] text-[#315c49] md:text-[40px]">我的创作</h2>
        <p className="mb-0 mt-3 text-xs text-[#6e746f]">{headline}</p>
      </div>
      <div className="flex flex-col gap-3 sm:items-end">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex h-10 min-w-0 items-center gap-2 rounded-[10px] border border-[#ddd6c8] bg-[#faf7ef] px-3 sm:w-[270px]">
            <Search className="size-3.5 shrink-0 text-[#8d948f]" aria-hidden="true" />
            <span className="sr-only">搜索我的创作</span>
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} className="min-w-0 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-[#9ca19d]" placeholder="搜索项目或下一步动作" />
          </label>
          <select value={role} onChange={(event) => onRoleChange(event.target.value as MyCreativeRole)} className="h-10 rounded-[10px] border border-[#ddd6c8] bg-[#faf7ef] px-3 text-xs text-[#686f69] outline-none focus:border-[#9c7651]" aria-label="按创作角色筛选">
            {(["全部", "策划", "拍摄", "剪辑", "审核"] as MyCreativeRole[]).map((item) => <option key={item}>{item}</option>)}
          </select>
          <div className="inline-flex w-fit rounded-[10px] bg-[#e9e5da] p-1" aria-label="时间范围">
            {timeRanges.map((item) => <button key={item.id} type="button" className={cn("h-8 rounded-[8px] px-3 text-xs text-[#717871] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9c7651]", range === item.id && "bg-[#315c49] font-medium text-white shadow-sm")} aria-pressed={range === item.id} onClick={() => onRangeChange(item.id)}>{item.label}</button>)}
          </div>
        </div>
      </div>
    </header>
  );
}

function CreativeSummaryStrip({ summaries }: { summaries: ReturnType<typeof getMockMyCreativeDashboard>["summaries"] }) {
  const icons = { active: CalendarCheck2, pending: Inbox, output: Archive } as const;
  const tones = { active: "bg-[#f9f6ee] text-[#315c49]", pending: "bg-[#eef1e8] text-[#315c49]", output: "bg-[#eee7da] text-[#5f4b3b]" } as const;
  return (
    <section className="mt-6 grid gap-4 md:grid-cols-3" aria-label="我的创作摘要">
      {summaries.map((item) => {
        const Icon = icons[item.id];
        return (
          <article key={item.id} className={cn("relative min-h-[128px] overflow-hidden rounded-[10px] border border-[#e1dacd] px-5 py-4 shadow-[0_6px_16px_rgba(69,58,43,0.07)]", tones[item.id])}>
            <Icon className="absolute right-5 top-5 size-6 opacity-25" strokeWidth={1.5} aria-hidden="true" />
            <p className="m-0 text-[10px] font-semibold tracking-[0.08em] opacity-65">{item.eyebrow}</p>
            <p className="mb-0 mt-3 text-sm font-semibold">{item.label}</p>
            <p className="mb-0 mt-1 flex items-baseline gap-2"><span className="text-[30px] font-semibold leading-none tracking-[-0.04em]">{item.value}</span><span className="text-xs opacity-70">{item.unit}</span></p>
            <p className="mb-0 mt-2 text-[11px] opacity-65">{item.note}</p>
          </article>
        );
      })}
    </section>
  );
}

function MyCreativeQueue({ actions, stages, selectedStage, onSelectStage, onOpenProject }: {
  actions: MyCreativeAction[];
  stages: Array<{ stage: MyCreativeStage; count: number; note: string }>;
  selectedStage: MyCreativeStage | null;
  onSelectStage: (stage: MyCreativeStage | null) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const groups = (["今天", "明天", "之后"] as const).map((label) => ({ label, items: actions.filter((item) => item.group === label) })).filter((group) => group.items.length);
  return (
    <aside className="rounded-[8px] border border-[#e1dacd] bg-[#faf7ef] shadow-[0_6px_18px_rgba(69,58,43,0.08)]" aria-labelledby="creative-queue-title">
      <div className="px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-3"><h3 id="creative-queue-title" className="m-0 font-serif text-lg font-semibold text-[#315c49]">创作队列</h3><span className="text-[11px] text-[#8a908b]">{actions.length} 件</span></div>
        <div className="cp-hidden-scrollbar mt-3 flex gap-1 overflow-x-auto" aria-label="制作环节筛选">
          <button type="button" className={cn("shrink-0 rounded-[7px] px-2.5 py-1.5 text-[11px]", !selectedStage ? "bg-[#315c49] text-white" : "text-[#737a74] hover:bg-[#efebe1]")} onClick={() => onSelectStage(null)}>全部</button>
          {stages.map((item) => <button key={item.stage} type="button" className={cn("shrink-0 rounded-[7px] px-2.5 py-1.5 text-[11px]", selectedStage === item.stage ? "bg-[#315c49] text-white" : "text-[#737a74] hover:bg-[#efebe1]")} aria-pressed={selectedStage === item.stage} onClick={() => onSelectStage(selectedStage === item.stage ? null : item.stage)}>{item.stage} {item.count}</button>)}
        </div>
      </div>
      <div className="border-t border-[#e3dccf]">
        {groups.map((group) => <section key={group.label}><p className="m-0 flex items-center gap-2 border-b border-[#e7e0d4] px-4 py-2 text-[11px] font-medium text-[#737b75]"><span className={cn("size-1.5 rounded-full", group.label === "今天" ? "bg-[#315c49]" : "bg-[#a8afa9]")} />{group.label}</p>{group.items.map((action) => <button key={action.id} type="button" className="group block w-full border-b border-[#e7e0d4] px-4 py-3 text-left transition-colors hover:bg-[#f2ede2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#9c7651]" onClick={() => onOpenProject(action.projectId)}><span className="block text-xs font-medium leading-relaxed group-hover:text-[#315c49]">{action.title}</span><span className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[#8d938e]"><span className="min-w-0 truncate">{action.stage} · {action.status}</span><span className="shrink-0">{action.schedule}</span></span></button>)}</section>)}
        {!actions.length ? <div className="px-4 py-8"><p className="m-0 text-xs font-medium">当前筛选下没有待推进内容</p><p className="mb-0 mt-2 text-[11px] text-[#8d938e]">调整时间、角色或环节后再查看。</p></div> : null}
      </div>
    </aside>
  );
}

function MyFocusWorkspace({ focus, total, index, stages, selectedStage, onSelectStage, onPrevious, onNext, onOpenProject }: {
  focus: MyCreativeFocus | null;
  total: number;
  index: number;
  stages: Array<{ stage: MyCreativeStage; count: number; note: string }>;
  selectedStage: MyCreativeStage | null;
  onSelectStage: (stage: MyCreativeStage | null) => void;
  onPrevious: () => void;
  onNext: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-[9px] border border-[#dfd7c9] bg-[#fbf8ef] shadow-[0_8px_22px_rgba(69,58,43,0.09)]" aria-labelledby="today-focus-title">
      <header className="flex items-center justify-between border-b border-[#e4ddcf] px-5 py-4">
        <div className="flex items-center gap-3"><h3 id="today-focus-title" className="m-0 font-serif text-lg font-semibold text-[#315c49]">今日重点</h3>{total ? <span className="text-[11px] text-[#8b918c]">{(index % total) + 1} / {total}</span> : null}</div>
        <div className="flex gap-1"><button type="button" className="flex size-7 items-center justify-center rounded-full text-[#6f776f] hover:bg-[#eee9dd] disabled:opacity-30" onClick={onPrevious} disabled={total < 2} aria-label="上一个今日重点"><ChevronLeft className="size-4" /></button><button type="button" className="flex size-7 items-center justify-center rounded-full text-[#6f776f] hover:bg-[#eee9dd] disabled:opacity-30" onClick={onNext} disabled={total < 2} aria-label="下一个今日重点"><ChevronRight className="size-4" /></button></div>
      </header>
      {focus ? (
        <article>
          <div className="px-5 py-6 sm:px-7">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-[#868d87]"><span>{focus.stage}</span><span aria-hidden="true">·</span><span>来源任务：{focus.sourceTask}</span></div>
            <h4 className="mb-0 mt-3 font-serif text-[25px] font-semibold leading-snug tracking-[0.01em] text-[#315c49] md:text-[30px]">{focus.projectName}</h4>
            <p className="mb-0 mt-2 text-xs text-[#727972]">{focus.topic}</p>
            <div className="mt-6 grid gap-4 border-y border-[#e5ded1] py-5 sm:grid-cols-[minmax(0,1fr)_150px]"><div><p className="m-0 text-[11px] text-[#8a918b]">今天要完成</p><p className="mb-0 mt-2 text-sm font-medium leading-relaxed">{focus.todayGoal}</p></div><div><p className="m-0 text-[11px] text-[#8a918b]">截止时间</p><p className="mb-0 mt-2 flex items-center gap-2 text-xs"><Clock3 className="size-3.5 text-[#9c7651]" />{focus.deadline}</p></div></div>
            <blockquote className="mb-0 mt-5 border-l-2 border-[#9c7651] pl-4 text-xs leading-6 text-[#4f5751]">{focus.summary}</blockquote>
            <div className="mt-6">
              <div className="mb-3 flex items-center justify-between"><p className="m-0 text-[11px] font-medium text-[#747c76]">我所在的制作环节</p><span className="text-[10px] text-[#969c97]">点击筛选左侧队列</span></div>
              <div className="cp-hidden-scrollbar flex gap-2 overflow-x-auto pb-1">{stages.map((item) => { const current = item.stage === focus.stage; const active = selectedStage === item.stage; return <button key={item.stage} type="button" className={cn("min-w-[100px] flex-1 rounded-[7px] border px-3 py-3 text-left transition-colors", current ? "border-[#315c49] bg-[#315c49] text-white" : active ? "border-[#9c7651] bg-[#f0e8d9]" : "border-[#e0d8ca] bg-[#f7f2e8] hover:bg-[#efe9dd]")} aria-pressed={active} onClick={() => onSelectStage(active ? null : item.stage)}><span className="block text-[11px] opacity-75">{item.stage}</span><span className="mt-2 block text-xl font-semibold">{item.count}</span><span className="mt-1 block truncate text-[9px] opacity-65">{item.note}</span></button>; })}</div>
            </div>
          </div>
          <footer className="flex flex-col gap-3 border-t border-[#e2dbce] bg-[#f7f2e8] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7"><div><p className="m-0 text-[10px] text-[#8a918b]">下一步动作</p><p className="mb-0 mt-1 text-xs font-medium">{focus.nextStep}</p></div><Button type="button" className="bg-[#315c49] text-white hover:bg-[#294c3d]" onClick={() => onOpenProject(focus.projectId)}>继续创作 <ArrowRight className="size-4" /></Button></footer>
        </article>
      ) : <div className="min-h-[420px] px-7 py-10"><p className="m-0 text-sm font-medium">当前筛选下没有今日重点</p><p className="mb-0 mt-2 text-xs text-[#8b918c]">调整角色、时间或搜索关键词后再查看。</p></div>}
    </section>
  );
}

function SmartDetailPanel({ focus, onOpenProject }: { focus: MyCreativeFocus | null; onOpenProject: (projectId: string) => void }) {
  return (
    <aside className="relative rounded-[8px] border border-[#dfd7c9] bg-[#faf7ef] p-5 shadow-[0_7px_20px_rgba(69,58,43,0.09)]" aria-label="智能详情">
      <Pin className="absolute right-4 top-4 size-4 rotate-12 text-[#7e867f]" aria-hidden="true" />
      <h3 className="m-0 flex items-center gap-2 font-serif text-lg font-semibold text-[#315c49]"><Sparkles className="size-4 text-[#9c7651]" />智能详情</h3>
      {focus ? <><p className="mb-0 mt-5 text-[10px] text-[#8c928d]">当前重点</p><p className="mb-0 mt-1 pr-5 text-sm font-semibold leading-relaxed">{focus.projectName}</p><dl className="mt-5 space-y-3 border-y border-[#e2dbce] py-4 text-[11px]"><DetailLine icon={Layers3} term="当前内容" detail={focus.versionLabel} /><DetailLine icon={UserRound} term="负责人" detail={focus.owner} /><DetailLine icon={Link2} term="来源任务" detail={focus.sourceTask} /><DetailLine icon={CalendarCheck2} term="截止时间" detail={focus.deadline} /><DetailLine icon={Archive} term="发布平台" detail={focus.platforms.join("、")} /></dl><div className="mt-4 rounded-[7px] bg-[#f0eadf] p-4"><p className="m-0 flex items-center gap-2 text-[11px] font-semibold"><Sparkles className="size-3.5 text-[#9c7651]" />AI 助手建议</p><p className="mb-0 mt-2 text-[11px] leading-5 text-[#626a63]">{focus.aiHint}</p></div><button type="button" className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-[#315c49] hover:underline" onClick={() => onOpenProject(focus.projectId)}>查看项目上下文 <ArrowRight className="size-3.5" /></button></> : <p className="mb-0 mt-5 text-xs text-[#8b918c]">选择一条今日重点后查看相关上下文。</p>}
    </aside>
  );
}

function DetailLine({ icon: Icon, term, detail }: { icon: typeof Layers3; term: string; detail: string }) {
  return <div className="grid grid-cols-[16px_58px_minmax(0,1fr)] items-start gap-2"><Icon className="mt-0.5 size-3.5 text-[#8d948e]" /><dt className="text-[#8d948e]">{term}</dt><dd className="m-0 min-w-0 text-[#454d47]">{detail}</dd></div>;
}

function MyTodayPanel({ today, risks, aiReminders }: { today: Array<{ label: string; value: number }>; risks: string[]; aiReminders: string[] }) {
  return (
    <aside className="rounded-[8px] border border-[#dfd7c9] bg-[#faf7ef] p-5 shadow-[0_7px_20px_rgba(69,58,43,0.08)]" aria-label="我的今天和提醒">
      <h3 className="m-0 flex items-center gap-2 font-serif text-lg font-semibold text-[#315c49]"><span className="size-2 rounded-full bg-[#d86643]" />我的今天</h3>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">{today.map((item) => <div key={item.label}><dt className="text-[10px] text-[#8b918c]">{item.label}</dt><dd className="mb-0 ml-0 mt-1 text-xl font-semibold">{item.value}</dd></div>)}</dl>
      <div className="mt-5 border-t border-[#e2dbce] pt-4"><h4 className="m-0 flex items-center gap-2 text-[11px] font-semibold"><CircleAlert className="size-3.5 text-[#d86643]" />风险提醒</h4><ul className="mb-0 mt-3 space-y-2 pl-4 text-[11px] leading-5 text-[#626a63] marker:text-[#d86643]">{risks.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="mt-4 border-t border-[#e2dbce] pt-4"><h4 className="m-0 flex items-center gap-2 text-[11px] font-semibold"><Sparkles className="size-3.5 text-[#9c7651]" />AI 建议</h4><ul className="mb-0 mt-3 space-y-2 pl-4 text-[11px] leading-5 text-[#626a63] marker:text-[#9c7651]">{aiReminders.map((item) => <li key={item}>{item}</li>)}</ul></div>
    </aside>
  );
}

function MyActivityFeed({ activities, onOpenProject }: { activities: ReturnType<typeof getMockMyCreativeDashboard>["activities"]; onOpenProject: (projectId: string) => void }) {
  return (
    <section className="rounded-[8px] border border-[#dfd7c9] bg-[#faf7ef] p-5 shadow-[0_7px_20px_rgba(69,58,43,0.08)]" aria-labelledby="activity-feed-title">
      <div className="flex items-center justify-between"><h3 id="activity-feed-title" className="m-0 font-serif text-lg font-semibold text-[#315c49]">与我有关的动态</h3><span className="text-[10px] text-[#8b918c]">最近</span></div>
      <div className="mt-4 border-t border-[#e2dbce]">{activities.slice(0, 4).map((item) => <button key={item.id} type="button" className="group flex w-full gap-2.5 border-b border-[#e5ded2] py-3 text-left hover:bg-[#f3eee4]" onClick={() => onOpenProject(item.projectId)}><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#d86643]" /><span className="min-w-0 flex-1 text-[11px] leading-5"><span className="font-medium">{item.actor}</span> {item.verb}<span className="block truncate font-medium group-hover:text-[#315c49]">{item.target}</span></span><span className="shrink-0 text-[9px] text-[#969c97]">{item.time}</span></button>)}</div>
    </section>
  );
}

function MyRecentTabs({ activeTab, items, onTabChange, onOpenProject }: { activeTab: MyCreativeRecentTab; items: ReturnType<typeof getMockMyCreativeDashboard>["recent"]; onTabChange: (tab: MyCreativeRecentTab) => void; onOpenProject: (projectId: string) => void }) {
  return (
    <section className="mt-5 rounded-[9px] border border-[#dfd7c9] bg-[#faf7ef] px-5 py-5 shadow-[0_7px_20px_rgba(69,58,43,0.08)]" aria-labelledby="recent-content-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h3 id="recent-content-title" className="m-0 flex items-center gap-2 font-serif text-lg font-semibold text-[#315c49]"><span className="size-2 rounded-full bg-[#d86643]" />创作承接</h3><div className="cp-hidden-scrollbar flex gap-5 overflow-x-auto border-b border-[#e0d9cc]" role="tablist" aria-label="最近内容类型">{recentTabs.map((tab) => <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} className={cn("relative h-8 shrink-0 text-[11px] text-[#747b75]", activeTab === tab && "font-medium text-[#315c49] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-[#315c49]")} onClick={() => onTabChange(tab)}>{tab}</button>)}</div></div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{items.map((item) => <button key={item.id} type="button" className="group min-w-0 rounded-[7px] border border-[#e3dccf] bg-[#f7f2e8] p-4 text-left transition-transform duration-200 hover:-translate-y-px hover:bg-[#f1ebdf] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9c7651]" onClick={() => onOpenProject(item.projectId)}><span className="flex items-center justify-between gap-3"><span className="text-[10px] text-[#8d938e]">{item.kind}</span><ArrowRight className="size-3.5 text-[#9da29e] transition-transform group-hover:translate-x-0.5" /></span><span className="mt-3 block truncate text-xs font-semibold group-hover:text-[#315c49]">{item.title}</span><span className="mt-1.5 block truncate text-[10px] text-[#8d938e]">{item.projectName}</span><span className="mt-3 block text-[10px] text-[#737a74]">{item.meta}</span></button>)}</div>
      {!items.length ? <div className="py-8"><p className="m-0 text-xs font-medium">这里还没有内容</p><p className="mb-0 mt-2 text-[11px] text-[#8d938e]">调整角色或时间范围后再查看。</p></div> : null}
    </section>
  );
}
