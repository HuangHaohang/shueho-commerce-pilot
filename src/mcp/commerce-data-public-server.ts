import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

import {
  ExternalDataControlClient,
  ExternalDataControlError,
  externalDataParameterKeys,
  hashExternalDataParameters,
  type AuthenticatedMcpPrincipal,
  type ExternalDataCatalogAuthorization,
} from "../integrations/external-data-control-client.js";
import {
  ExternalDataServiceMcpClient,
  ExternalDataServiceMcpError,
  type ExternalDataServiceToolResult,
} from "../integrations/external-data-service-mcp-client.js";
import { classifyExternalDataServiceOutcome } from "../integrations/external-data-outcome.js";
import {
  MarketplaceProductResearchPreflightError,
  preflightMarketplaceProductResearch,
  type MarketplaceProductResearchInput,
  type MarketplaceProductResearchPreflight,
} from "../integrations/marketplace-product-research-preflight.js";
import {
  preflightSocialContentResearch,
  SocialContentResearchPreflightError,
} from "../integrations/social-content-research-preflight.js";

const config = readConfig();
const upstream = new ExternalDataServiceMcpClient(config.externalDataService);
const control = new ExternalDataControlClient({
  controlUrl: config.controlUrl,
  mcpAuthUrl: config.authUrl,
  internalToken: config.internalToken,
});

if (upstream.configured && control.configured) await upstream.verify();

const httpServer = createServer(async (request, response) => {
  try {
    const requestHost = request.headers.host?.toLowerCase() || "";
    if (!requestHost || !config.allowedHosts.has(requestHost)) {
      sendJson(response, 421, jsonRpcError(-32002, "Unrecognized MCP host."));
      return;
    }
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.has(origin)) {
      sendJson(response, 403, jsonRpcError(-32003, "Origin is not allowed."));
      return;
    }
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      const upstreamStatus = upstream.readStatus();
      sendJson(response, upstreamStatus.connected && control.configured ? 200 : 503, {
        ok: upstreamStatus.connected && control.configured,
        service: "commerce-pilot-mcp",
        upstream: {
          service: "shueho-external-data",
          configured: upstreamStatus.configured,
          connected: upstreamStatus.connected,
          checkedAt: upstreamStatus.checkedAt,
          error: upstreamStatus.error,
        },
        businessTools: [
          "search_business_data",
          "get_marketplace_options",
          "get_research_result",
          "research_social_content",
          "research_marketplace_products",
        ],
        controlConfigured: control.configured,
      });
      return;
    }
    if (url.pathname !== "/mcp") {
      sendJson(response, 404, { error: "Not found." });
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      sendJson(response, 405, jsonRpcError(-32000, "Method not allowed."));
      return;
    }
    const token = readBearerToken(request);
    const principal = token ? await control.authenticateMcpToken(token) : null;
    if (!principal) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="Commerce Pilot MCP"');
      sendJson(response, 401, jsonRpcError(-32001, "Authentication required."));
      return;
    }
    const parsedBody = await readJsonBody(request, 1_048_576);
    const mcpServer = createCommerceDataMcpServer(principal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await mcpServer.connect(transport);
    response.on("close", () => {
      void transport.close().catch(() => undefined);
      void mcpServer.close().catch(() => undefined);
    });
    await transport.handleRequest(request, response, parsedBody);
  } catch (error) {
    if (response.headersSent) return;
    sendJson(response, 500, jsonRpcError(-32603, safeMessage(error)));
  }
});

httpServer.listen(config.port, config.host, () => {
  console.log(`Commerce Pilot MCP listening on http://${config.host}:${config.port}/mcp`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function createCommerceDataMcpServer(principal: AuthenticatedMcpPrincipal): McpServer {
  const server = new McpServer(
    { name: "shueho-commerce-data", version: "0.1.0" },
    {
      instructions:
        "Use search_business_data first when existing curated evidence may be sufficient. Before proposing marketplace scope, call list_marketplace_research_platforms and use only its exact database-returned platform ids and labels; then use get_marketplace_options for selected platforms and never guess a market/site. Use research_social_content for public social evidence and research_marketplace_products for marketplace product evidence; supply business-level constraints only because SHUEHO selects and validates provider endpoints internally. Complete REST responses stay in the SQL warehouse and only curated evidence is returned. Paid research must never be retried after an uncertain result. This server cannot reveal provider credentials, provider endpoint controls or raw warehouse rows.",
    },
  );
  if (principal.scopes.includes("external_data.catalog.read")) {
    server.registerTool(
      "search_business_data",
      {
        title: "检索已治理业务数据",
        description: "通过 BM25、pgvector 和本机 Qwen3 Reranker 检索工作区既有业务证据，不产生供应商费用。",
        inputSchema: {
          query: z.string().min(1).max(4_096),
          limit: z.number().int().min(1).max(20).default(10),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ query, limit }) => {
        await control.authorizeCatalog(principal);
        const result = await upstream.searchBusinessData({
          query,
          limit,
          _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
        });
        return toolSuccess(result.payload);
      },
    );

    server.registerTool(
      "list_marketplace_research_platforms",
      {
        title: "列出可用商品研究平台",
        description: "读取数据库中当前具有完整关键词商品研究工作流的平台。平台选择只能来自该结果；不调用供应商且不产生费用。",
        inputSchema: {},
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => {
        await control.authorizeCatalog(principal);
        const result = await upstream.listMarketplaceResearchPlatforms();
        return toolSuccess(result.payload);
      },
    );

    server.registerTool(
      "get_marketplace_options",
      {
        title: "读取电商平台站点选项",
        description: "读取一个目录内平台的当前市场/站点选项；不存在的工作流返回 available=false，不调用供应商且不产生费用。",
        inputSchema: { platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/) },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ platform }) => {
        await control.authorizeCatalog(principal);
        const result = await upstream.getMarketplaceOptions({ platform });
        return toolSuccess(result.payload);
      },
    );
    server.registerTool(
      "get_research_result",
      {
        title: "读取已治理研究结果",
        description: "读取业务研究工具返回的研究请求结果，不返回原始仓内容。",
        inputSchema: { research_request_id: z.string().uuid() },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ research_request_id }) => {
        await control.authorizeCatalog(principal);
        const result = await upstream.getResearchResult({
          research_request_id,
          _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
        });
        return toolSuccess(result.payload);
      },
    );
  }

  if (principal.scopes.includes("external_data.call")) {
    server.registerTool(
      "research_social_content",
      {
        title: "研究公开社交内容（可能计费）",
        description:
          "按平台、关键词、日期和业务目标研究公开社交内容。SHUEHO 在内部选择并校验供应商接口，完整原始结果入库，MCP 只返回质量合格的业务证据。",
        inputSchema: {
          platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/),
          keyword: z.string().min(1).max(500),
          start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          objective: z.enum(["latest_content", "interaction_ranked"]),
          requested_metrics: z.array(z.enum(["views", "likes", "comments", "shares", "interactions"])).max(5),
          max_results: z.number().int().min(1).max(100),
          research_request: z.string().min(1).max(50_000),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ platform, keyword, start_date, end_date, objective, requested_metrics, max_results, research_request }) => {
        const authorization = await control.authorizeCatalog(principal);
        let preflight;
        try {
          preflight = await preflightSocialContentResearch(upstream, {
            platform,
            keyword,
            start_date,
            end_date,
            objective,
            requested_metrics,
            max_results,
          }, authorization);
        } catch (error) {
          return toolError(
            error instanceof SocialContentResearchPreflightError ? error.code : "SOCIAL_RESEARCH_PREFLIGHT_FAILED",
            error instanceof Error ? error.message : "社交内容研究请求无法匹配当前数据能力。",
            { providerDispatched: false },
          );
        }
        return executePublicResearch(principal, {
          businessTool: "research_social_content",
          preflight,
          researchRequest: research_request,
          maxResults: max_results,
        });
      },
    );
    server.registerTool(
      "research_marketplace_products",
      {
        title: "研究公开电商商品（可能计费）",
        description:
          "按平台、关键词、价格范围和指标研究公开商品数据。SHUEHO 在内部选择并校验供应商接口，完整原始列表入库，MCP 只返回质量合格的商品、品牌、属性和聚合证据。",
        inputSchema: {
          platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/),
          keyword: z.string().min(1).max(500),
          localized_keyword: z.string().min(1).max(500).nullable().default(null),
          market: z.string().regex(/^[A-Za-z0-9_-]{2,32}$/).nullable().default(null),
          tmall_only: z.boolean(),
          min_price_yuan: z.number().nonnegative().nullable(),
          max_price_yuan: z.number().nonnegative().nullable(),
          requested_metrics: z.array(z.enum(["price_band", "sales_level", "brand_competition", "property_distribution"])).min(1).max(4),
          max_results: z.number().int().min(1).max(100),
          research_request: z.string().min(1).max(50_000),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({
        platform, keyword, localized_keyword, market, tmall_only, min_price_yuan, max_price_yuan,
        requested_metrics, max_results, research_request,
      }) => {
        const authorization = await control.authorizeCatalog(principal);
        let preflight;
        try {
          preflight = await preflightMarketplaceProductResearch(upstream, {
            platform,
            keyword,
            localized_keyword,
            market,
            tmall_only,
            min_price_yuan,
            max_price_yuan,
            requested_metrics,
            max_results,
          }, authorization);
        } catch (error) {
          return toolError(
            error instanceof MarketplaceProductResearchPreflightError ? error.code : "MARKETPLACE_RESEARCH_PREFLIGHT_FAILED",
            error instanceof Error ? error.message : "商品研究请求无法匹配当前数据能力。",
            { providerDispatched: false },
          );
        }
        return executePublicMarketplaceResearch(principal, {
          preflight,
          businessInput: {
            platform,
            keyword,
            localized_keyword,
            market,
            tmall_only,
            min_price_yuan,
            max_price_yuan,
            requested_metrics,
            max_results,
          },
          researchRequest: research_request,
        });
      },
    );
  }
  return server;
}

async function executePublicMarketplaceResearch(
  principal: AuthenticatedMcpPrincipal,
  input: {
    preflight: MarketplaceProductResearchPreflight;
    businessInput: MarketplaceProductResearchInput;
    researchRequest: string;
  },
) {
  const rootCallId = `mcp_${crypto.randomUUID().replaceAll("-", "")}`;
  const businessIntent = {
    ...input.preflight.businessIntent,
    workflow_plan_key: input.preflight.planKey,
  };
  const began = await upstream.beginMarketplaceProductResearch({
    ...input.businessInput,
    workflow_id: input.preflight.workflowId,
    research_plan_key: input.preflight.planKey,
    _commerce_context: {
      tenant_id: principal.tenantId,
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      source: "external_mcp",
      source_call_id: rootCallId,
      request_text: input.researchRequest,
      top_n: input.businessInput.max_results,
      business_intent: businessIntent,
    },
  });
  const executionId = typeof began.payload.workflow_execution_id === "string"
    ? began.payload.workflow_execution_id
    : "";
  if (began.payload.success !== true || !/^[a-f0-9-]{36}$/.test(executionId)) {
    return toolError(
      typeof began.payload.code === "string" ? began.payload.code : "WORKFLOW_BEGIN_FAILED",
      typeof began.payload.message === "string" ? began.payload.message : "Marketplace workflow could not be started.",
      { providerDispatched: false },
    );
  }
  let bindings: Record<string, string | number> = {};
  for (const step of input.preflight.steps) {
    if (Object.keys(step.dynamicParameterBindings).length && !Object.keys(bindings).length) {
      const resolved = await upstream.resolveMarketplaceProductBindings({
        workflow_execution_id: executionId,
        _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
      });
      if (resolved.payload.success !== true || !isRecord(resolved.payload.bindings)) {
        const partial = await upstream.completeMarketplaceProductResearch({
          workflow_execution_id: executionId,
          _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
        });
        return toolError(
          typeof resolved.payload.code === "string" ? resolved.payload.code : "WORKFLOW_BINDING_UNAVAILABLE",
          typeof resolved.payload.message === "string" ? resolved.payload.message : "No quality-checked product identifier was available.",
          partial.payload,
        );
      }
      bindings = readPublicWorkflowBindings(resolved.payload.bindings);
    }
    const params = structuredClone(step.parameterTemplate);
    for (const [parameter, bindingName] of Object.entries(step.dynamicParameterBindings)) {
      const value = bindings[bindingName];
      if (value === undefined) {
        return toolError("WORKFLOW_BINDING_UNAVAILABLE", `Missing workflow binding ${bindingName}.`, { providerDispatched: false });
      }
      params[parameter] = value;
    }
    const endpointPreflight = await upstream.preflightEndpoint({ endpoint_id: step.endpointId, params });
    if (endpointPreflight.payload.success !== true || !isRecord(endpointPreflight.payload.normalized_params)) {
      return toolError(
        "WORKFLOW_STEP_PREFLIGHT_FAILED",
        typeof endpointPreflight.payload.message === "string" ? endpointPreflight.payload.message : "Workflow step parameters were rejected.",
        { providerDispatched: false, role: step.role },
      );
    }
    const normalizedParams = endpointPreflight.payload.normalized_params;
    const authorization = await control.authorizeCatalog(principal);
    assertEndpointAllowed(step.endpointId, authorization);
    const callId = `${rootCallId}_${step.stepOrder}`;
    const reservation = await control.reserve(principal, {
      source: "external_mcp",
      callId,
      endpointId: step.endpointId,
      platform: step.catalogPlatform,
      parameterHash: hashExternalDataParameters(normalizedParams),
      parameterKeys: externalDataParameterKeys(normalizedParams),
      requestedApprovalMode: "policy",
    });
    if (reservation.requiresApproval) {
      await control.cancel(principal, reservation.reservationId, "approval_required");
      await upstream.cancelMarketplaceProductResearch({
        workflow_execution_id: executionId,
        reason: `Policy requires approval for ${step.role}.`,
        _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
      }).catch(() => undefined);
      return toolError(
        "APPROVAL_REQUIRED",
        "Workspace policy requires human approval for a workflow step. Use the Commerce Pilot web workbench; this MCP server will not bypass it.",
        {
          role: step.role,
          pricingStatus: reservation.pricingStatus,
          currency: reservation.currency,
          billableAmountMicros: reservation.billableAmountMicros,
        },
      );
    }
    await control.dispatch(principal, reservation.reservationId, {
      endpoint_id: step.endpointId,
      params: normalizedParams,
      workflow_execution_id: executionId,
      workflow_step_id: step.stepId,
    });
    let result: ExternalDataServiceToolResult;
    try {
      result = await upstream.callEndpoint({
        endpoint_id: step.endpointId,
        params: normalizedParams,
        _commerce_context: {
          tenant_id: principal.tenantId,
          workspace_id: principal.workspaceId,
          user_id: principal.userId,
          source: "external_mcp",
          source_call_id: callId,
          request_text: input.researchRequest,
          top_n: input.businessInput.max_results,
          workflow_execution_id: executionId,
          workflow_step_id: step.stepId,
          business_intent: {
            ...businessIntent,
            workflow_step_id: step.stepId,
            workflow_step_role: step.role,
          },
        },
      });
    } catch (error) {
      const normalized = error instanceof ExternalDataServiceMcpError
        ? error
        : new ExternalDataServiceMcpError("SHUEHO external-data workflow step failed.", "CALL_FAILED", true);
      await control.settle(principal, reservation.reservationId, {
        state: "unknown",
        upstreamCode: null,
        upstreamMessage: normalized.message,
        resultBytes: null,
        responsePayload: null,
      }).catch(() => undefined);
      return toolError("UPSTREAM_RESULT_UNKNOWN", normalized.message, { role: step.role });
    }
    const outcome = classifyExternalDataServiceOutcome(result.payload, result.isError);
    await control.settle(principal, reservation.reservationId, {
      state: outcome.settlementState,
      upstreamCode: outcome.upstreamCode,
      upstreamMessage: typeof result.payload.message === "string" ? result.payload.message : null,
      resultBytes: result.resultBytes,
      responsePayload: result.payload,
    });
    if (!outcome.businessUsable) {
      const partial = await upstream.completeMarketplaceProductResearch({
        workflow_execution_id: executionId,
        _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
      });
      return toolError(
        outcome.providerCompleted ? "WAREHOUSE_PROCESSING_FAILED" : "UPSTREAM_BUSINESS_ERROR",
        typeof result.payload.message === "string" ? result.payload.message : "Marketplace workflow step failed.",
        partial.payload,
      );
    }
  }
  const completed = await upstream.completeMarketplaceProductResearch({
    workflow_execution_id: executionId,
    _commerce_context: { tenant_id: principal.tenantId, workspace_id: principal.workspaceId },
  });
  return completed.payload.success === true
    ? toolSuccess({ ...completed.payload, business_tool: "research_marketplace_products" })
    : toolError("WORKFLOW_INCOMPLETE", "Marketplace workflow did not complete all required steps.", completed.payload);
}

async function executePublicResearch(
  principal: AuthenticatedMcpPrincipal,
  input: {
    businessTool: "research_social_content";
    preflight: {
      endpointId: string;
      catalogPlatform: string;
      normalizedParams: Record<string, unknown>;
      businessIntent: Record<string, unknown>;
      coverage: Record<string, unknown>;
    };
    researchRequest: string;
    maxResults: number;
  },
) {
  const { endpointId, normalizedParams } = input.preflight;
  const currentAuthorization = await control.authorizeCatalog(principal);
  assertEndpointAllowed(endpointId, currentAuthorization);
  const callId = `mcp_${crypto.randomUUID().replaceAll("-", "")}`;
  const reservation = await control.reserve(principal, {
    source: "external_mcp",
    callId,
    endpointId,
    platform: input.preflight.catalogPlatform,
    parameterHash: hashExternalDataParameters(normalizedParams),
    parameterKeys: externalDataParameterKeys(normalizedParams),
    requestedApprovalMode: "policy",
  });
  if (reservation.requiresApproval) {
    await control.cancel(principal, reservation.reservationId, "approval_required");
    return toolError(
      "APPROVAL_REQUIRED",
      "Workspace policy requires human approval. Use the Commerce Pilot web workbench or ask an administrator to configure a priced policy allowance; this MCP server will not bypass it.",
      {
        pricingStatus: reservation.pricingStatus,
        currency: reservation.currency,
        billableAmountMicros: reservation.billableAmountMicros,
      },
    );
  }
  await control.dispatch(principal, reservation.reservationId, {
    endpoint_id: endpointId,
    params: normalizedParams,
  });
  let result: ExternalDataServiceToolResult;
  try {
    result = await upstream.callEndpoint({
      endpoint_id: endpointId,
      params: normalizedParams,
      _commerce_context: {
        tenant_id: principal.tenantId,
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        source: "external_mcp",
        source_call_id: callId,
        request_text: input.researchRequest,
        top_n: input.maxResults,
        business_intent: input.preflight.businessIntent,
      },
    });
  } catch (error) {
    const normalized = error instanceof ExternalDataServiceMcpError
      ? error
      : new ExternalDataServiceMcpError("SHUEHO external-data MCP call failed.", "CALL_FAILED", true);
    let reconciliationPending = false;
    try {
      await control.settle(principal, reservation.reservationId, {
        state: "unknown",
        upstreamCode: null,
        upstreamMessage: normalized.message,
        resultBytes: null,
        responsePayload: null,
      });
    } catch {
      reconciliationPending = true;
    }
    return toolError(
      "UPSTREAM_RESULT_UNKNOWN",
      "The paid upstream result is uncertain and was not retried. Review Commerce Pilot audit and billing reconciliation before another call.",
      { reconciliationPending },
    );
  }
  const { upstreamCode, providerCompleted, businessUsable, settlementState } =
    classifyExternalDataServiceOutcome(result.payload, result.isError);
  await control.settle(principal, reservation.reservationId, {
    state: settlementState,
    upstreamCode,
    upstreamMessage: typeof result.payload.message === "string" ? result.payload.message : null,
    resultBytes: result.resultBytes,
    responsePayload: result.payload,
  });
  return businessUsable
    ? toolSuccess({
        ...result.payload,
        business_tool: input.businessTool,
        research_plan: input.preflight.coverage,
        _commercePilot: {
          callId,
          pricingStatus: reservation.pricingStatus,
          currency: reservation.currency,
          billableAmountMicros: reservation.billableAmountMicros,
        },
      })
    : toolError(
        providerCompleted ? "WAREHOUSE_PROCESSING_FAILED" : "UPSTREAM_BUSINESS_ERROR",
        providerCompleted
          ? "The paid provider call completed and raw data was archived, but processing did not produce usable business evidence. It was not retried."
          : "The upstream business request did not succeed.",
        result.payload,
      );
}

function toolSuccess(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function toolError(code: string, message: string, details: Record<string, unknown> = {}) {
  const payload = { success: false, error: { code, message, details } };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function assertEndpointAllowed(
  endpointId: string,
  authorization: ExternalDataCatalogAuthorization,
): void {
  const platform = endpointPlatform(endpointId);
  if (!authorization.allowedPlatforms.includes(platform)) {
    throw new ExternalDataControlError(`Platform ${platform} is not enabled.`, "PLATFORM_DENIED", 403);
  }
  if (authorization.allowedEndpointIds.length && !authorization.allowedEndpointIds.includes(endpointId)) {
    throw new ExternalDataControlError(`Endpoint ${endpointId} is not enabled.`, "ENDPOINT_DENIED", 403);
  }
}

function endpointPlatform(endpointId: string): string {
  return endpointId.slice(0, endpointId.indexOf("."));
}

function readPublicWorkflowBindings(value: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number] =>
    (typeof entry[1] === "string" && entry[1].length <= 500) ||
    (typeof entry[1] === "number" && Number.isSafeInteger(entry[1]))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readBearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length <= 256 ? token : null;
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString("utf8");
    if (Buffer.byteLength(raw, "utf8") > maximumBytes) throw new Error("MCP request body is too large.");
  }
  return raw ? JSON.parse(raw) : null;
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

function readConfig() {
  const url = new URL(process.env.EXTERNAL_DATA_SERVICE_MCP_URL || "http://127.0.0.1:8791/mcp");
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
    throw new Error("EXTERNAL_DATA_SERVICE_MCP_URL must use HTTPS outside local development.");
  }
  const host = process.env.COMMERCE_PUBLIC_MCP_HOST || "127.0.0.1";
  const port = parsePort(process.env.COMMERCE_PUBLIC_MCP_PORT || "8790");
  const internalToken = process.env.COMMERCE_GATEWAY_INTERNAL_TOKEN;
  if (process.env.NODE_ENV === "production" && (!internalToken || internalToken.length < 32)) {
    throw new Error("COMMERCE_GATEWAY_INTERNAL_TOKEN must contain at least 32 characters in production.");
  }
  const allowedHosts = new Set(
    (process.env.COMMERCE_PUBLIC_MCP_ALLOWED_HOSTS || `127.0.0.1:${port},localhost:${port}`)
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const allowedOrigins = new Set(
    (process.env.COMMERCE_PUBLIC_MCP_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (process.env.NODE_ENV === "production" && !process.env.COMMERCE_PUBLIC_MCP_ALLOWED_HOSTS) {
    throw new Error("COMMERCE_PUBLIC_MCP_ALLOWED_HOSTS is required in production.");
  }
  return {
    host,
    port,
    internalToken,
    allowedHosts,
    allowedOrigins,
    controlUrl:
      process.env.COMMERCE_EXTERNAL_DATA_CONTROL_URL ||
      "http://127.0.0.1:3000/api/internal/external-data",
    authUrl:
      process.env.COMMERCE_MCP_AUTH_URL ||
      "http://127.0.0.1:3000/api/internal/mcp-auth",
    externalDataService: {
      url: url.toString(),
      token: process.env.EXTERNAL_DATA_SERVICE_MCP_TOKEN?.trim() || undefined,
      timeoutMs: parseInteger(process.env.EXTERNAL_DATA_SERVICE_MCP_TIMEOUT_MS || "300000", 60_000, 300_000),
      maxResultBytes: parseInteger(process.env.EXTERNAL_DATA_SERVICE_MCP_MAX_RESULT_BYTES || "1048576", 65_536, 2_097_152),
    },
  };
}

function parsePort(value: string): number {
  return parseInteger(value, 1, 65_535);
}

function parseInteger(value: string, minimum: number, maximum: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid numeric configuration: ${value}`);
  }
  return parsed;
}

function safeMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [REDACTED]").slice(0, 500)
    : "Internal MCP error.";
}


let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await upstream.close();
  httpServer.close(() => process.exit(0));
}
