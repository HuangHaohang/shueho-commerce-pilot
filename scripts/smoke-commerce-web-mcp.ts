import "dotenv/config";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "node:path";

const client = new Client({ name: "commerce-web-smoke", version: "0.1.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("dist/src/mcp/commerce-web-server.js")],
  cwd: process.cwd(),
  env: Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  ),
});

await client.connect(transport);
try {
  const catalog = await client.listTools();
  if (!catalog.tools.some((tool) => tool.name === "search")) {
    throw new Error("Commerce Web Search MCP did not expose the search tool.");
  }
  const result = await client.callTool({
    name: "search",
    arguments: { query: "Find the official OpenAI Codex App Server documentation URL." },
  });
  const normalized = result as { isError?: boolean; content?: unknown };
  const content = Array.isArray(normalized.content)
    ? normalized.content.filter(
        (item): item is { type: "text"; text: string } =>
          Boolean(item && typeof item === "object" && "type" in item && item.type === "text" && "text" in item && typeof item.text === "string"),
      )
    : [];
  const text = content[0]?.text ?? "";
  if (normalized.isError) {
    throw new Error(text || "Commerce Web Search MCP returned an error.");
  }
  const payload = JSON.parse(text) as { sources?: Array<{ url?: unknown }> };
  const sources = Array.isArray(payload.sources) ? payload.sources : [];
  if (!sources.some((source) => typeof source.url === "string" && /^https?:\/\//.test(source.url))) {
    throw new Error("Commerce Web Search MCP returned no source URL.");
  }
  console.log(JSON.stringify({ ok: true, tool: "commerce_web.search", sourceCount: sources.length }, null, 2));
} finally {
  await client.close();
}
