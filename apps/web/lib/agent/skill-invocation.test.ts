import { describe, expect, it } from "vitest";

import {
  readExplicitSkillMessage,
  readNativeSkillMessage,
  readVisibleAttachmentMessage,
  readSkillMention,
  removeSkillMention,
} from "./skill-invocation";

describe("skill invocation UI helpers", () => {
  it("keeps the Harness marker out of visible conversation text", () => {
    expect(readExplicitSkillMessage("$skill-creator\n创建一个退款技能")).toEqual({
      content: "创建一个退款技能",
      skillName: "skill-creator",
    });
    expect(readExplicitSkillMessage("普通消息")).toEqual({ content: "普通消息", skillName: null });
  });

  it("keeps exact user text for native Skill items while reading legacy matching markers", () => {
    expect(readNativeSkillMessage("创建一个退款技能", "skill-creator")).toEqual({
      content: "创建一个退款技能",
      skillName: "skill-creator",
    });
    expect(readNativeSkillMessage("$other-skill 是用户的原文", "skill-creator")).toEqual({
      content: "$other-skill 是用户的原文",
      skillName: "skill-creator",
    });
    expect(readNativeSkillMessage("$skill-creator\n旧任务", "skill-creator")).toEqual({
      content: "旧任务",
      skillName: "skill-creator",
    });
  });

  it("finds and removes an @ mention at the caret", () => {
    const value = "请使用 @skill-cre 创建退款流程";
    const cursor = value.indexOf(" 创建");
    const mention = readSkillMention(value, cursor);
    expect(mention).toEqual({ start: 4, end: 14, query: "skill-cre" });
    expect(removeSkillMention(value, mention!)).toBe("请使用 创建退款流程");
  });

  it("does not interpret email addresses as skill mentions", () => {
    expect(readSkillMention("ops@example.com", "ops@example.com".length)).toBeNull();
  });

  it("keeps attachment manifests and extracted contexts out of visible user text", () => {
    expect(
      readVisibleAttachmentMessage(
        "[附件：商品说明.pdf]\n请总结重点\n<commerce_attachment_context name=\"商品说明.pdf\">隐藏正文</commerce_attachment_context>",
      ),
    ).toBe("请总结重点");
  });
});
