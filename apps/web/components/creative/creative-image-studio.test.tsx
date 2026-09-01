import { describe, expect, it } from "vitest";

import type { GeneratedImageItem } from "@/lib/agent/use-agent-thread";

import { buildImageEditMessage, imageVersionNumber } from "./creative-image-studio";

function image(filename: string, sourceFilenames: string[] = []): GeneratedImageItem {
  return {
    id: filename,
    sequence: 1,
    turnId: "turn-image",
    url: `/api/provider/generated-images/${filename}`,
    filename,
    model: "gpt-image-2",
    sourceFilenames,
  };
}

describe("creative image studio", () => {
  it("turns precise region comments into one Harness edit instruction", () => {
    const message = buildImageEditMessage({
      instruction: "移除衣架并改成暖灰影棚背景",
      preserve: "商品结构和白色抽绳",
      aspectRatio: "1:1 商品主图",
      sourceCount: 1,
      annotations: [{ id: "note-1", x: 82, y: 18, text: "删除这个吊牌" }],
    });

    expect(message).toContain("实际编辑后的新图片版本");
    expect(message).toContain("横向 82%、纵向 18%：删除这个吊牌");
    expect(message).toContain("新的原生 imageGeneration 图片产物");
    expect(message).not.toContain("note-1");
  });

  it("derives an immutable image version chain from source filenames", () => {
    const first = image("1788220800000-11111111-1111-4111-8111-111111111111.png");
    const second = image(
      "1788220800001-22222222-2222-4222-8222-222222222222.png",
      [first.filename],
    );
    const third = image(
      "1788220800002-33333333-3333-4333-8333-333333333333.png",
      [second.filename],
    );
    const catalog = new Map([first, second, third].map((entry) => [entry.filename, entry]));

    expect(imageVersionNumber(first, catalog)).toBe(1);
    expect(imageVersionNumber(second, catalog)).toBe(2);
    expect(imageVersionNumber(third, catalog)).toBe(3);
  });
});
