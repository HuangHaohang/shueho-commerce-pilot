import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const EXTERNAL_DATA_SERVICE_REQUIRED_TOOLS = [
  "list_platforms",
  "list_marketplace_research_platforms",
  "get_marketplace_options",
  "search_endpoints",
  "get_endpoint_schema",
  "preflight_endpoint",
  "preflight_marketplace_product_research",
  "plan_marketplace_product_research",
  "execute_marketplace_product_research_plan",
  "begin_marketplace_product_research",
  "resolve_marketplace_product_bindings",
  "complete_marketplace_product_research",
  "cancel_marketplace_product_research",
  "preflight_social_content_research",
  "call_endpoint",
  "get_research_result",
  "search_business_data",
] as const;

export type ExternalDataServiceToolResult = {
  payload: Record<string, unknown>;
  resultBytes: number;
  isError: boolean;
};

export type ExternalDataServiceMcpConfig = {
  url: string;
  token?: string;
  timeoutMs: number;
  maxResultBytes: number;
};

export class ExternalDataServiceMcpError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "CONNECT_FAILED" | "TOOL_UNAVAILABLE" | "CALL_FAILED" | "INVALID_RESULT" | "RESULT_TOO_LARGE",
    readonly uncertain = false,
  ) {
    super(message);
    this.name = "ExternalDataServiceMcpError";
  }
}

export class ExternalDataServiceMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private status: {
    configured: boolean;
    connected: boolean;
    tools: string[];
    checkedAt: string | null;
    error: string | null;
  };

  constructor(private readonly config: ExternalDataServiceMcpConfig) {
    this.status = {
      configured: Boolean(config.token),
      connected: false,
      tools: [],
      checkedAt: null,
      error: config.token ? null : "EXTERNAL_DATA_SERVICE_MCP_TOKEN is not configured.",
    };
  }

  get configured(): boolean {
    return Boolean(this.config.token);
  }

  readStatus() {
    return { ...this.status, tools: [...this.status.tools] };
  }

  async verify() {
    if (!this.configured) return this.readStatus();
    try {
      await this.ensureConnected();
      const missing = EXTERNAL_DATA_SERVICE_REQUIRED_TOOLS.filter((tool) => !this.status.tools.includes(tool));
      if (missing.length) {
        throw new ExternalDataServiceMcpError(`SHUEHO external-data MCP is missing tools: ${missing.join(", ")}.`, "TOOL_UNAVAILABLE");
      }
      this.status = { ...this.status, connected: true, checkedAt: new Date().toISOString(), error: null };
    } catch (error) {
      this.status = { configured: true, connected: false, tools: [], checkedAt: new Date().toISOString(), error: safeMessage(error) };
    }
    return this.readStatus();
  }

  listPlatforms(): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("list_platforms", {});
  }

  listMarketplaceResearchPlatforms(): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("list_marketplace_research_platforms", {});
  }

  getMarketplaceOptions(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("get_marketplace_options", args);
  }

  searchEndpoints(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("search_endpoints", args);
  }

  getEndpointSchema(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("get_endpoint_schema", args);
  }

  preflightEndpoint(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("preflight_endpoint", args);
  }

  preflightSocialContentResearch(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("preflight_social_content_research", args);
  }

  preflightMarketplaceProductResearch(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("preflight_marketplace_product_research", args);
  }

  planMarketplaceProductResearch(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("plan_marketplace_product_research", args);
  }

  executeMarketplaceProductResearchPlan(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("execute_marketplace_product_research_plan", args);
  }

  beginMarketplaceProductResearch(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("begin_marketplace_product_research", args);
  }

  resolveMarketplaceProductBindings(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("resolve_marketplace_product_bindings", args);
  }

  completeMarketplaceProductResearch(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("complete_marketplace_product_research", args);
  }

  cancelMarketplaceProductResearch(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("cancel_marketplace_product_research", args);
  }

  getResearchResult(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("get_research_result", args);
  }

  searchBusinessData(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    return this.callCatalog("search_business_data", args);
  }

  async callEndpoint(args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    this.assertConfigured();
    await this.ensureConnected();
    try {
      return await this.callOnce("call_endpoint", args);
    } catch (error) {
      throw normalizeError(error, true);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.connecting = null;
    this.status = { ...this.status, connected: false };
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
  }

  private async callCatalog(name: string, args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    this.assertConfigured();
    await this.ensureConnected();
    try {
      return await this.callOnce(name, args);
    } catch (firstError) {
      await this.close();
      try {
        await this.ensureConnected();
        return await this.callOnce(name, args);
      } catch (secondError) {
        throw normalizeError(secondError, false, firstError);
      }
    }
  }

  private async callOnce(name: string, args: Record<string, unknown>): Promise<ExternalDataServiceToolResult> {
    if (!this.client) throw new ExternalDataServiceMcpError("SHUEHO external-data MCP is not connected.", "CONNECT_FAILED");
    if (this.status.tools.length && !this.status.tools.includes(name)) {
      throw new ExternalDataServiceMcpError(`SHUEHO external-data MCP tool ${name} is unavailable.`, "TOOL_UNAVAILABLE");
    }
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: this.config.timeoutMs, maxTotalTimeout: this.config.timeoutMs },
    );
    return parseResult(result, this.config.maxResultBytes);
  }

  private async ensureConnected(): Promise<void> {
    this.assertConfigured();
    if (this.client && this.transport) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const token = this.config.token;
    if (!token) throw new ExternalDataServiceMcpError("SHUEHO external-data MCP is not configured.", "NOT_CONFIGURED");
    const client = new Client({ name: "shueho-commerce-pilot", version: "0.1.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(this.config.url), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "SHUEHO-Commerce-Pilot/0.1",
        },
      },
    });
    transport.onclose = () => {
      if (this.transport !== transport) return;
      this.client = null;
      this.transport = null;
      this.status = { ...this.status, connected: false };
    };
    try {
      await client.connect(transport);
      const tools = await client.listTools(undefined, { timeout: 30_000, maxTotalTimeout: 30_000 });
      this.client = client;
      this.transport = transport;
      this.status = {
        configured: true,
        connected: true,
        tools: tools.tools.map((tool) => tool.name).sort(),
        checkedAt: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      throw new ExternalDataServiceMcpError(`Unable to connect to SHUEHO external-data MCP: ${safeMessage(error)}`, "CONNECT_FAILED");
    }
  }

  private assertConfigured(): void {
    if (!this.config.token) throw new ExternalDataServiceMcpError("SHUEHO external-data MCP is not configured.", "NOT_CONFIGURED");
  }
}

function parseResult(result: unknown, maximumBytes: number): ExternalDataServiceToolResult {
  if (!isRecord(result)) throw new ExternalDataServiceMcpError("MCP returned an invalid result.", "INVALID_RESULT");
  let payload = isRecord(result.structuredContent) ? result.structuredContent : null;
  if (!payload && Array.isArray(result.content)) {
    const text = result.content.filter(isRecord)
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string)
      .join("\n");
    if (text) {
      const parsed = JSON.parse(text) as unknown;
      payload = isRecord(parsed) ? parsed : { value: parsed };
    }
  }
  if (!payload) throw new ExternalDataServiceMcpError("MCP returned no structured payload.", "INVALID_RESULT");
  const resultBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (resultBytes > maximumBytes) {
    throw new ExternalDataServiceMcpError(`Curated MCP result exceeded ${maximumBytes} bytes.`, "RESULT_TOO_LARGE", true);
  }
  return { payload, resultBytes, isError: result.isError === true || payload.success === false };
}

function normalizeError(error: unknown, uncertain: boolean, previous?: unknown): ExternalDataServiceMcpError {
  if (error instanceof ExternalDataServiceMcpError) return error;
  const suffix = previous ? ` Previous attempt: ${safeMessage(previous)}` : "";
  return new ExternalDataServiceMcpError(`SHUEHO external-data MCP call failed: ${safeMessage(error)}.${suffix}`, "CALL_FAILED", uncertain);
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown error")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
