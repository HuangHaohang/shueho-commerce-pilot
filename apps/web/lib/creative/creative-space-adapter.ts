export const creativeProjectChapters = [
  "概览",
  "需求",
  "产品",
  "选题",
  "表现形式",
  "脚本",
  "拍摄",
  "剪辑",
  "成片",
  "数据",
  "复盘",
] as const;

export type CreativeProjectChapter = (typeof creativeProjectChapters)[number];

export type CreativeMember = {
  id: string;
  name: string;
  role: "项目负责人" | "策划" | "拍摄" | "剪辑" | "审核" | "需求";
};

export type CreativeProject = {
  id: string;
  name: string;
  coreDirection: string;
  linkedTask: { id: string; name: string } | null;
  product: { id: string; name: string } | null;
  platforms: string[];
  contentGoal: string;
  lead: CreativeMember;
  members: CreativeMember[];
  currentChapter: CreativeProjectChapter;
  updatedAt: string;
  updatedBy: string;
  recentOutput: string | null;
};

export type CreateCreativeProjectInput = {
  name: string;
  linkedTaskId: string | null;
  productId: string | null;
  platforms: string[];
  contentGoal: string;
  leadId: string;
  memberIds: string[];
};

export type CreativeSpaceSnapshot = {
  projects: CreativeProject[];
  tasks: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  people: CreativeMember[];
  inspiration: Array<{
    id: string;
    type: "灵感" | "参考视频" | "案例" | "用户评论";
    title: string;
    note: string;
    source: string;
  }>;
};

export interface CreativeSpaceAdapter {
  getSnapshot(): CreativeSpaceSnapshot;
  createProject(input: CreateCreativeProjectInput): CreativeProject;
}

const tasks = [
  { id: "task-knife-launch", name: "小王子迷你刀新品内容测试" },
  { id: "task-oil-pot", name: "厨房小工具短视频选题周" },
] as const;

const products = [
  { id: "product-oil-pot", name: "垂直喷油壶" },
  { id: "product-mini-knife", name: "小王子迷你刀" },
  { id: "product-lunch-bag", name: "轻量保温午餐包" },
] as const;

const people: CreativeMember[] = [
  { id: "member-lin", name: "林晓", role: "项目负责人" },
  { id: "member-wang", name: "王策", role: "策划" },
  { id: "member-chen", name: "陈一", role: "拍摄" },
  { id: "member-zhou", name: "周宁", role: "剪辑" },
  { id: "member-yu", name: "余安", role: "审核" },
];

const seededProjects: CreativeProject[] = [
  {
    id: "project-oil-pot-no-straw",
    name: "垂直喷油壶｜为什么没有吸管",
    coreDirection: "用一次真实倒油演示，解释无吸管结构如何减少残油和清洁负担。",
    linkedTask: tasks[1],
    product: products[0],
    platforms: ["抖音", "小红书"],
    contentGoal: "降低用户对无吸管结构的疑虑，让产品差异点变成购买理由。",
    lead: people[0],
    members: [people[0], people[1], people[2], people[3]],
    currentChapter: "脚本",
    updatedAt: "今天 10:42",
    updatedBy: "王策",
    recentOutput: "脚本 V2",
  },
  {
    id: "project-mini-knife-pov-fruit",
    name: "小王子迷你刀｜第一视角水果使用场景",
    coreDirection: "从办公室临时切水果的第一视角，呈现小尺寸刀具的便携和顺手。",
    linkedTask: tasks[0],
    product: products[1],
    platforms: ["抖音", "视频号"],
    contentGoal: "完成一条可在办公室场景低成本拍摄的使用型短视频。",
    lead: people[1],
    members: [people[1], people[2], people[3], people[4]],
    currentChapter: "拍摄",
    updatedAt: "昨天 18:16",
    updatedBy: "陈一",
    recentOutput: "最终拍摄版脚本",
  },
  {
    id: "project-lunch-bag-commute",
    name: "轻量保温午餐包｜通勤不显笨重",
    coreDirection: "用地铁通勤和办公桌收纳对比，回应保温包体积大、不好搭配的问题。",
    linkedTask: null,
    product: products[2],
    platforms: ["小红书"],
    contentGoal: "形成一套以通勤轻便为核心的图文与短视频表达方向。",
    lead: people[0],
    members: [people[0], people[1], people[3]],
    currentChapter: "选题",
    updatedAt: "8 月 24 日",
    updatedBy: "林晓",
    recentOutput: null,
  },
];

const inspiration: CreativeSpaceSnapshot["inspiration"] = [
  {
    id: "inspiration-1",
    type: "参考视频",
    title: "第一视角切水果：动作比口播更快建立理解",
    note: "开头 2 秒直接落刀，随后才补充产品差异。",
    source: "团队案例库",
  },
  {
    id: "inspiration-2",
    type: "用户评论",
    title: "“没有吸管会不会倒不干净？”",
    note: "适合作为喷油壶内容的真实问题起点。",
    source: "商品评论",
  },
  {
    id: "inspiration-3",
    type: "案例",
    title: "把结构缺失解释成清洁优势",
    note: "先承认反常识，再用可见过程建立可信度。",
    source: "历史复盘",
  },
];

function copyProject(project: CreativeProject): CreativeProject {
  return {
    ...project,
    linkedTask: project.linkedTask ? { ...project.linkedTask } : null,
    product: project.product ? { ...project.product } : null,
    platforms: [...project.platforms],
    lead: { ...project.lead },
    members: project.members.map((member) => ({ ...member })),
  };
}

export function createMockCreativeSpaceAdapter(): CreativeSpaceAdapter {
  let projectsState = seededProjects.map(copyProject);
  let createdCount = 0;

  return {
    getSnapshot() {
      return {
        projects: projectsState.map(copyProject),
        tasks: tasks.map((task) => ({ ...task })),
        products: products.map((product) => ({ ...product })),
        people: people.map((person) => ({ ...person })),
        inspiration: inspiration.map((item) => ({ ...item })),
      };
    },
    createProject(input) {
      const lead = people.find((person) => person.id === input.leadId) ?? people[0];
      const memberIds = new Set([lead.id, ...input.memberIds]);
      const members = people.filter((person) => memberIds.has(person.id));
      const project: CreativeProject = {
        id: `mock-project-${Date.now()}-${createdCount++}`,
        name: input.name.trim(),
        coreDirection: input.contentGoal.trim() || "核心内容方向将在需求与选题章节中继续明确。",
        linkedTask: tasks.find((task) => task.id === input.linkedTaskId) ?? null,
        product: products.find((product) => product.id === input.productId) ?? null,
        platforms: [...input.platforms],
        contentGoal: input.contentGoal.trim(),
        lead,
        members,
        currentChapter: "概览",
        updatedAt: "刚刚",
        updatedBy: lead.name,
        recentOutput: null,
      };
      projectsState = [project, ...projectsState];
      return copyProject(project);
    },
  };
}

// Phase-one in-memory boundary. Replace this adapter with an API-backed implementation
// without changing creative-space UI component contracts.
export const creativeSpaceAdapter = createMockCreativeSpaceAdapter();
