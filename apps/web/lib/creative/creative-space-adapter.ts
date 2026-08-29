export const creativeProjectChapters = [
  "概览",
  "产品确认",
  "需求",
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
export type CreativeEditableChapter = Exclude<CreativeProjectChapter, "概览">;

export type CreativeDocument = {
  id: string;
  title: string;
  source: "资料库" | "商品资料" | "历史项目";
  updatedAt: string;
  summary: string;
};

export type CreativeChapterContent = {
  body: string;
  documentIds: string[];
};

export type CreativeProductEvidence = { fact: string; userValue: string; visualProof: string };
export type CreativeProductBrief = {
  oneLineExpression: string;
  keyProof: CreativeProductEvidence;
  coreSellingPoints: CreativeProductEvidence[];
  routineSellingPoints: CreativeProductEvidence[];
  audienceScenes: Array<{ audience: string; scene: string; painPoint: string }>;
  expressionBoundaries: Array<{ item: string; reason: string; recommendedExpression: string }>;
  missingInformation: string[];
  conflicts: string[];
};

export type CreativeMember = {
  id: string;
  name: string;
  role: "项目负责人" | "策划" | "拍摄" | "剪辑" | "审核" | "需求";
};

export type CreativeProject = {
  id: string;
  name: string;
  coreDirection: string;
  linkedTasks: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  platforms: string[];
  contentGoal: string;
  lead: CreativeMember;
  members: CreativeMember[];
  currentChapter: CreativeProjectChapter;
  updatedAt: string;
  updatedBy: string;
  recentOutput: string | null;
  productBrief: CreativeProductBrief | null;
  chapters: Partial<Record<CreativeEditableChapter, CreativeChapterContent>>;
};

export type CreateCreativeProjectInput = {
  name: string;
  linkedTaskIds: string[];
  productIds: string[];
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
  documents: CreativeDocument[];
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
  updateChapter(input: { projectId: string; chapter: CreativeEditableChapter; body: string; documentIds: string[] }): CreativeProject;
  updateProductBrief(input: { projectId: string; brief: CreativeProductBrief }): CreativeProject;
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

const documents: CreativeDocument[] = [
  { id: "doc-oil-pot-manual", title: "垂直喷油壶｜产品结构与使用说明", source: "商品资料", updatedAt: "今天 09:20", summary: "无吸管结构、注油方式、清洁步骤与适用油品。" },
  { id: "doc-oil-pot-comments", title: "垂直喷油壶｜用户问题与评论摘录", source: "资料库", updatedAt: "昨天", summary: "围绕倒油、残油、清洁和喷洒均匀度的真实问题。" },
  { id: "doc-oil-pot-review", title: "喷油壶内容测试｜上轮复盘", source: "历史项目", updatedAt: "8 月 22 日", summary: "反常识开场和真实演示的完播表现与修改建议。" },
  { id: "doc-kitchen-shot", title: "厨房小工具｜低成本拍摄场景清单", source: "资料库", updatedAt: "8 月 20 日", summary: "家庭厨房、办公茶水间和桌面俯拍的可用场景。" },
];

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
    linkedTasks: [tasks[1]],
    products: [products[0]],
    platforms: ["抖音", "小红书"],
    contentGoal: "降低用户对无吸管结构的疑虑，让产品差异点变成购买理由。",
    lead: people[0],
    members: [people[0], people[1], people[2], people[3]],
    currentChapter: "脚本",
    updatedAt: "今天 10:42",
    updatedBy: "王策",
    recentOutput: "脚本 V2",
    productBrief: null,
    chapters: {
      产品确认: { body: "无吸管结构减少油液残留，清洁时可直接冲洗壶体。内容中需要用一次倒油和清洁过程，把结构差异转成用户能看到的使用价值。", documentIds: ["doc-oil-pot-manual", "doc-oil-pot-comments"] },
    },
  },
  {
    id: "project-mini-knife-pov-fruit",
    name: "小王子迷你刀｜第一视角水果使用场景",
    coreDirection: "从办公室临时切水果的第一视角，呈现小尺寸刀具的便携和顺手。",
    linkedTasks: [tasks[0]],
    products: [products[1]],
    platforms: ["抖音", "视频号"],
    contentGoal: "完成一条可在办公室场景低成本拍摄的使用型短视频。",
    lead: people[1],
    members: [people[1], people[2], people[3], people[4]],
    currentChapter: "拍摄",
    updatedAt: "昨天 18:16",
    updatedBy: "陈一",
    recentOutput: "最终拍摄版脚本",
    productBrief: null,
    chapters: {},
  },
  {
    id: "project-lunch-bag-commute",
    name: "轻量保温午餐包｜通勤不显笨重",
    coreDirection: "用地铁通勤和办公桌收纳对比，回应保温包体积大、不好搭配的问题。",
    linkedTasks: [],
    products: [products[2]],
    platforms: ["小红书"],
    contentGoal: "形成一套以通勤轻便为核心的图文与短视频表达方向。",
    lead: people[0],
    members: [people[0], people[1], people[3]],
    currentChapter: "选题",
    updatedAt: "8 月 24 日",
    updatedBy: "林晓",
    recentOutput: null,
    productBrief: null,
    chapters: {},
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
    linkedTasks: project.linkedTasks.map((task) => ({ ...task })),
    products: project.products.map((product) => ({ ...product })),
    platforms: [...project.platforms],
    lead: { ...project.lead },
    members: project.members.map((member) => ({ ...member })),
    productBrief: project.productBrief ? JSON.parse(JSON.stringify(project.productBrief)) as CreativeProductBrief : null,
    chapters: Object.fromEntries(Object.entries(project.chapters).map(([chapter, content]) => [chapter, { body: content.body, documentIds: [...content.documentIds] }])) as CreativeProject["chapters"],
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
        documents: documents.map((document) => ({ ...document })),
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
        linkedTasks: tasks.filter((task) => input.linkedTaskIds.includes(task.id)),
        products: products.filter((product) => input.productIds.includes(product.id)),
        platforms: [...input.platforms],
        contentGoal: input.contentGoal.trim(),
        lead,
        members,
        currentChapter: "概览",
        updatedAt: "刚刚",
        updatedBy: lead.name,
        recentOutput: null,
        productBrief: null,
        chapters: {},
      };
      projectsState = [project, ...projectsState];
      return copyProject(project);
    },
    updateChapter(input) {
      const projectIndex = projectsState.findIndex((project) => project.id === input.projectId);
      if (projectIndex < 0) throw new Error("未找到要编辑的内容项目。");
      const project = projectsState[projectIndex];
      const allowedDocumentIds = new Set(documents.map((document) => document.id));
      const nextProject: CreativeProject = {
        ...project,
        chapters: {
          ...project.chapters,
          [input.chapter]: { body: input.body.trim(), documentIds: input.documentIds.filter((id) => allowedDocumentIds.has(id)) },
        },
        currentChapter: input.chapter,
        updatedAt: "刚刚",
        updatedBy: "当前用户",
      };
      projectsState = projectsState.map((item, index) => index === projectIndex ? nextProject : item);
      return copyProject(nextProject);
    },
    updateProductBrief(input) {
      const projectIndex = projectsState.findIndex((project) => project.id === input.projectId);
      if (projectIndex < 0) throw new Error("未找到要更新的内容项目。");
      const project = projectsState[projectIndex];
      const nextProject: CreativeProject = {
        ...project,
        productBrief: JSON.parse(JSON.stringify(input.brief)) as CreativeProductBrief,
        updatedAt: "刚刚",
        updatedBy: "当前用户",
      };
      projectsState = projectsState.map((item, index) => index === projectIndex ? nextProject : item);
      return copyProject(nextProject);
    },
  };
}

// Phase-one in-memory boundary. Replace this adapter with an API-backed implementation
// without changing creative-space UI component contracts.
export const creativeSpaceAdapter = createMockCreativeSpaceAdapter();
