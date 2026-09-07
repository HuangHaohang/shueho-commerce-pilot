import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { preserveNullablePrimitiveSchemas } from "../src/mcp/nullable-schema.js";

const authorization = process.env.COMMERCE_MCP_AUTH_HEADER;
if (!authorization || !/^Bearer cp_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{32,}$/.test(authorization)) {
  throw new Error("A Commerce Pilot MCP authorization header is required.");
}
const upstream = new Client({ name: "commerce-pilot-nullable-schema-bridge", version: "1.0.0" });
await upstream.connect(new StreamableHTTPClientTransport(new URL("https://commerce-mcp.shueho.com/mcp"), {
  requestInit: { headers: { Authorization: authorization } },
}));
const server = new Server(upstream.getServerVersion() ?? { name: "shueho-commerce-pilot", version: "1" }, {
  capabilities: { tools: { listChanged: true } },
  instructions: upstream.getInstructions(),
});
server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
  const response = await upstream.listTools(request.params, { signal: extra.signal, timeout: 30_000 });
  return { ...response, tools: response.tools.map((tool) => ({ ...tool, inputSchema: preserveNullablePrimitiveSchemas(tool.inputSchema) })) };
});
server.setRequestHandler(CallToolRequestSchema, (request, extra) => upstream.callTool(request.params, undefined, {
  signal: extra.signal, timeout: 300_000,
}));
upstream.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  await server.notification({ method: "notifications/tools/list_changed" });
});
let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await Promise.allSettled([server.close(), upstream.close()]);
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
server.onclose = () => { void close(); };
await server.connect(new StdioServerTransport());
