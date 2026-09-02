import type { CreativeDocument, CreativeProject } from "./creative-space-adapter";

export type RequirementStatus = "未整理" | "待确认" | "已确认" | "已更新待重新确认";
export type RequirementQuestionStatus = "待确认" | "已补充" | "暂不确认" | "已忽略";

export type RequirementSource = {
  taskId: string | null;
  sourceType: "短视频任务系统" | "创作空间补充";
  sourceVersion: string;
  updatedAt: string;
  rawContent: string;
  product: string | null;
  platforms: string[];
  quantity: string | null;
  mustInclude: string[];
  attachments: string[];
};

export type RequirementInsightSource = "原始需求" | "产品简报" | "AI推断" | "人工补充";
export type RequirementAnalysis = {
  purpose: string;
  keyMessage: string[];
  audience: { text: string; inferred: boolean };
  userQuestions: string[];
  mustInclude: Array<{ text: string; source: RequirementInsightSource }>;
  constraints: Array<{ text: string; source: RequirementInsightSource }>;
};

export type RequirementQuestion = {
  id: string;
  title: string;
  reason: string;
  status: RequirementQuestionStatus;
  answer: string | null;
};

export type RequirementBrief = {
  version: number;
  analysis: RequirementAnalysis;
  documentIds: string[];
  confirmedBy: string;
  confirmedAt: string;
  sourceVersion: string;
};

export type RequirementWorkspaceState = {
  projectId: string;
  status: RequirementStatus;
  source: RequirementSource;
  analysis: RequirementAnalysis;
  questions: RequirementQuestion[];
  supplements: string[];
  documentIds: string[];
  brief: RequirementBrief | null;
  briefHistory: RequirementBrief[];
};

export interface RequirementBriefAdapter {
  get(project: CreativeProject): RequirementWorkspaceState;
  addSupplement(input: { project: CreativeProject; text: string }): RequirementWorkspaceState;
  answerQuestion(input: { project: CreativeProject; questionId: string; answer: string; status: Extract<RequirementQuestionStatus, "已补充" | "暂不确认" | "已忽略"> }): RequirementWorkspaceState;
  updateDocuments(input: { project: CreativeProject; documentIds: string[]; documents: CreativeDocument[] }): RequirementWorkspaceState;
  applyAnalysis(input: { project: CreativeProject; analysis: RequirementAnalysis; questions: Array<{ title: string; reason: string }> }): RequirementWorkspaceState;
  confirm(project: CreativeProject): RequirementWorkspaceState;
}

function copyAnalysis(analysis: RequirementAnalysis): RequirementAnalysis {
  return { ...analysis, keyMessage: [...analysis.keyMessage], audience: { ...analysis.audience }, userQuestions: [...analysis.userQuestions], mustInclude: analysis.mustInclude.map((item) => ({ ...item })), constraints: analysis.constraints.map((item) => ({ ...item })) };
}

function copyState(state: RequirementWorkspaceState): RequirementWorkspaceState {
  return { ...state, source: { ...state.source, platforms: [...state.source.platforms], mustInclude: [...state.source.mustInclude], attachments: [...state.source.attachments] }, analysis: copyAnalysis(state.analysis), questions: state.questions.map((item) => ({ ...item })), supplements: [...state.supplements], documentIds: [...state.documentIds], brief: state.brief ? { ...state.brief, analysis: copyAnalysis(state.brief.analysis), documentIds: [...state.brief.documentIds] } : null, briefHistory: state.briefHistory.map((brief) => ({ ...brief, analysis: copyAnalysis(brief.analysis), documentIds: [...brief.documentIds] })) };
}

function makeState(project: CreativeProject): RequirementWorkspaceState {
  const isOilPot = project.id === "project-oil-pot-no-straw";
  const source: RequirementSource = {
    taskId: project.linkedTasks[0]?.id ?? null,
    sourceType: "短视频任务系统",
    sourceVersion: "任务更新于今天 09:40",
    updatedAt: "今天 09:40",
    rawContent: isOilPot ? "围绕“无吸管”做重点内容，希望解释为什么这样设计，并突出和普通喷油壶的区别。通过实际使用让用户理解垂直喷油的工作方式。" : `围绕「${project.name}」整理短视频内容方向，优先回应用户真实使用场景和疑问。`,
    product: project.products.map((product) => product.name).join("、") || null,
    platforms: [...project.platforms],
    quantity: isOilPot ? "10 条" : null,
    mustInclude: isOilPot ? ["无吸管结构", "垂直喷油", "实际使用"] : ["真实使用场景", "产品核心差异"],
    attachments: isOilPot ? ["垂直喷油壶｜产品结构与使用说明", "垂直喷油壶｜用户问题与评论摘录"] : [],
  };
  const analysis: RequirementAnalysis = isOilPot ? {
    purpose: "这批内容的主要任务不是单纯介绍喷油壶，而是建立“为什么无吸管反而更合理”的认知，并通过真实使用降低用户对结构差异的疑惑。",
    keyMessage: ["无吸管不是少了一个零件，而是另一种喷油结构设计。"],
    audience: { text: "对喷油壶结构存在疑惑、担心无吸管影响使用的厨房用户。", inferred: true },
    userQuestions: ["没有吸管真的能喷油吗？", "油怎么进入喷油结构？", "和普通喷油壶有什么区别？", "会不会喷不均匀？"],
    mustInclude: [{ text: "无吸管的真实工作方式", source: "原始需求" }, { text: "垂直喷油的实际使用效果", source: "原始需求" }, { text: "与普通结构的差异，但避免贬低式比较", source: "AI推断" }],
    constraints: [{ text: "不要错误描述工作原理", source: "AI推断" }, { text: "不要使用未经证实的绝对化比较", source: "AI推断" }, { text: "视频应围绕核心产品展开", source: "原始需求" }],
  } : {
    purpose: `先把「${project.name}」的真实使用价值讲清楚，再进入具体创作表达。`, keyMessage: [project.coreDirection], audience: { text: "与当前产品使用场景相关、仍有疑问的目标用户。", inferred: true }, userQuestions: ["这个产品在什么场景下最有用？", "它和已有选择有什么不同？"], mustInclude: source.mustInclude.map((text) => ({ text, source: "原始需求" })), constraints: [{ text: "不使用未经确认的效果承诺", source: "AI推断" }],
  };
  return { projectId: project.id, status: "待确认", source, analysis, questions: [{ id: "priority", title: "核心目标还需要排序", reason: "当前既要解释结构，也要突出使用效果，需要确认哪一个是第一重点。", status: "待确认", answer: null }, { id: "audience", title: "用户人群未明确", reason: "当前人群来自 AI 推测，后续脚本的语言和场景会受影响。", status: "待确认", answer: null }, { id: "proof", title: "缺少证明素材", reason: "如要说明结构差异，需要确认是否具备剖面、工厂或实际演示素材。", status: "待确认", answer: null }], supplements: [], documentIds: [], brief: null, briefHistory: [] };
}

export function createMockRequirementBriefAdapter(): RequirementBriefAdapter {
  const stateByProject = new Map<string, RequirementWorkspaceState>();
  const getState = (project: CreativeProject) => stateByProject.get(project.id) ?? makeState(project);
  const store = (state: RequirementWorkspaceState) => { stateByProject.set(state.projectId, state); return copyState(state); };
  return {
    get(project) { return copyState(getState(project)); },
    addSupplement({ project, text }) {
      const current = getState(project); const supplement = text.trim(); if (!supplement) return copyState(current);
      const next: RequirementWorkspaceState = { ...current, status: current.brief ? "已更新待重新确认" : "待确认", supplements: [...current.supplements, supplement], analysis: { ...current.analysis, constraints: [...current.analysis.constraints, { text: supplement, source: "人工补充" }] } };
      return store(next);
    },
    answerQuestion({ project, questionId, answer, status }) {
      const current = getState(project);
      return store({ ...current, status: current.brief ? "已更新待重新确认" : "待确认", questions: current.questions.map((question) => question.id === questionId ? { ...question, status, answer: answer.trim() || null } : question) });
    },
    updateDocuments({ project, documentIds, documents }) {
      const allowed = new Set(documents.map((document) => document.id)); const current = getState(project);
      return store({ ...current, status: current.brief ? "已更新待重新确认" : current.status, documentIds: documentIds.filter((id) => allowed.has(id)) });
    },
    applyAnalysis({ project, analysis, questions }) {
      const current = getState(project);
      return store({
        ...current,
        status: current.brief ? "已更新待重新确认" : "待确认",
        analysis: copyAnalysis(analysis),
        questions: questions.map((question, index) => ({ id: `ai-question-${index}`, ...question, status: "待确认", answer: null })),
      });
    },
    confirm(project) {
      const current = getState(project); const version = current.briefHistory.length + 1;
      const brief: RequirementBrief = { version, analysis: copyAnalysis(current.analysis), documentIds: [...current.documentIds], confirmedBy: "当前用户", confirmedAt: "刚刚", sourceVersion: current.source.sourceVersion };
      return store({ ...current, status: "已确认", brief, briefHistory: [...current.briefHistory, brief] });
    },
  };
}

export const requirementBriefAdapter = createMockRequirementBriefAdapter();
