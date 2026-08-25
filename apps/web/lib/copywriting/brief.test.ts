import { describe, expect, it } from "vitest";

import {
  buildCopywritingAdjustmentPrompt,
  buildCopywritingRecipeExecutionPrompt,
  tryParseStructuredCopywritingAnswer,
  tryParseStructuredCopywritingDraft,
} from "./brief";

describe("conversational copywriting Recipe", () => {
  it("starts one Harness turn that dynamically requests only missing decisions", () => {
    const prompt = buildCopywritingRecipeExecutionPrompt("帮我写一份上新文案");
    expect(prompt).toContain("调用 request_user_input 动态询问");
    expect(prompt).toContain("不要输出计划");
    expect(prompt).toContain("回答完成后继续同一个 Turn");
    expect(prompt).not.toContain("已确认信息：");
  });

  it("routes follow-up questions to conversation answers instead of draft deliveries", () => {
    const prompt = buildCopywritingAdjustmentPrompt("我还需要补充什么信息？");
    expect(prompt).toContain("responseType 使用 answer");
    expect(prompt).toContain("用户后续消息：我还需要补充什么信息？");

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
