import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssistantMarkdown } from "./assistant-markdown";

describe("AssistantMarkdown", () => {
  it("renders GFM comparison data as a semantic, scroll-contained table", () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown content={`| 价格带 | 市场角色 |\n|---|---|\n| ¥100-199 | 主流 |`} />,
    );
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html).toContain("<th");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("¥100-199");
  });

  it("keeps Markdown source links clickable", () => {
    const html = renderToStaticMarkup(
      <AssistantMarkdown content="[来源](https://example.com/source)" />,
    );
    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain('target="_blank"');
  });
});
