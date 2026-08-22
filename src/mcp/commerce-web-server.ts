import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readGatewayConfig } from "../gateway/config.js";
import { CommerceProviderClient } from "../provider/commerce-provider-client.js";

const config = readGatewayConfig();
if (!config.defaultModel) {
  throw new Error("Commerce Web Search MCP requires CODEX_DEFAULT_MODEL.");
}

const provider = new CommerceProviderClient(config.provider);
const server = new McpServer(
  { name: "commerce-web", version: "0.1.0" },
  {
    instructions:
      "Use search for explicit web requests and facts that may have changed. Search is read-only and returns grounded text plus source URLs. The server retries one bounded transient provider failure internally. If a call still fails, retry once with a shorter, more specific query. Never claim Web Search is unavailable while commerce_web.search appears in the tool catalog.",
  },
);

server.registerTool(
  "search",
  {
    title: "Commerce Web Search",
    description:
      "Search the live web through the Commerce Pilot provider and return a grounded answer with source URLs. Use for current facts and explicit web-search requests.",
    inputSchema: {
      query: z.string().trim().min(1).max(4_000).describe("Complete search question and source scope."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ query }) => {
    try {
      const result = await provider.searchWeb({ model: config.defaultModel as string, query });
      const payload = {
        status: "completed",
        answer: result.answer,
        sources: result.sources,
        instruction: "Answer from this result and cite the returned source URLs.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : "Commerce Web Search failed.",
          },
        ],
      };
    }
  },
);

await server.connect(new StdioServerTransport());

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
