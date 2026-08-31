import { describe, expect, it } from "vitest";

import type { CreativeCanvasImageContent } from "./creative-canvas-types";
import {
  parseCreativeCanvasContentUpdate,
  parseCreativeCanvasLayout,
  parseCreativeCanvasViewport,
} from "./creative-canvas-validation";

describe("creative canvas validation", () => {
  it("preserves the immutable native image artifact while editing text layers", () => {
    const current: CreativeCanvasImageContent = {
      kind: "image",
      title: "主图",
      description: "初稿",
      image: { artifactId: "image-1", url: "/image-1.png", filename: "image-1.png", model: "gpt-image-2" },
      textLayers: [],
      complianceNotes: [],
    };
    const updated = parseCreativeCanvasContentUpdate(current, {
      kind: "image",
      title: "主图第二版",
      description: "保留原图",
      textLayers: [{ id: "headline", text: "轻量通勤", x: 8, y: 10, width: 45, fontSize: 28, align: "left" }],
      complianceNotes: [],
    });
    if (updated.kind !== "image") throw new Error("expected image content");
    expect(updated.image).toEqual(current.image);
    expect(() => parseCreativeCanvasContentUpdate(current, {
      kind: "image",
      title: "伪造主图",
      description: "",
      textLayers: [],
      complianceNotes: [],
      image: { artifactId: "forged" },
    })).toThrow();
  });

  it("requires table rows to match the declared columns", () => {
    expect(() => parseCreativeCanvasContentUpdate({
      kind: "table",
      title: "脚本",
      columns: ["时间", "画面"],
      rows: [{ id: "row-1", cells: ["0-3s", "开场"] }],
      notes: [],
    }, {
      kind: "table",
      title: "脚本",
      columns: ["时间", "画面"],
      rows: [{ id: "row-1", cells: ["0-3s"] }],
      notes: [],
    })).toThrow();
  });

  it("bounds layouts and viewports", () => {
    expect(parseCreativeCanvasLayout({ x: 10, y: 20, width: 440, height: 340, zIndex: 1, locked: false })).toMatchObject({ width: 440 });
    expect(parseCreativeCanvasViewport({ x: 0, y: 0, zoom: 1 })).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(() => parseCreativeCanvasViewport({ x: 0, y: 0, zoom: 8 })).toThrow();
  });
});
