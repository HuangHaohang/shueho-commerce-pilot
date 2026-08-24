import { describe, expect, it } from "vitest";

import {
  collectRecentWebSources,
  readWebSourcesFromToolItem,
} from "./web-sources";

describe("web search sources", () => {
  it("reads structured MCP search sources and removes tracking parameters", () => {
    expect(
      readWebSourcesFromToolItem({
        result: {
          structuredContent: {
            sources: [
              {
                url: "https://www.google.com/?hl=us&utm_source=openai&utm_campaign=test",
                title: "Google",
              },
            ],
          },
        },
      }),
    ).toEqual([{ url: "https://www.google.com/?hl=us", title: "Google" }]);
  });

  it("deduplicates sources and keeps the most recent activity first", () => {
    expect(
      collectRecentWebSources([
        {
          sequence: 2,
          sources: [{ url: "https://developers.openai.com/codex/app-server", title: "Codex" }],
        },
        {
          sequence: 4,
          sources: [
            { url: "https://openai.com/?utm_source=openai", title: "OpenAI" },
            { url: "https://developers.openai.com/codex/app-server", title: "Codex App Server" },
          ],
        },
      ]),
    ).toEqual([
      { url: "https://openai.com/", title: "OpenAI" },
      { url: "https://developers.openai.com/codex/app-server", title: "Codex App Server" },
    ]);
  });

  it("rejects non-web source schemes", () => {
    expect(
      readWebSourcesFromToolItem({
        result: { structuredContent: { sources: [{ url: "file:///etc/passwd", title: "unsafe" }] } },
      }),
    ).toEqual([]);
  });
});
