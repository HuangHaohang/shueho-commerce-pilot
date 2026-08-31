import { describe, expect, it } from "vitest";

import { creativeMethodValues } from "./creative-method-contract";
import {
  creativeMethodActiveRequirement,
  creativeMethodGroupLabels,
  creativeMethodPresentation,
  creativeMethodRequirement,
  creativeMethodStarterPrompt,
} from "./creative-method-presentation";

describe("creative method presentation", () => {
  it("covers every server-recognized creative method exactly once", () => {
    expect(Object.keys(creativeMethodPresentation).sort()).toEqual([...creativeMethodValues].sort());
    expect(Object.values(creativeMethodGroupLabels)).toEqual(["商品上架", "营销推广", "短视频"]);
  });

  it("uses ordinary commerce language without claiming unsupported video rendering", () => {
    expect(creativeMethodStarterPrompt("main_image")).toContain("商品参考图");
    expect(creativeMethodRequirement("main_image")).toContain("选择产品");
    expect(creativeMethodStarterPrompt("video_storyboard")).toContain("短视频脚本与分镜");
    expect(creativeMethodRequirement("video_storyboard")).toContain("不会冒充已生成视频成片");
    expect(creativeMethodStarterPrompt("detail_page")).toContain("原生图片生成能力");
    expect(creativeMethodRequirement("detail_page")).toContain("不会声称已生成详情图");
  });

  it("replaces the selection instruction after products are selected", () => {
    expect(creativeMethodActiveRequirement("listing_copy", 0)).toContain("选择至少一个产品");
    expect(creativeMethodActiveRequirement("listing_copy", 1)).toContain("已选择 1 个产品");
    expect(creativeMethodActiveRequirement("main_image", 2)).toContain("参考图");
  });
});
