import type { RequestUserInputQuestion } from "@/lib/agent/use-agent-thread";

export function buildCopywritingRecipeQuestions(goal: string): RequestUserInputQuestion[] {
  const normalized = goal.trim();
  const questions: RequestUserInputQuestion[] = [];

  if (!/(淘宝|天猫|小红书|抖音|京东|私域)/i.test(normalized)) {
    questions.push({
      id: "publication_channel",
      header: "发布渠道",
      question: "这次准备发布到哪里？",
      isOther: true,
      isSecret: false,
      options: [
        { label: "淘宝/天猫", description: "突出商品信息、卖点层级和购买决策。" },
        { label: "小红书", description: "偏生活化场景和真实体验表达。" },
        { label: "抖音", description: "强调开场吸引力和短句节奏。" },
        { label: "让我决定", description: "由 Agent 根据任务目标选择更合适的渠道表达。" },
      ],
    });
  }

  if (!/(专业|克制|自然|种草|简洁|有力|轻松|活泼|生活化)/i.test(normalized)) {
    questions.push({
      id: "expression_direction",
      header: "表达方向",
      question: "你更倾向哪种表达？",
      isOther: true,
      isSecret: false,
      options: [
        { label: "专业克制", description: "信息清楚、可信，不使用夸张表达。" },
        { label: "自然种草", description: "更有生活感，适合场景化推荐。" },
        { label: "让我决定", description: "由 Agent 结合渠道和商品类型判断。" },
      ],
    });
  }

  return questions;
}

export function summarizeRecipeAnswers(
  questions: RequestUserInputQuestion[],
  answers: Record<string, { answers: string[] }>,
): string {
  return questions
    .map((question) => {
      const values = answers[question.id]?.answers ?? [];
      return values.length ? `${question.question} ${values.join("；")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}
