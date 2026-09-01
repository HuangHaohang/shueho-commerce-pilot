import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CreativeCanvasImageContent } from "@/lib/creative/creative-canvas-types";

import { CreativeLayerEditor } from "./creative-layer-editor";

describe("CreativeLayerEditor", () => {
  it("renders a direct layer canvas and keeps AI editing optional", () => {
    const content: CreativeCanvasImageContent = {
      kind: "image",
      title: "商品主图",
      description: "图层文档",
      image: { artifactId: "image-1", url: "/image-1.png", filename: "image-1.png", model: "gpt-image-2" },
      textLayers: [],
      editorLayers: [{
        id: "headline",
        kind: "text",
        name: "主标题",
        text: "轻量通勤",
        x: 12,
        y: 12,
        width: 40,
        height: 14,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        fontSize: 32,
        color: "#ffffff",
        align: "left",
        fontWeight: 600,
      }],
      design: { width: 1000, height: 1000, background: "#ffffff" },
      complianceNotes: [],
    };
    const html = renderToStaticMarkup(
      <CreativeLayerEditor
        threadId="thread-creative-1"
        image={{ id: "image-1", sequence: 1, turnId: "turn-1", url: "/image-1.png", filename: "image-1.png", model: "gpt-image-2", sourceFilenames: [] }}
        content={content}
        loading={false}
        saving={false}
        running={false}
        error={null}
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        onSubmitAgentInstruction={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="图片图层画布"');
    expect(html).toContain('aria-label="Fabric 电商设计画布"');
    expect(html).toContain('aria-label="图层和属性"');
    expect(html).toContain("主标题");
    expect(html).toContain("原始底图");
    expect(html).toContain("AI 辅助修改底图（可选）");
    expect(html).toContain("上传 Logo/素材");
    expect(html).not.toContain("必须保留");
    expect(html).not.toContain("输出画幅");
  });
});
