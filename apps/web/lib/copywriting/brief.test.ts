import { describe, expect, it } from "vitest";

import {
  tryParseStructuredCopywritingAnswer,
  tryParseStructuredCopywritingDraft,
} from "./brief";

describe("conversational copywriting Recipe", () => {
  it("routes follow-up questions to conversation answers instead of draft deliveries", () => {
    const answer = JSON.stringify({
      responseType: "answer",
      title: "",
      body: "",
      callToAction: "",
      complianceNotes: [],
      message: "建议补充商品重量、容量、材质和内部结构。",
    });
    expect(tryParseStructuredCopywritingAnswer(answer)).toBe("建议补充商品重量、容量、材质和内部结构。");
    expect(tryParseStructuredCopywritingDraft(answer)).toBeNull();
  });

  it("renders explicit revisions as draft messages and accepts legacy draft objects", () => {
    const revision = JSON.stringify({
      responseType: "draft",
      title: "通勤更轻松",
      body: "轻量随行，从容通勤。",
      callToAction: "立即了解",
      complianceNotes: [],
      message: "已按简洁语气调整。",
    });
    expect(tryParseStructuredCopywritingDraft(revision)?.title).toBe("通勤更轻松");
    expect(
      tryParseStructuredCopywritingDraft(
        JSON.stringify({ title: "旧版", body: "兼容旧线程", callToAction: "", complianceNotes: [] }),
      )?.title,
    ).toBe("旧版");
  });
});
