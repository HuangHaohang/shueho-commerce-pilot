import { describe, expect, it } from "vitest";

import {
  creativeMethodLabel,
  creativeMethodOptions,
  creativeMethodSkillName,
  creativeMethodValues,
  isAppOwnedManagedSkillName,
  isCreativeMethod,
} from "./creative-method-contract";

describe("creative method contract", () => {
  it("keeps one UI option and one application Skill for every fixed method", () => {
    expect(creativeMethodOptions.map((option) => option.value)).toEqual(creativeMethodValues);
    for (const method of creativeMethodValues) {
      expect(creativeMethodLabel(method)).not.toBe(method);
      expect(creativeMethodSkillName(method)).toMatch(/^commerce-/);
    }
  });

  it("rejects arbitrary names and path-like values", () => {
    expect(isCreativeMethod("main_image")).toBe(true);
    expect(isCreativeMethod("campaign_pack")).toBe(true);
    expect(isCreativeMethod("creative_qa")).toBe(true);
    expect(isCreativeMethod("custom_method")).toBe(false);
    expect(isCreativeMethod("../../skill")).toBe(false);
  });

  it("classifies workflow and specialist Skills as internal-only", () => {
    expect(isAppOwnedManagedSkillName("commerce-creative-project")).toBe(true);
    expect(isAppOwnedManagedSkillName("commerce-product-main-image")).toBe(true);
    expect(isAppOwnedManagedSkillName("commerce-campaign-pack")).toBe(true);
    expect(isAppOwnedManagedSkillName("commerce-creative-qa")).toBe(true);
    expect(isAppOwnedManagedSkillName("commerce-custom-review")).toBe(false);
    expect(isAppOwnedManagedSkillName("skill-creator")).toBe(false);
  });

  it("exposes the two commercial methods with their fixed labels and Skills", () => {
    expect(creativeMethodLabel("campaign_pack")).toBe("Campaign 资产包");
    expect(creativeMethodSkillName("campaign_pack")).toBe("commerce-campaign-pack");
    expect(creativeMethodLabel("creative_qa")).toBe("创作合规检查");
    expect(creativeMethodSkillName("creative_qa")).toBe("commerce-creative-qa");
  });
});
