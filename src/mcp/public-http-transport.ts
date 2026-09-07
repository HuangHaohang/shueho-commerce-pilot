import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/** Keep one paid tool invocation alive through idle-limited reverse proxies. */
export function createPublicHttpTransport(keepAliveMs = 10_000): StreamableHTTPServerTransport {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: false,
    keepAliveMs,
  });
}
