import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { config } from "./config.js";
import { database } from "./database.js";
import { providerCatalogHealth } from "./endpoint-registry.js";
import { LocalModelClient } from "./local-model-client.js";
import { createExternalDataMcpServer } from "./mcp-server.js";
import { ExternalDataPipeline } from "./pipeline.js";
import { drainIndexOutbox, ensureSearchIndex, searchIndexHealth } from "./search-index.js";

const pipeline = new ExternalDataPipeline();
const models = new LocalModelClient();
if (config.internalToken.length < 32) {
  throw new Error("EXTERNAL_DATA_INTERNAL_TOKEN must contain at least 32 characters.");
}
await database.query("SELECT 1");
await ensureSearchIndex();
await models.warmup();

const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host?.toLowerCase() ?? "";
    if (!host || !config.allowedHosts.has(host)) return sendJson(response, 421, { error: "Unrecognized host." });
    if (request.headers.origin) return sendJson(response, 403, { error: "Browser origins are not allowed." });
    const url = new URL(request.url ?? "/", `http://${host}`);
    if (request.method === "GET" && url.pathname === "/health") {
      const [modelHealth, searchHealth, catalogHealth] = await Promise.all([
        models.health().catch((error) => ({ ok: false, error: safeMessage(error) })),
        searchIndexHealth().catch((error) => ({ status: "unavailable", error: safeMessage(error) })),
        providerCatalogHealth().catch((error) => ({ totalEndpoints: 0, callableEndpoints: 0, error: safeMessage(error) })),
      ]);
      const healthy = modelHealth.ok !== false && searchHealth.status !== "unavailable" && Number(catalogHealth.callableEndpoints) > 0;
      return sendJson(response, healthy ? 200 : 503, {
        ok: healthy,
        service: "shueho-external-data",
        providerConfigured: pipeline.providerConfigured,
        postgres: "connected",
        localModels: modelHealth,
        elasticsearch: searchHealth,
        providerCatalog: catalogHealth,
      });
    }
    if (url.pathname !== "/mcp") return sendJson(response, 404, { error: "Not found." });
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return sendJson(response, 405, { error: "Method not allowed." });
    }
    if (!isAuthorized(request)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="SHUEHO External Data"');
      return sendJson(response, 401, { error: "Authentication required." });
    }
    const body = await readJsonBody(request, 1_048_576);
    const mcpServer = createExternalDataMcpServer(pipeline);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcpServer.connect(transport);
    response.on("close", () => {
      void transport.close().catch(() => undefined);
      void mcpServer.close().catch(() => undefined);
    });
    await transport.handleRequest(request, response, body);
  } catch (error) {
    if (!response.headersSent) sendJson(response, 500, { error: safeMessage(error) });
  }
});

const indexTimer = setInterval(() => {
  void drainIndexOutbox(100).catch(() => undefined);
}, config.indexWorkerIntervalMs);
indexTimer.unref();

server.listen(config.port, config.host, () => {
  console.log(`SHUEHO external-data MCP listening on http://${config.host}:${config.port}/mcp`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown(): Promise<void> {
  clearInterval(indexTimer);
  server.close();
  await database.end().catch(() => undefined);
  process.exit(0);
}

function isAuthorized(request: IncomingMessage): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  const received = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.internalToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > maximumBytes) throw new Error("MCP request body is too large.");
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/([?&]token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}
