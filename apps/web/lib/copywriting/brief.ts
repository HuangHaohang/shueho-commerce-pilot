export type CopywritingDraft = {
  title: string;
  body: string;
  callToAction: string;
  complianceNotes: string[];
};

export type CopywritingWorkflowResponse =
  | { responseType: "draft"; draft: CopywritingDraft; message: string }
  | { responseType: "answer"; message: string };

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
