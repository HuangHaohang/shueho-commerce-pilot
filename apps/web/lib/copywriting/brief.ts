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
    if (parsed.responseType === "answer" && typeof parsed.message === "string") {
      return { responseType: "answer", message: parsed.message.trim() };
    }
    if (typeof parsed.body !== "string" || (parsed.responseType !== undefined && parsed.responseType !== "draft")) {
      return null;
    }
    // A media-only or still-empty envelope is not a document deliverable.
    if (!parsed.body.trim()) {
      return { responseType: "answer", message: typeof parsed.message === "string" ? parsed.message.trim() : "" };
    }
    return {
      responseType: "draft",
      draft: {
        title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "",
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

/** Recognize the managed envelope before JSON.parse can accept its stream. */
export function isStructuredCopywritingEnvelope(content: string): boolean {
  const normalized = content.trim().replace(/^```(?:json)?\s*/i, "");
  if (!normalized.startsWith("{")) return false;
  if (/^\{\s*$/.test(normalized)) return true;
  const firstKey = normalized.match(/^\{\s*"([^"\n]*)/);
  const keys = ["responseType", "deliverableType", "title", "body", "canvasBlocks"];
  return Boolean(firstKey && keys.some((key) => key.startsWith(firstKey[1]) || key === firstKey[1]));
}
