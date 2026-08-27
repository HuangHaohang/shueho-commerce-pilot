import { describe, expect, it } from "vitest";

import { readDynamicToolActivity, readMcpToolActivity } from "./tool-activity";

describe("tool activity metadata", () => {
  it("projects MCP Web Search to concrete sources without exposing its internal tool id", () => {
    expect(readMcpToolActivity({
      server: "commerce_web",
      tool: "search",
      result: {
        structuredContent: {
          sources: [{ title: "OpenAI", url: "https://openai.com/" }],
        },
      },
    })).toMatchObject({
      kind: "search",
      detail: null,
      isWebSearch: true,
      sources: [{ title: "OpenAI", url: "https://openai.com/" }],
    });
  });

  it("keeps non-search tool identity available for diagnostics", () => {
    expect(readDynamicToolActivity({ namespace: "commerce_image", tool: "generate" })).toMatchObject({
      kind: "image",
      detail: "commerce_image.generate",
      isWebSearch: false,
    });
  });

  it("shows a stable user-facing reason for restored provider timeouts", () => {
    expect(readMcpToolActivity({
      server: "commerce_web",
      tool: "search",
      status: "failed",
      result: { content: [{ type: "text", text: "Provider request timed out." }] },
    }).detail).toBe("网页搜索服务超时，请缩短查询范围后重试。");
  });
});
