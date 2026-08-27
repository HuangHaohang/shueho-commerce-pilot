import type { CreativeProject } from "./creative-space-adapter";

export const myCreativeStages = ["策划", "拍摄", "剪辑", "审核", "待发布"] as const;
export type MyCreativeStage = (typeof myCreativeStages)[number];
export type MyCreativeRole = "全部" | "策划" | "拍摄" | "剪辑" | "审核";
export type MyCreativeTimeRange = "today" | "week" | "7days";
export type MyCreativeRecentTab = "最近创作" | "最近产出" | "即将开始";

type RangeVisibility = MyCreativeTimeRange[];

export type MyCreativeFocus = {
  id: string;
  projectId: string;
  projectName: string;
  topic: string;
  stage: MyCreativeStage;
  role: Exclude<MyCreativeRole, "全部">;
  todayGoal: string;
  deadline: string;
  summary: string;
  aiHint: string;
  sourceTask: string;
  owner: string;
  platforms: string[];
  versionLabel: string;
  nextStep: string;
  ranges: RangeVisibility;
};

export type MyCreativeAction = {
  id: string;
  projectId: string;
  title: string;
  projectName: string;
  stage: MyCreativeStage;
  role: Exclude<MyCreativeRole, "全部">;
  schedule: string;
  group: "今天" | "明天" | "之后";
  status: string;
  priority: number;
  ranges: RangeVisibility;
};

export type MyCreativeActivity = {
  id: string;
  projectId: string;
  actor: string;
  verb: string;
  target: string;
  detail?: string;
  time: string;
  ranges: RangeVisibility;
};

export type MyCreativeRecentItem = {
  id: string;
  projectId: string;
  title: string;
  projectName: string;
  kind: string;
  meta: string;
  tab: MyCreativeRecentTab;
  role: Exclude<MyCreativeRole, "全部">;
  ranges: RangeVisibility;
};

export type MyCreativeDashboard = {
  currentUser: { id: string; name: string; primaryRole: Exclude<MyCreativeRole, "全部"> };
  headline: string;
  summaries: Array<{
    id: "active" | "pending" | "output";
    eyebrow: string;
    label: string;
    value: number;
    unit: string;
    note: string;
  }>;
  stages: Array<{ stage: MyCreativeStage; count: number; note: string }>;
  focuses: MyCreativeFocus[];
  actions: MyCreativeAction[];
  activities: MyCreativeActivity[];
  recent: MyCreativeRecentItem[];
  today: Array<{ label: string; value: number }>;
  risks: string[];
  aiReminders: string[];
};

const allRanges: RangeVisibility = ["today", "week", "7days"];
const weekRanges: RangeVisibility = ["week", "7days"];

function projectName(projects: CreativeProject[], projectId: string, fallback: string) {
  return projects.find((project) => project.id === projectId)?.name ?? fallback;
}

/**
 * Phase-two read boundary. Task facts are mocked here until the short-video task
 * BFF is available; project names are resolved from the Creative Space adapter.
 */
export function getMockMyCreativeDashboard(
  projects: CreativeProject[],
  primaryRole: Exclude<MyCreativeRole, "全部"> = "策划",
): MyCreativeDashboard {
  const oilPot = projectName(projects, "project-oil-pot-no-straw", "垂直喷油壶｜为什么没有吸管");
  const miniKnife = projectName(projects, "project-mini-knife-pov-fruit", "小王子迷你刀｜第一视角水果使用场景");
  const lunchBag = projectName(projects, "project-lunch-bag-commute", "轻量保温午餐包｜通勤不显笨重");

  const actions: MyCreativeAction[] = [
    { id: "action-oil-script", projectId: "project-oil-pot-no-straw", title: "根据审核意见修改脚本开头", projectName: oilPot, stage: "策划", role: "策划", schedule: "今天 14:00", group: "今天", status: "审核后修改", priority: 100, ranges: allRanges },
    { id: "action-knife-shoot", projectId: "project-mini-knife-pov-fruit", title: "确认办公室场景与拍摄道具", projectName: miniKnife, stage: "拍摄", role: "拍摄", schedule: "今天 16:00", group: "今天", status: "拍摄前确认", priority: 92, ranges: allRanges },
    { id: "action-knife-review", projectId: "project-mini-knife-pov-fruit", title: "确认初剪 V2 的节奏调整", projectName: miniKnife, stage: "审核", role: "审核", schedule: "今天 18:00", group: "今天", status: "等待确认", priority: 88, ranges: allRanges },
    { id: "action-lunch-topic", projectId: "project-lunch-bag-commute", title: "收敛通勤场景的核心问题", projectName: lunchBag, stage: "策划", role: "策划", schedule: "明天 11:00", group: "明天", status: "待完善选题", priority: 76, ranges: weekRanges },
    { id: "action-oil-edit", projectId: "project-oil-pot-no-straw", title: "接收素材并建立初剪结构", projectName: oilPot, stage: "剪辑", role: "剪辑", schedule: "周五", group: "之后", status: "等待素材", priority: 64, ranges: weekRanges },
    { id: "action-knife-export", projectId: "project-mini-knife-pov-fruit", title: "准备三平台交付版本", projectName: miniKnife, stage: "待发布", role: "剪辑", schedule: "本周五", group: "之后", status: "制作完成后处理", priority: 58, ranges: weekRanges },
  ];

  const roleWeight: Record<Exclude<MyCreativeRole, "全部">, MyCreativeStage[]> = {
    策划: ["策划", "审核", "拍摄", "剪辑", "待发布"],
    拍摄: ["拍摄", "策划", "剪辑", "审核", "待发布"],
    剪辑: ["剪辑", "待发布", "审核", "拍摄", "策划"],
    审核: ["审核", "策划", "剪辑", "待发布", "拍摄"],
  };
  actions.sort((a, b) => {
    const roleDelta = roleWeight[primaryRole].indexOf(a.stage) - roleWeight[primaryRole].indexOf(b.stage);
    return roleDelta || b.priority - a.priority;
  });

  return {
    currentUser: { id: "member-wang", name: "王策", primaryRole },
    headline: "今天有 3 件内容需要你推进，1 条视频等待审核",
    summaries: [
      { id: "active", eyebrow: "ACTIVE / 正在参与", label: "制作中的内容", value: 12, unit: "条", note: "分布在 5 个制作环节" },
      { id: "pending", eyebrow: "INBOX / 等我处理", label: "待我推进", value: 6, unit: "件", note: "其中 3 件需要今天完成" },
      { id: "output", eyebrow: "OUTPUT / 本周产出", label: "已形成成果", value: 8, unit: "份", note: "新增 2 个可交付版本" },
    ],
    stages: [
      { stage: "策划", count: 4, note: "2 条待完善脚本" },
      { stage: "拍摄", count: 2, note: "1 条今天拍摄" },
      { stage: "剪辑", count: 3, note: "2 条待提交初剪" },
      { stage: "审核", count: 1, note: "等待你确认" },
      { stage: "待发布", count: 2, note: "制作完成待交付" },
    ],
    focuses: [
      { id: "focus-oil-pot", projectId: "project-oil-pot-no-straw", projectName: oilPot, topic: "从真实使用疑问进入产品结构差异", stage: "策划", role: "策划", todayGoal: "根据审核意见修改开头，让产品差异更早出现", deadline: "今天 16:00", summary: "“为什么这只喷油壶没有吸管？”先让反常识的问题成立，再用一次倒油和清洁过程证明结构优势。", aiHint: "问题意识已经清楚，但无吸管带来的清洁优势可以提前到前 3 秒。", sourceTask: "厨房小工具短视频选题周", owner: "王策", platforms: ["抖音", "小红书"], versionLabel: "脚本 V4", nextStep: "完成修改后提交余安复审", ranges: allRanges },
      { id: "focus-mini-knife", projectId: "project-mini-knife-pov-fruit", projectName: miniKnife, topic: "办公室临时切水果的第一视角演示", stage: "拍摄", role: "拍摄", todayGoal: "确认桌面场景、道具和第一组落刀镜头", deadline: "今天 17:30", summary: "镜头从抽屉里拿出迷你刀开始，不解释尺寸，先用动作让便携和顺手变得可见。", aiHint: "第一镜保留手部动作即可，桌面杂物过多会削弱产品尺寸感。", sourceTask: "小王子迷你刀新品内容测试", owner: "陈一", platforms: ["抖音", "视频号"], versionLabel: "拍摄准备 V2", nextStep: "确认后进入现场拍摄", ranges: allRanges },
    ],
    actions,
    activities: [
      { id: "activity-1", projectId: "project-mini-knife-pov-fruit", actor: "周宁", verb: "提交了", target: "初剪 V2", detail: "等待你确认前 5 秒节奏", time: "09:42", ranges: allRanges },
      { id: "activity-2", projectId: "project-oil-pot-no-straw", actor: "余安", verb: "留下审核意见", target: "脚本 V4", detail: "产品差异出现得稍晚", time: "08:56", ranges: allRanges },
      { id: "activity-3", projectId: "project-oil-pot-no-straw", actor: "陈一", verb: "更新了", target: "拍摄准备", detail: "补充俯拍机位与清洁镜头", time: "昨天 18:32", ranges: weekRanges },
      { id: "activity-4", projectId: "project-lunch-bag-commute", actor: "林晓", verb: "将你加入", target: "选题协作", detail: "需要收敛通勤用户问题", time: "昨天 15:20", ranges: weekRanges },
    ],
    recent: [
      { id: "recent-1", projectId: "project-oil-pot-no-straw", title: "脚本 V4", projectName: oilPot, kind: "脚本", meta: "今天 10:42 编辑", tab: "最近创作", role: "策划", ranges: allRanges },
      { id: "recent-2", projectId: "project-mini-knife-pov-fruit", title: "办公室场景拍摄准备", projectName: miniKnife, kind: "拍摄准备", meta: "昨天 18:16 编辑", tab: "最近创作", role: "拍摄", ranges: weekRanges },
      { id: "recent-3", projectId: "project-mini-knife-pov-fruit", title: "最终拍摄版脚本", projectName: miniKnife, kind: "阶段成果", meta: "昨天形成", tab: "最近产出", role: "策划", ranges: weekRanges },
      { id: "recent-4", projectId: "project-oil-pot-no-straw", title: "产品问题拆解 V2", projectName: oilPot, kind: "阶段成果", meta: "本周二形成", tab: "最近产出", role: "策划", ranges: weekRanges },
      { id: "recent-5", projectId: "project-lunch-bag-commute", title: "通勤桌面收纳对比", projectName: lunchBag, kind: "选题", meta: "明天开始 · 你负责策划", tab: "即将开始", role: "策划", ranges: weekRanges },
      { id: "recent-6", projectId: "project-oil-pot-no-straw", title: "清洁过程补拍", projectName: oilPot, kind: "拍摄", meta: "周五开始 · 你参与确认", tab: "即将开始", role: "拍摄", ranges: weekRanges },
    ],
    today: [
      { label: "待推进", value: 3 },
      { label: "今日拍摄", value: 1 },
      { label: "待我审核", value: 1 },
      { label: "存在风险", value: 2 },
    ],
    risks: ["喷油壶脚本计划今天定稿，目前仍待修改", "迷你刀初剪已停留 2 天，等待节奏确认"],
    aiReminders: ["喷油壶项目可引用“结构缺失变清洁优势”历史案例", "优先处理脚本修改，避免挤压今天的拍摄确认"],
  };
}

export type MyCreativeFilters = {
  range: MyCreativeTimeRange;
  role: MyCreativeRole;
  stage: MyCreativeStage | null;
  query: string;
};

export function filterMyCreativeDashboard(dashboard: MyCreativeDashboard, filters: MyCreativeFilters) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  const matches = (...values: string[]) => !query || values.some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
  const roleMatches = (role: Exclude<MyCreativeRole, "全部">) => filters.role === "全部" || filters.role === role;

  return {
    focuses: dashboard.focuses.filter((item) => item.ranges.includes(filters.range) && roleMatches(item.role) && matches(item.projectName, item.topic, item.todayGoal)),
    actions: dashboard.actions.filter((item) => item.ranges.includes(filters.range) && roleMatches(item.role) && (!filters.stage || item.stage === filters.stage) && matches(item.title, item.projectName, item.status)),
    activities: dashboard.activities.filter((item) => item.ranges.includes(filters.range) && matches(item.actor, item.target, item.detail ?? "")),
    recent: dashboard.recent.filter((item) => item.ranges.includes(filters.range) && roleMatches(item.role) && matches(item.title, item.projectName, item.kind)),
  };
}
