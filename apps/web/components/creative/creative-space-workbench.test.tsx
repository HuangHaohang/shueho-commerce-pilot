import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AgentThreadSummary } from "@/lib/agent/use-agent-thread";

import {
  CreativeMethodPickerPanel,
  CreativeSpaceWorkbench,
} from "./creative-space-workbench";

const project: AgentThreadSummary = {
  threadId: "thr-creative-1",
  title: "轻量通勤包上新",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  status: "completed",
  activeTurnId: null,
  turnStartedAt: null,
  durationMs: 1200,
  recipeId: "creative_project",
  category: "creative",
  toolContractVersion: 2,
};

describe("CreativeSpaceWorkbench", () => {
  it("renders project navigation, a blank canvas, and the Harness conversation slot", () => {
    const html = renderToStaticMarkup(
      <CreativeSpaceWorkbench
        projects={[project]}
        activeProjectId={project.threadId}
        messages={[]}
        images={[]}
        conversation={<div>Harness conversation</div>}
        onCreateProject={vi.fn()}
        onSelectProject={vi.fn()}
        onBackToWorkbench={vi.fn()}
      />,
    );

    expect(html).toContain("创作项目");
    expect(html).toContain("轻量通勤包上新");
    expect(html).toContain('aria-label="创作画布"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="创作空间视图"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Harness conversation");
  });

  it("shows nine grouped commerce methods and an honestly disabled rendered-video state", () => {
    const html = renderToStaticMarkup(
      <CreativeMethodPickerPanel value="main_image" onSelect={vi.fn()} />,
    );

    for (const label of [
      "Campaign 资产包",
      "商品标题与文案",
      "推广文案",
      "商品主图",
      "副图与场景图",
      "商品详情页",
      "产品拍摄脚本",
      "短视频分镜",
      "创作合规检查",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("生成标题、卖点和商品页文案");
    expect(html).toContain("整套营销");
    expect(html).toContain("审核交付");
    expect(html).toContain("lucide-package-open");
    expect(html).toContain("lucide-shield-check");
    expect(html).not.toContain("提供可识别商品外观的参考图");
    expect(html).not.toContain("选择后只会预填对话");
    expect(html).toContain("视频成片");
    expect(html).toContain("当前可生成脚本与分镜，暂不渲染成片");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-pressed="true"');
  });

  it("renders the persistent infinite-canvas surface before BFF node hydration", () => {
    const html = renderToStaticMarkup(
      <CreativeSpaceWorkbench
        projects={[project]}
        activeProjectId={project.threadId}
        messages={[{
          id: "message-gallery",
          sequence: 4,
          turnId: "turn-gallery",
          role: "assistant",
          phase: "final_answer",
          status: "completed",
          content: JSON.stringify({
            responseType: "draft",
            deliverableType: "gallery_images",
            channel: "京东",
            title: "通勤包副图组",
            body: "图片组说明",
            callToAction: "",
            complianceNotes: [],
            message: "",
          }),
        }]}
        images={[
          { id: "image-1", sequence: 2, turnId: "turn-gallery", url: "/image-1.png", filename: "image-1.png", model: "gpt-image-2" },
          { id: "image-2", sequence: 3, turnId: "turn-gallery", url: "/image-2.png", filename: "image-2.png", model: "gpt-image-2" },
        ]}
        conversation={<div>Harness conversation</div>}
        onCreateProject={vi.fn()}
        onSelectProject={vi.fn()}
        onBackToWorkbench={vi.fn()}
      />,
    );

    expect(html).toContain("data-creative-infinite-canvas");
    expect(html).toContain("创作画布");
    expect(html).toContain('aria-label="电商创作画布"');
    expect(html).not.toContain('src="/image-1.png"');
    expect(html).not.toContain('src="/image-2.png"');
  });
});
