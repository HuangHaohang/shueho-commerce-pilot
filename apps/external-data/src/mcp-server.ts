import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getEndpoint, listPlatforms, searchEndpoints } from "./endpoint-registry.js";
import { hybridBusinessSearch } from "./hybrid-search.js";
import { JustOneApiRestError } from "./justoneapi-rest-client.js";
import { LocalModelError } from "./local-model-client.js";
import { readMarketplaceOptions, readMarketplaceResearchPlatforms } from "./market-options.js";
import {
  MarketplaceResearchPlanningError,
  planMarketplaceProductResearch,
} from "./marketplace-research-planner.js";
import {
  loadExecutableMarketplaceResearchPlan,
  MarketplaceResearchPlanError,
  persistMarketplaceResearchPlan,
} from "./marketplace-research-plan-store.js";
import {
  beginMarketplaceWorkflowExecution,
  cancelMarketplaceWorkflowExecution,
  completeMarketplaceWorkflowExecution,
  completeMarketplaceWorkflowStep,
  failMarketplaceWorkflowStep,
  loadWorkflowOrResearchResult,
  markMarketplaceWorkflowStepUnknown,
  resolveMarketplaceWorkflowBindings,
  startMarketplaceWorkflowStep,
  WorkflowExecutionError,
} from "./marketplace-workflow-execution.js";
import { ExternalDataPipeline } from "./pipeline.js";
import {
  planSocialContentResearch,
  SocialResearchPlanningError,
} from "./social-research-planner.js";
import type { ExternalDataScope, JsonObject } from "./types.js";

const businessIntentSchema = z.object({
  kind: z.string().min(1).max(100),
  platform: z.string().min(1).max(64),
  target_product: z.string().min(1).max(500).nullable(),
  objective: z.string().min(1).max(100).nullable(),
  requested_metrics: z.array(z.string().min(1).max(100)).max(20),
  time_range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1).max(100),
  }).nullable(),
  window_enforcement: z.string().min(1).max(100).nullable(),
  requested_top_n: z.number().int().min(1).max(500).nullable(),
  workflow_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_.-]+$/).max(180).nullable().optional(),
  workflow_version: z.string().min(1).max(40).nullable().optional(),
  workflow_plan_key: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  workflow_step_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).nullable().optional(),
  workflow_step_instance_id: z.string().uuid().nullable().optional(),
  workflow_target_id: z.string().uuid().nullable().optional(),
  workflow_step_role: z.enum(["discovery", "detail", "price", "reviews", "sku"]).nullable().optional(),
  localized_keyword: z.string().min(1).max(500).nullable().optional(),
  localized_keywords: z.array(z.string().min(1).max(500)).max(8).optional(),
  market_context: z.record(z.unknown()).nullable().optional(),
  quality_policy: z.record(z.unknown()).nullable().optional(),
});

const scopeSchema = z.object({
  tenant_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  user_id: z.string().min(1).max(255),
  source: z.enum(["codex_harness", "external_mcp", "archive_import"]),
  source_call_id: z.string().min(8).max(160),
  root_thread_id: z.string().min(8).max(160).nullable().optional(),
  thread_id: z.string().min(8).max(160).nullable().optional(),
  turn_id: z.string().min(8).max(160).nullable().optional(),
  request_text: z.string().min(1).max(50_000),
  top_n: z.number().int().min(1).max(500).default(50),
  business_intent: businessIntentSchema.nullable().optional(),
  workflow_execution_id: z.string().uuid().nullable().optional(),
  workflow_step_id: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/).nullable().optional(),
  workflow_step_instance_id: z.string().uuid().nullable().optional(),
  workflow_target_id: z.string().uuid().nullable().optional(),
});

export function createExternalDataMcpServer(pipeline = new ExternalDataPipeline()): McpServer {
  const server = new McpServer(
    { name: "shueho-external-data", version: "0.1.0" },
    {
      instructions:
        "This is the internal SHUEHO external-data service. It stores complete JustOneAPI REST responses, normalizes every field and returns only curated evidence. Marketplace scope and query language come from database catalogs. New collection uses plan_marketplace_product_research followed by execute_marketplace_product_research_plan; every target step remains separately governed by Commerce Pilot. Never expose credentials or retry an uncertain paid call.",
    },
  );
  server.registerTool(
    "list_platforms",
    {
      title: "列出外部数据平台",
      description: "列出 SHUEHO 数据服务已登记的平台和接口数量。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolSuccess({ success: true, platforms: await listPlatforms() }),
  );
  server.registerTool(
    "list_marketplace_research_platforms",
    {
      title: "列出可用商品研究平台",
      description: "从数据库有效业务工作流列出当前真正支持关键词商品研究的平台；不调用供应商，也不产生费用。Agent 必须先读取此目录，不能自行补充平台。",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => toolSuccess({
      success: true,
      ...(await readMarketplaceResearchPlatforms()),
    }),
  );
  server.registerTool(
    "get_marketplace_options",
    {
      title: "读取电商平台市场选项",
      description: "读取平台国家/站点与查询语言元数据；不返回内部质量阈值或代表样本上限，不调用供应商，也不产生费用。",
      inputSchema: {
        platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ platform }) => toolSuccess({
      success: true,
      ...(await readMarketplaceOptions(platform)),
    }),
  );
  server.registerTool(
    "search_endpoints",
    {
      title: "搜索外部数据能力",
      description: "在 SHUEHO 自有接口目录中按能力搜索允许调用的 JustOneAPI REST 接口。",
      inputSchema: {
        query: z.string().min(1).max(500),
        platform: z.string().regex(/^[a-z0-9_]+$/).max(64).optional(),
        limit: z.number().int().min(1).max(20).default(8),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, platform, limit }) => {
      const endpoints = await searchEndpoints({ query, platform, limit });
      return toolSuccess({
        success: true,
        results: endpoints.map((endpoint) => ({
          endpoint_id: endpoint.endpointId,
          platform: endpoint.platformId,
          name: endpoint.displayName,
          capability: endpoint.capability,
          api_path: endpoint.apiPath,
          method: endpoint.httpMethod,
          response_family: endpoint.responseFamily,
        })),
      });
    },
  );
  server.registerTool(
    "get_endpoint_schema",
    {
      title: "读取外部数据接口定义",
      description: "读取 SHUEHO 数据服务登记的参数 Schema；Token 永远不是工具参数。",
      inputSchema: { endpoint_id: z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/).max(180) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ endpoint_id }) => {
      const endpoint = await getEndpoint(endpoint_id);
      return toolSuccess({
        success: true,
        endpoint_id: endpoint.endpointId,
        platform: endpoint.platformId,
        api_path: endpoint.apiPath,
        method: endpoint.httpMethod,
        schema_version: endpoint.schemaVersion,
        input_schema: endpoint.requestSchema,
        documentation_url: endpoint.documentationUrl,
        openapi_url: endpoint.openapiUrl,
        response_family: endpoint.responseFamily,
        normalizer_version: endpoint.normalizerVersion,
        pricing_status: endpoint.pricingStatus,
      });
    },
  );
  server.registerTool(
    "plan_marketplace_product_research",
    {
      title: "建立版本化商品研究计划",
      description: "免费校验平台、市场语言档案、业务筛选和代表样本规模，持久化绑定目录版本的计划；不调用供应商，也不产生费用。",
      inputSchema: {
        platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/),
        keyword: z.string().min(1).max(500),
        localized_keywords: z.array(z.string().min(1).max(500)).max(8).default([]),
        market: z.string().regex(/^[A-Za-z0-9_-]{2,32}$/).nullable().default(null),
        tmall_only: z.boolean(),
        min_price_yuan: z.number().nonnegative().nullable(),
        max_price_yuan: z.number().nonnegative().nullable(),
        requested_metrics: z.array(z.enum(["price_band", "sales_level", "brand_competition", "property_distribution"])).min(1).max(4),
        max_results: z.number().int().min(1).max(100),
        detail_sample_size: z.number().int().min(1).max(10).nullable().default(null),
        allowed_catalog_platforms: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(100).optional(),
        allowed_endpoint_ids: z.array(z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/)).max(500).optional(),
        _commerce_context: scopeSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({
      platform,keyword,localized_keywords,market,tmall_only,min_price_yuan,max_price_yuan,
      requested_metrics,max_results,detail_sample_size,allowed_catalog_platforms,
      allowed_endpoint_ids,_commerce_context,
    }) => {
      const request = {
        platform,
        keyword,
        localizedKeyword: localized_keywords[0] ?? null,
        localizedKeywords: localized_keywords,
        market,
        tmallOnly: tmall_only,
        minPriceYuan: min_price_yuan,
        maxPriceYuan: max_price_yuan,
        requestedMetrics: requested_metrics,
        maxResults: max_results,
        detailSampleSize: detail_sample_size,
      };
      try {
        const plan = await planMarketplaceProductResearch(request, {
          allowedCatalogPlatforms: allowed_catalog_platforms,
          allowedEndpointIds: allowed_endpoint_ids,
        });
        const persisted = await persistMarketplaceResearchPlan(mapScope(_commerce_context), request, plan);
        return toolSuccess({
          success: true,
          state: "ready",
          business_tool: "execute_marketplace_research",
          plan_id: persisted.planId,
          request_text: _commerce_context.request_text,
          research_plan_key: persisted.planKey,
          expires_at: persisted.expiresAt,
          workflow_id: plan.workflow.workflowId,
          workflow_version: plan.workflow.workflowVersion,
          market_context: persisted.marketContext,
          detail_sample_size: persisted.detailSampleSize,
          estimated_provider_calls: persisted.estimatedProviderCalls,
          business_input: plan.businessInput,
          business_intent: plan.businessIntent,
          coverage: plan.coverage,
          steps: plan.steps.map((step) => ({
            step_id: step.stepId,
            step_order: step.stepOrder,
            role: step.role,
            endpoint_id: step.endpoint.endpointId,
            platform: step.endpoint.platformId,
            parameter_template: step.parameterTemplate,
            dynamic_parameter_bindings: step.dynamicParameterBindings,
            output_bindings: step.outputBindings,
            required: step.required,
          })),
        });
      } catch (error) {
        return toolSuccess({
          success: false,
          state: "needs_input",
          provider_completed: false,
          processing_state: "planning_failed",
          code: error instanceof MarketplaceResearchPlanningError || error instanceof MarketplaceResearchPlanError
            ? error.code
            : "MARKETPLACE_RESEARCH_PLAN_FAILED",
          message: safeToolMessage(error),
          details: error instanceof MarketplaceResearchPlanningError ? error.details : {},
        });
      }
    },
  );
  server.registerTool(
    "execute_marketplace_product_research_plan",
    {
      title: "执行已固定商品研究计划",
      description: "加载未过期且绑定当前租户、目录、市场档案和工作流版本的计划并建立执行；实际供应商步骤仍分别审批、预留、调用和结算。",
      inputSchema: {
        plan_id: z.string().uuid(),
        allowed_catalog_platforms: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(100).optional(),
        allowed_endpoint_ids: z.array(z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/)).max(500).optional(),
        _commerce_context: scopeSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ plan_id,allowed_catalog_platforms,allowed_endpoint_ids,_commerce_context }) => {
      try {
        const scope = mapScope(_commerce_context);
        const loaded = await loadExecutableMarketplaceResearchPlan(scope, plan_id, {
          allowedCatalogPlatforms: allowed_catalog_platforms,
          allowedEndpointIds: allowed_endpoint_ids,
        });
        const executionScope = {
          ...scope,
          requestText: loaded.stored.request_text,
          topN: loaded.plan.businessIntent.requested_top_n as number,
        };
        const began = await beginMarketplaceWorkflowExecution(executionScope, loaded.plan, { researchPlanId: plan_id });
        return toolSuccess({
          success: true,
          plan_id,
          request_text: loaded.stored.request_text,
          expires_at: loaded.stored.expires_at.toISOString(),
          ...began,
          workflow_id: loaded.plan.workflow.workflowId,
          workflow_version: loaded.plan.workflow.workflowVersion,
          research_plan_key: loaded.plan.planKey,
          business_input: loaded.plan.businessInput,
          business_intent: loaded.plan.businessIntent,
          coverage: loaded.plan.coverage,
          market_context: loaded.plan.marketContext,
          detail_sample_size: loaded.plan.detailSampleSize,
          estimated_provider_calls: loaded.plan.estimatedProviderCalls,
          steps: loaded.plan.steps.map((step) => ({
            step_id: step.stepId,
            step_order: step.stepOrder,
            role: step.role,
            endpoint_id: step.endpoint.endpointId,
            platform: step.endpoint.platformId,
            parameter_template: step.parameterTemplate,
            dynamic_parameter_bindings: step.dynamicParameterBindings,
            output_bindings: step.outputBindings,
            required: step.required,
          })),
        });
      } catch (error) {
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "plan_execution_failed",
          code: error instanceof MarketplaceResearchPlanError || error instanceof WorkflowExecutionError
            ? error.code
            : "MARKETPLACE_PLAN_EXECUTION_FAILED",
          message: safeToolMessage(error),
        });
      }
    },
  );
  server.registerTool(
    "preflight_marketplace_product_research",
    {
      title: "规划电商商品研究",
      description: "根据商品研究目标从数据库接口目录中确定性选择能力匹配的端点，并在任何预留、审批或付费调用前返回标准化执行计划。",
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
        allowed_catalog_platforms: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(100).optional(),
        allowed_endpoint_ids: z.array(z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/)).max(500).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({
      platform, keyword, localized_keyword, market, tmall_only, min_price_yuan, max_price_yuan, requested_metrics, max_results,
      allowed_catalog_platforms, allowed_endpoint_ids,
    }) => {
      try {
        const plan = await planMarketplaceProductResearch({
          platform,
          keyword,
          localizedKeyword: localized_keyword,
          market,
          tmallOnly: tmall_only,
          minPriceYuan: min_price_yuan,
          maxPriceYuan: max_price_yuan,
          requestedMetrics: requested_metrics,
          maxResults: max_results,
        }, {
          allowedCatalogPlatforms: allowed_catalog_platforms,
          allowedEndpointIds: allowed_endpoint_ids,
        });
        return toolSuccess({
          success: true,
          business_tool: "research_marketplace_products",
          workflow_id: plan.workflow.workflowId,
          workflow_version: plan.workflow.workflowVersion,
          research_plan_key: plan.planKey,
          business_input: plan.businessInput,
          business_intent: plan.businessIntent,
          coverage: plan.coverage,
          steps: plan.steps.map((step) => ({
            step_id: step.stepId,
            step_order: step.stepOrder,
            role: step.role,
            endpoint_id: step.endpoint.endpointId,
            platform: step.endpoint.platformId,
            parameter_template: step.parameterTemplate,
            dynamic_parameter_bindings: step.dynamicParameterBindings,
            output_bindings: step.outputBindings,
            required: step.required,
          })),
        });
      } catch (error) {
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "preflight_failed",
          code: error instanceof MarketplaceResearchPlanningError ? error.code : "MARKETPLACE_RESEARCH_PREFLIGHT_FAILED",
          message: safeToolMessage(error),
          details: error instanceof MarketplaceResearchPlanningError ? error.details : {},
        });
      }
    },
  );
  server.registerTool(
    "begin_marketplace_product_research",
    {
      title: "建立关键词商品研究执行",
      description: "将已预检的数据库工作流绑定到一次 Commerce Pilot 业务调用；本工具不调用供应商，也不产生供应商费用。",
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
        workflow_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_.-]+$/).max(180),
        research_plan_key: z.string().regex(/^[a-f0-9]{64}$/),
        _commerce_context: scopeSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({
      platform, keyword, localized_keyword, market, tmall_only, min_price_yuan, max_price_yuan,
      requested_metrics, max_results, workflow_id, research_plan_key, _commerce_context,
    }) => {
      try {
        const plan = await planMarketplaceProductResearch({
          platform,
          keyword,
          localizedKeyword: localized_keyword,
          market,
          tmallOnly: tmall_only,
          minPriceYuan: min_price_yuan,
          maxPriceYuan: max_price_yuan,
          requestedMetrics: requested_metrics,
          maxResults: max_results,
        });
        if (plan.workflow.workflowId !== workflow_id || plan.planKey !== research_plan_key) {
          throw new WorkflowExecutionError("Marketplace workflow plan changed after preflight.", "WORKFLOW_PLAN_MISMATCH");
        }
        return toolSuccess({
          success: true,
          ...(await beginMarketplaceWorkflowExecution(mapScope(_commerce_context), plan)),
        });
      } catch (error) {
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "workflow_begin_failed",
          code: error instanceof WorkflowExecutionError ? error.code : "WORKFLOW_BEGIN_FAILED",
          message: safeToolMessage(error),
        });
      }
    },
  );
  server.registerTool(
    "resolve_marketplace_product_bindings",
    {
      title: "解析商品工作流标识",
      description: "仅从质量通过的搜索业务记录中解析下游商品标识并保存 SQL 绑定证据；不返回原始响应。",
      inputSchema: {
        workflow_execution_id: z.string().uuid(),
        _commerce_context: scopeSchema.pick({ tenant_id: true, workspace_id: true }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workflow_execution_id, _commerce_context }) => {
      try {
        return toolSuccess({
          success: true,
          ...(await resolveMarketplaceWorkflowBindings({
            tenantId: _commerce_context.tenant_id,
            workspaceId: _commerce_context.workspace_id,
          }, workflow_execution_id)),
        });
      } catch (error) {
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "binding_unavailable",
          code: error instanceof WorkflowExecutionError ? error.code : "WORKFLOW_BINDING_FAILED",
          message: safeToolMessage(error),
        });
      }
    },
  );
  server.registerTool(
    "complete_marketplace_product_research",
    {
      title: "完成关键词商品研究",
      description: "合并工作流各步骤的质量通过业务结果并持久化可重新读取的紧凑结果。",
      inputSchema: {
        workflow_execution_id: z.string().uuid(),
        _commerce_context: scopeSchema.pick({ tenant_id: true, workspace_id: true }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workflow_execution_id, _commerce_context }) => toolSuccess(
      await completeMarketplaceWorkflowExecution({
        tenantId: _commerce_context.tenant_id,
        workspaceId: _commerce_context.workspace_id,
      }, workflow_execution_id),
    ),
  );
  server.registerTool(
    "cancel_marketplace_product_research",
    {
      title: "停止关键词商品研究",
      description: "停止尚未发送的工作流步骤；已经发送或结果不确定的调用不会被隐藏或重放。",
      inputSchema: {
        workflow_execution_id: z.string().uuid(),
        reason: z.string().min(1).max(500),
        _commerce_context: scopeSchema.pick({ tenant_id: true, workspace_id: true }),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ workflow_execution_id, reason, _commerce_context }) => {
      await cancelMarketplaceWorkflowExecution({
        tenantId: _commerce_context.tenant_id,
        workspaceId: _commerce_context.workspace_id,
      }, workflow_execution_id, reason);
      return toolSuccess({ success: true, workflow_execution_id, processing_state: "cancelled" });
    },
  );
  server.registerTool(
    "preflight_social_content_research",
    {
      title: "规划社交内容研究",
      description: "根据业务目标从数据库接口目录中确定性选择能力匹配的端点，并在任何预留、审批或付费调用前返回标准化执行计划。",
      inputSchema: {
        platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/),
        keyword: z.string().min(1).max(500),
        start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        objective: z.enum(["latest_content", "interaction_ranked"]),
        requested_metrics: z.array(z.enum(["views", "likes", "comments", "shares", "interactions"])).max(5),
        max_results: z.number().int().min(1).max(100),
        allowed_catalog_platforms: z.array(z.string().regex(/^[a-z0-9_]{1,64}$/)).max(100).optional(),
        allowed_endpoint_ids: z.array(z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/)).max(500).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({
      platform, keyword, start_date, end_date, objective, requested_metrics, max_results,
      allowed_catalog_platforms, allowed_endpoint_ids,
    }) => {
      try {
        const plan = await planSocialContentResearch({
          platform,
          keyword,
          startDate: start_date,
          endDate: end_date,
          objective,
          requestedMetrics: requested_metrics,
          maxResults: max_results,
        }, {
          allowedCatalogPlatforms: allowed_catalog_platforms,
          allowedEndpointIds: allowed_endpoint_ids,
        });
        const endpointPreflight = await pipeline.preflight(plan.endpoint.endpointId, plan.normalizedParams);
        return toolSuccess({
          ...endpointPreflight,
          success: true,
          business_tool: "research_social_content",
          research_plan_key: plan.planKey,
          business_intent: plan.businessIntent,
          coverage: plan.coverage,
        });
      } catch (error) {
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "preflight_failed",
          code: error instanceof SocialResearchPlanningError ? error.code : "SOCIAL_RESEARCH_PREFLIGHT_FAILED",
          message: safeToolMessage(error),
          details: error instanceof SocialResearchPlanningError ? error.details : {},
        });
      }
    },
  );
  server.registerTool(
    "preflight_endpoint",
    {
      title: "校验并标准化外部数据请求",
      description: "在任何预留、审批或付费分发之前，按官方 OpenAPI 校验参数并生成 Token-free 请求摘要。",
      inputSchema: {
        endpoint_id: z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/).max(180),
        params: z.record(z.unknown()).default({}),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ endpoint_id, params }) => {
      try {
        return toolSuccess(await pipeline.preflight(endpoint_id, params as JsonObject));
      } catch (error) {
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "preflight_failed",
          code: 400,
          message: safeToolMessage(error),
          endpoint_id,
        });
      }
    },
  );
  server.registerTool(
    "call_endpoint",
    {
      title: "采集并治理外部数据",
      description: "调用一个已审批的接口；完整原始响应进入 SQL 原始层，MCP 只返回经过质量判断的业务证据。",
      inputSchema: {
        endpoint_id: z.string().regex(/^[a-z0-9_]+\.[A-Za-z0-9_.-]+$/).max(180),
        params: z.record(z.unknown()).default({}),
        _commerce_context: scopeSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ endpoint_id, params, _commerce_context }) => {
      const scope = mapScope(_commerce_context);
      const workflowExecutionId = _commerce_context.workflow_execution_id ?? null;
      const workflowStepId = _commerce_context.workflow_step_id ?? null;
      const workflowStepInstanceId = _commerce_context.workflow_step_instance_id ?? null;
      try {
        if ((workflowExecutionId === null) !== (workflowStepId === null)) {
          throw new WorkflowExecutionError("Workflow execution and step identifiers must be supplied together.", "WORKFLOW_CONTEXT_INVALID");
        }
        if (workflowExecutionId && workflowStepId) {
          await startMarketplaceWorkflowStep(scope, {
            executionId: workflowExecutionId,
            stepId: workflowStepId,
            stepInstanceId: workflowStepInstanceId,
            endpointId: endpoint_id,
            params: params as JsonObject,
          });
        }
        const result = await pipeline.execute(scope, endpoint_id, params as JsonObject);
        if (workflowExecutionId && workflowStepId) {
          await completeMarketplaceWorkflowStep(scope, {
            executionId: workflowExecutionId,
            stepId: workflowStepId,
            stepInstanceId: workflowStepInstanceId,
            endpointId: endpoint_id,
            researchRequestId: result.research_request_id,
            providerCompleted: result.provider_completed,
            processingState: result.processing_state,
            success: result.success,
            code: result.code,
            message: result.message,
          });
        }
        return toolSuccess(result);
      } catch (error) {
        if (workflowExecutionId && workflowStepId && error instanceof JustOneApiRestError && error.uncertain) {
          await markMarketplaceWorkflowStepUnknown(scope, {
            executionId: workflowExecutionId,
            stepId: workflowStepId,
            stepInstanceId: workflowStepInstanceId,
            endpointId: endpoint_id,
            message: safeToolMessage(error),
          }).catch(() => undefined);
        } else if (workflowExecutionId && workflowStepId) {
          await failMarketplaceWorkflowStep(scope, {
            executionId: workflowExecutionId,
            stepId: workflowStepId,
            stepInstanceId: workflowStepInstanceId,
            endpointId: endpoint_id,
            code: error instanceof WorkflowExecutionError ? error.code : error instanceof LocalModelError ? "LOCAL_MODEL_FAILED" : "WORKFLOW_STEP_FAILED",
            message: safeToolMessage(error),
          }).catch(() => undefined);
        }
        if (error instanceof JustOneApiRestError && error.uncertain) throw error;
        return toolSuccess({
          success: false,
          provider_completed: false,
          processing_state: "preflight_failed",
          code: error instanceof WorkflowExecutionError ? error.code : error instanceof LocalModelError ? 503 : 400,
          message: safeToolMessage(error),
          endpoint_id,
        });
      }
    },
  );
  server.registerTool(
    "get_research_result",
    {
      title: "读取业务研究结果",
      description: "按研究请求 ID 读取经过治理的业务层结果，不返回原始响应。",
      inputSchema: {
        research_request_id: z.string().uuid(),
        _commerce_context: scopeSchema.pick({ tenant_id: true, workspace_id: true }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ research_request_id, _commerce_context }) => toolSuccess(
      await loadWorkflowOrResearchResult({
        tenantId: _commerce_context.tenant_id,
        workspaceId: _commerce_context.workspace_id,
      }, research_request_id),
    ),
  );
  server.registerTool(
    "search_business_data",
    {
      title: "混合检索业务数据",
      description: "使用 Elasticsearch BM25、pgvector HNSW 和本机 Qwen3 Reranker 检索已晋级的业务数据。",
      inputSchema: {
        query: z.string().min(1).max(4_096),
        limit: z.number().int().min(1).max(20).default(10),
        _commerce_context: scopeSchema.pick({ tenant_id: true, workspace_id: true }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ query, limit, _commerce_context }) => toolSuccess({
      success: true,
      results: await hybridBusinessSearch({
        tenantId: _commerce_context.tenant_id,
        workspaceId: _commerce_context.workspace_id,
        query,
        limit,
      }),
    }),
  );
  return server;
}

function mapScope(value: z.infer<typeof scopeSchema>): ExternalDataScope {
  return {
    tenantId: value.tenant_id,
    workspaceId: value.workspace_id,
    userId: value.user_id,
    source: value.source,
    sourceCallId: value.source_call_id,
    rootThreadId: value.root_thread_id,
    threadId: value.thread_id,
    turnId: value.turn_id,
    requestText: value.request_text,
    topN: value.top_n,
    workflowExecutionId: value.workflow_execution_id ?? null,
    workflowStepId: value.workflow_step_id ?? null,
    businessIntent: value.business_intent ? {
      kind: value.business_intent.kind,
      platform: value.business_intent.platform,
      targetProduct: value.business_intent.target_product,
      objective: value.business_intent.objective,
      requestedMetrics: value.business_intent.requested_metrics,
      timeRange: value.business_intent.time_range ? {
        start: value.business_intent.time_range.start,
        end: value.business_intent.time_range.end,
        startDate: value.business_intent.time_range.start_date,
        endDate: value.business_intent.time_range.end_date,
        timezone: value.business_intent.time_range.timezone,
      } : null,
      windowEnforcement: value.business_intent.window_enforcement,
      requestedTopN: value.business_intent.requested_top_n,
      workflowId: value.business_intent.workflow_id ?? null,
      workflowVersion: value.business_intent.workflow_version ?? null,
      workflowPlanKey: value.business_intent.workflow_plan_key ?? null,
      workflowStepId: value.business_intent.workflow_step_id ?? null,
      workflowStepRole: value.business_intent.workflow_step_role ?? null,
      localizedKeyword: value.business_intent.localized_keyword ?? null,
      localizedKeywords: value.business_intent.localized_keywords ?? [],
      marketContext: value.business_intent.market_context ?? null,
      qualityPolicy: value.business_intent.quality_policy ?? null,
    } : null,
    workflowStepInstanceId: value.workflow_step_instance_id ?? null,
    workflowTargetId: value.workflow_target_id ?? null,
  };
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

function safeToolMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "External-data preflight failed.")
    .replace(/([?&]token=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}
