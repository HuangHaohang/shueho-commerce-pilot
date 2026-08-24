import { describe, expect, it } from "vitest";

import {
  buildCopywritingPrompt,
  parseCopywritingBriefPrompt,
  parseCopywritingDraft,
  validateCopywritingBrief,
  type CopywritingBrief,
} from "./brief";

const brief: CopywritingBrief = {
  channel: "淘宝/天猫",
  copyType: "商品卖点",
  productName: "轻量通勤包",
  sellingPoints: "轻量\n防泼水\n分区收纳",
  audience: "城市通勤人群",
  tone: "专业克制",
  approximateLength: 150,
  requiredWording: "防泼水",
  prohibitedWording: "全网第一",
};

describe("copywriting brief", () => {
  it("builds a grounded, human-readable workflow prompt", () => {
    const prompt = buildCopywritingPrompt(brief);

    expect(prompt).toContain("商品名称：轻量通勤包");
    expect(prompt).toContain("必须包含：防泼水");
    expect(prompt).toContain("禁止使用：全网第一");
    expect(prompt).not.toContain("$commerce-copywriting");
  });

  it("requires product identity and at least one selling point", () => {
    expect(validateCopywritingBrief({ ...brief, productName: "" })).toBe("请输入商品名称。");
    expect(validateCopywritingBrief({ ...brief, sellingPoints: "" })).toBe("请输入至少一个核心卖点。");
    expect(validateCopywritingBrief(brief)).toBeNull();
  });

  it("restores a saved brief from the first harness turn", () => {
    expect(parseCopywritingBriefPrompt(buildCopywritingPrompt(brief))).toEqual(brief);
    expect(parseCopywritingBriefPrompt("普通对话消息")).toBeNull();
  });

  it("parses structured harness output and preserves plain-text history", () => {
    expect(
      parseCopywritingDraft(
        JSON.stringify({
          title: "通勤更从容",
          body: "轻量通勤包，分区收纳日常所需。",
          callToAction: "立即了解",
          complianceNotes: ["防泼水等级需要复核"],
        }),
      ),
    ).toEqual({
      title: "通勤更从容",
      body: "轻量通勤包，分区收纳日常所需。",
      callToAction: "立即了解",
      complianceNotes: ["防泼水等级需要复核"],
    });

    expect(parseCopywritingDraft("保留旧版纯文本").body).toBe("保留旧版纯文本");
  });
});
