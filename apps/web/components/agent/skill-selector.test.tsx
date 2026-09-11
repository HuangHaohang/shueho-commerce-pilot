import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SelectedSkillChip } from "./skill-selector";

describe("SelectedSkillChip", () => {
  it("renders the selected Skill name inside a sent user message", () => {
    const html = renderToStaticMarkup(
      <SelectedSkillChip
        skill={{
          name: "commerce-market-research",
          displayName: "Commerce Market Research",
        }}
        inlineMessage
      />,
    );

    expect(html).toContain('data-selected-skill="commerce-market-research"');
    expect(html).toContain("Commerce Market Research");
  });
});

import { ComposerAddMenu } from "./skill-selector";
import type { SkillInventoryItem } from "@/lib/agent/skills";

it("shows real studio previews without sending demo images as selected attachments", () => {
  const skill: SkillInventoryItem = {
    name: "studio-a-plus-v2", displayName: "商品详情与 A+ 内容", description: "商品详情",
    shortDescription: "把产品信息整理成一组视觉内容", enabled: true, scope: "repo",
    dependencyCount: 0, creator: false, applicationManaged: true,
    presentation: { title: "商品详情与 A+ 内容", category: "电商", summary: "商品详情", required_assets: "产品图片",
      preview_url: "/skill-demos/a-plus-patches-v2.jpg", preview_layout: "a-plus",
      preview_examples: [{ title: "星形贴片", url: "/skill-demos/a-plus-patches-v2.jpg", detail_url: "/skill-demos/a-plus-patches-detail-v2.jpg" }] },
  };
  const html = renderToStaticMarkup(<ComposerAddMenu open source="button" query="" plugins={[]} pluginsLoading={false}
    skills={[skill]} activeIndex={0} loading={false} selectedSkill={null} onSelect={() => undefined}
    onActiveIndexChange={() => undefined} onOpenPlugin={() => undefined} onAddFiles={() => undefined} />);
  expect(html).toContain("商品详情与 A+ 内容");
  expect(html).toContain("查看 Skill");
  expect(html).toContain("/skill-demos/a-plus-patches-detail-v2.jpg");
  expect(html).not.toContain("没有匹配的技能");
  expect(html).not.toContain("data-selected-skill");
});
