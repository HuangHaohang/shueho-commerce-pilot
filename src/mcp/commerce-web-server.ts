import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { readGatewayConfig } from "../gateway/config.js";
import { CommerceProviderClient, CommerceProviderError } from "../provider/commerce-provider-client.js";

const config = readGatewayConfig();
const provider = new CommerceProviderClient(config.provider);
await provider.assertAgentModel(config.provider.webSearchModel);
const server = new McpServer(
  { name: "commerce-web", version: "0.1.0" },
  {
    instructions:
      "Use search for explicit web requests and facts that may have changed. Search is read-only and returns grounded text plus source URLs. If a call fails, issue at most one new tool call with a shorter, more specific query. Never claim Web Search is unavailable while commerce_web.search appears in the tool catalog.",
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
      const result = await provider.searchWeb({ model: config.provider.webSearchModel, query });
      const payload = {
        status: "completed",
        answer: result.answer,
        sources: result.sources,
        instruction: "Answer from this result and cite the returned source URLs.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload,
        _meta: {
          commercePilotUsage: {
            source: "commerce_web_mcp",
            providerId: config.provider.id,
            responseId: result.responseId,
            model: result.model,
            usage: result.usage,
          },
        },
      };
    } catch (error) {
      const failure = normalizeWebSearchFailure(error);
      return {
        isError: true,
        content: [{ type: "text" as const, text: failure.error }],
        structuredContent: failure,
      };
    }
  },
);

await server.connect(new StdioServerTransport());

function normalizeWebSearchFailure(error: unknown): {
  status: "failed";
  code: string;
  error: string;
  retryable: boolean;
  instruction: string;
} {
  const message = error instanceof Error ? error.message : "";
  const timedOut = /timed out|timeout/i.test(message);
  const missingSources = /no source URL/i.test(message);
  const retryable = timedOut || (error instanceof CommerceProviderError && (error.upstreamStatus ?? 0) >= 500);
  return {
    status: "failed",
    code: timedOut ? "WEB_SEARCH_TIMEOUT" : missingSources ? "WEB_SEARCH_NO_SOURCES" : "WEB_SEARCH_PROVIDER_FAILED",
    error: timedOut
      ? "网页搜索服务超时，请缩短查询范围后重试。"
      : missingSources
        ? "网页搜索服务未返回可核验来源，请更换查询词后重试。"
        : "网页搜索服务暂时不可用。",
    retryable,
    instruction: retryable
      ? "Explain the failure, then retry at most once with a shorter and more specific query."
      : "Explain the failure reason and do not claim that sources were retrieved.",
  };
}

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
