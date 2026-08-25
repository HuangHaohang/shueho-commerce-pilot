export type CopywritingDraft = {
  title: string;
  body: string;
  callToAction: string;
  complianceNotes: string[];
};

export type CopywritingWorkflowResponse =
  | { responseType: "draft"; draft: CopywritingDraft; message: string }
  | { responseType: "answer"; message: string };

export function buildCopywritingRecipeExecutionPrompt(goal: string): string {
  return [
    "这是一个对话型电商文案 Task Recipe，不要输出计划。",
    "",
    `用户目标：${goal.trim()}`,
    "",
    "先判断完成文案所需的高影响信息是否缺失。",
    "如果确实需要用户决策，调用 request_user_input 动态询问 1-3 个简短问题并等待回答；不要用普通正文假装提问。每个问题都应提供一个由 Agent 判断的选项。",
    "如果信息已经足够，不要为了走流程而提问。回答完成后继续同一个 Turn，直接交付最终文案。",
    "这是首次交付，responseType 必须使用 draft。",
    "只使用可以确认的事实；缺失信息不要补造，并在合规备注中指出。",
  ].join("\n");
}

export function buildCopywritingAdjustmentPrompt(instruction: string): string {
  return [
    "请处理用户对当前文案任务的后续消息，并保持最初目标与已确认信息的事实约束。",
    "如果用户是在提问、询问缺失信息、要求解释或征求建议，请直接回答，responseType 使用 answer，不要创建文案版本。",
    "只有用户明确要求改写、调整、重写或生成新文案时，responseType 才使用 draft，并在当前对话中交付新文案。",
    `用户后续消息：${instruction.trim()}`,
  ].join("\n");
}

export function tryParseStructuredCopywritingDraft(content: string): CopywritingDraft | null {
  const response = parseCopywritingWorkflowResponse(content);
  return response?.responseType === "draft" ? response.draft : null;
}

export function tryParseStructuredCopywritingAnswer(content: string): string | null {
  const response = parseCopywritingWorkflowResponse(content);
  return response?.responseType === "answer" ? response.message : null;
}

export function parseCopywritingWorkflowResponse(content: string): CopywritingWorkflowResponse | null {
  const normalized = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    if (parsed.responseType === "answer" && typeof parsed.message === "string" && parsed.message.trim()) {
      return { responseType: "answer", message: parsed.message.trim() };
    }
    if (typeof parsed.body !== "string" || (parsed.responseType !== undefined && parsed.responseType !== "draft")) {
      return null;
    }
    return {
      responseType: "draft",
      draft: {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "未命名文案",
        body: parsed.body,
        callToAction: typeof parsed.callToAction === "string" ? parsed.callToAction : "",
        complianceNotes: Array.isArray(parsed.complianceNotes)
          ? parsed.complianceNotes.filter((note): note is string => typeof note === "string")
          : [],
      },
      message: typeof parsed.message === "string" ? parsed.message.trim() : "",
    };
  } catch {
    return null;
  }
}
