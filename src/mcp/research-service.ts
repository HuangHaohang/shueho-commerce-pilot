import {rethrowResearchRecovery,ResearchProcessingPendingError} from '../integrations/research-recovery-error.js';
import {SettlementNotPersistedError} from "../integrations/settlement-delivery-error.js";
import {ProviderNotDispatchedError,notDispatchedPayload} from "../integrations/provider-dispatch-stage.js";
import {withTaskPage} from "./research-task-runtime.js";
import {createHash} from "node:crypto";
import {taskCallId} from "./research-task-runtime.js";
import { registerDataCapabilityTools } from "./data-capability-tools.js";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { repeatedPlanResult } from "./repeated-plan-result.js";
import { researchExecutionResponse } from "./research-execution-response.js";
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
} from "../integrations/marketplace-product-research-preflight.js";
import {
  createMarketplaceProductResearchPlan,
  executeMarketplaceProductResearchPlan,
  parseMarketplaceProductResearchStepInstances,
} from "../integrations/marketplace-product-research-plan.js";
import {
  preflightSocialContentResearch,
  SocialContentResearchPreflightError,
} from "../integrations/social-content-research-preflight.js";

export type ResearchDefinition={name:string;config:any;handler:(args:any)=>Promise<any>};
export function createResearchService(upstream:ExternalDataServiceMcpClient,control:ExternalDataControlClient){
 return {definitions:definitionsFor,async execute(task:import('./research-task-runtime.js').Task){
 const handlers=new Map(definitionsFor(task.principal).map(d=>[d.name,d.handler]));
 if(task.kind==='data' && task.inputs.pagination && !(task.inputs as any)._page_child){
  const paging=task.inputs.pagination as {max_pages:number};
  const schema=await upstream.getDataCapability({capability_id:task.inputs.capability_id,...await control.authorizeCatalog(task.principal).then(a=>({allowed_catalog_platforms:a.allowedPlatforms,allowed_endpoint_ids:a.allowedEndpointIds}))});
  const properties=(schema.payload.input_schema as any)?.properties;
  if(!properties?.page || properties.page.type!=='integer')return toolError('PAGINATION_UNSUPPORTED','此能力未声明页码分页，不自动猜测游标。');
  const inputs=task.inputs.inputs as Record<string,unknown>;const first=Number(inputs.page??1);
  const results:Record<string,any>[]=[];let stop='page_limit';let failure:any;
  for(let page=first;page<first+paging.max_pages;page++){
   const digest=createHash('sha256').update(`${task.inputs.idempotency_key}:${page}`).digest('hex');
   const key=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
   const result=await withTaskPage(page,()=>createResearchService(upstream,control).execute({...task,inputs:{...task.inputs,pagination:undefined,_page_child:true,idempotency_key:key,inputs:{...inputs,page}}}));
   const value=result.structuredContent;
   if(value?.success!==true){failure=result;stop='page_failed';break;}
   results.push(value);
   const records=await upstream.taskOperation('read_research_records',{research_request_id:value.research_request_id,offset:0,limit:1,_commerce_context:{tenant_id:task.principal.tenantId,workspace_id:task.principal.workspaceId,user_id:task.principal.userId}});
   const meta=records.payload.pagination as Record<string,unknown>;
   if(meta.hasNextPage===false || meta.hasMore===false || typeof meta.maxPage==='number' && page>=meta.maxPage || records.payload.total_records===0){stop='source_end';break;}
  }
  if(failure){const value=failure.structuredContent;return {...failure,structuredContent:{...value,partial_results:results.map(r=>({research_request_id:r.research_request_id,observed_at:r.observed_at})),coverage:{pages_completed:results.length,stop_reason:stop}},content:[{type:'text' as const,text:JSON.stringify({...value,pages_completed:results.length,stop_reason:stop})}]};}
  return toolSuccess({success:true,processing_state:'completed',provider_completed:true,research_requests:results.map(r=>({research_request_id:r.research_request_id,observed_at:r.observed_at})),coverage:{pages_completed:results.length,stop_reason:stop,all_source_pages:stop==='source_end'},message:'分页任务完成；按记录查询工具读取各页结果。'});
 }

 if(task.kind==='social')return executeSocialResearch(task.principal,task.inputs,(task.execution_version??1)>=3);
 const planned=await handlers.get(task.kind==='data'?'plan_data_request':'plan_marketplace_research')!(task.inputs);
 const receipt=planned.structuredContent;
 if(planned.isError)return planned;
 if(receipt?.state!=='ready')return toolError('TASK_INPUT_BLOCKED','任务输入或额度尚不可执行。',{capability:receipt?.capability??null});
 return handlers.get(task.kind==='data'?'execute_data_request':'execute_marketplace_research')!({plan_id:receipt.plan_id});
 }};
function definitionsFor(principal: AuthenticatedMcpPrincipal):ResearchDefinition[] {
  const definitions:ResearchDefinition[]=[];
  const server={registerTool:((name:string,config:any,handler:any)=>{definitions.push({name,config,handler});return {} as any;}) as McpServer['registerTool']} as McpServer;
  registerDataCapabilityTools(server,principal,control,upstream);
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
        description: "读取平台当前市场/站点与查询语言元数据；不返回内部质量阈值或样本上限，不调用供应商且不产生费用。",
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
        description: "按研究请求 ID、执行 ID 或商品计划 ID 读取状态、排队/重试进度及已治理结果，不重新采集。遵循 coverage.polling 或 coverage.execution.polling：poll_same_request 按 retryAfterSeconds 等待，stop 停止轮询，reconcile 需要对账且禁止重发。",
        inputSchema: { research_request_id: z.string().uuid(),field_offset:z.number().int().min(0).max(10000).optional(),field_limit:z.number().int().min(1).max(100).optional() },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({ research_request_id,field_offset,field_limit }) => {
        await control.authorizeCatalog(principal);
        const result = await upstream.getResearchResult({
          research_request_id,field_offset,field_limit,
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
          semantic_scope: z.object({
            include: z.array(z.string().min(1).max(500)).max(8),
            exclude: z.array(z.string().min(1).max(500)).max(8),
          }).strict().optional().describe("User-stated semantic constraints only, such as materials, uses and exclusions. Preserve every explicit scope restriction here; omit dates, metrics, ranking and report instructions."),

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
      async args=>executeSocialResearch(principal,args,false),
    );
    server.registerTool(
      "plan_marketplace_research",
      {
        title: "规划公开电商商品研究（免费）",
        description:
          "校验业务范围、市场语言档案、目录版本和代表样本规模，返回不可变计划 ID；不调用供应商且不产生费用。",
        inputSchema: {
          platform: z.string().regex(/^[A-Za-z0-9_]{2,64}$/),
          keyword: z.string().min(1).max(500),
          semantic_scope: z.object({
            include: z.array(z.string().min(1).max(500)).max(8),
            exclude: z.array(z.string().min(1).max(500)).max(8),
          }).strict().optional().describe("User-stated semantic constraints only, such as materials, uses and exclusions. Preserve every explicit scope restriction here; omit dates, metrics, ranking and report instructions."),

          localized_keywords: z.array(z.string().min(1).max(500)).max(8).default([]),
          market: z.string().regex(/^[A-Za-z0-9_-]{2,32}$/).nullable().default(null),
          tmall_only: z.boolean(),
          min_price_yuan: z.number().nonnegative().nullable(),
          max_price_yuan: z.number().nonnegative().nullable(),
          requested_metrics: z.array(z.enum(["price_band", "sales_level", "brand_competition", "property_distribution"])).min(1).max(4),
          max_results: z.number().int().min(1).max(100),
          detail_sample_size: z.number().int().min(1).max(10).nullable().default(null),
          idempotency_key: z.string().uuid(),
          research_request: z.string().min(1).max(50_000),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async ({
        platform,keyword,semantic_scope,localized_keywords,market,tmall_only,min_price_yuan,max_price_yuan,
        requested_metrics,max_results,detail_sample_size,idempotency_key,research_request,
      }) => {
        const authorization = await control.authorizeCatalog(principal);
        const sourceCallId = `mcp_plan_${idempotency_key.replaceAll("-", "")}`;
        try {
          const planned = await createMarketplaceProductResearchPlan(upstream, {
            platform,keyword,semantic_scope,localized_keywords,market,tmall_only,min_price_yuan,max_price_yuan,
            requested_metrics,max_results,detail_sample_size,
          }, {
            tenant_id: principal.tenantId,workspace_id: principal.workspaceId,user_id: principal.userId,
            source: "external_mcp",source_call_id: sourceCallId,request_text: research_request,
            top_n: max_results,business_intent: null,
          }, authorization);
          const quote = await control.quote(principal, {
            planId: planned.planId,
            planKey: planned.planKey,
            source: "external_mcp",
            calls: planned.steps.map((step) => ({
              endpointId: step.endpointId,
              platform: step.catalogPlatform,
              count: Object.keys(step.dynamicParameterBindings).length ? planned.detailSampleSize : 1,
            })),
          });
          if (quote.providerCallCount !== planned.estimatedProviderCalls) {
            return toolError("MARKETPLACE_PLAN_QUOTE_MISMATCH",
              "Marketplace plan and billing quote call counts differ.",{ providerDispatched: false });
          }
          return toolSuccess({
            success: true,state: "ready",plan_id: planned.planId,expires_at: planned.expiresAt,
            market_context: planned.marketContext,detail_sample_size: planned.detailSampleSize,
            estimated_provider_calls: planned.estimatedProviderCalls,coverage: planned.coverage,
            quote: {
              currency: quote.currency,provider_call_count: quote.providerCallCount,
              priced: quote.unpricedEndpointIds.length === 0,
              vendor_cost_micros: quote.vendorCostMicros,billable_amount_micros: quote.billableAmountMicros,
              monthly_call_limit: quote.monthlyCallLimit,calls_used: quote.callsUsed,
              monthly_spend_limit_micros: quote.monthlySpendLimitMicros,
              spend_used_micros: quote.spendUsedMicros,approval_mode: quote.approvalMode,
              per_call_auto_approval_micros: quote.perCallAutoApprovalMicros,
            },
          });
        } catch (error) {rethrowResearchRecovery(error);
          if (error instanceof ExternalDataControlError) {
            return toolError(error.code,error.message,{ providerDispatched: false,...error.details });
          }
          return toolError(
            error instanceof MarketplaceProductResearchPreflightError ? error.code : "MARKETPLACE_RESEARCH_PLAN_FAILED",
            error instanceof Error ? error.message : "商品研究计划无法建立。",
            { providerDispatched: false,...(error instanceof MarketplaceProductResearchPreflightError ? error.details : {}) },
          );
        }
      },
    );
    server.registerTool(
      "execute_marketplace_research",
      {
        title: "执行已固定商品研究计划（可能计费）",
        description: "仅接受已固定的 plan_id；同一计划重复提交只读取原执行状态，不重复采集。供应商明确拒绝的 301/302 由服务端限次退避重试并共享限流；不确定结果禁止重试。每步仍执行权限、预算、策略批准、归档和结算。",
        inputSchema: { plan_id: z.string().uuid() },
        annotations: { readOnlyHint: false,destructiveHint: true,idempotentHint: true,openWorldHint: true },
      },
      async ({ plan_id }) => researchExecutionResponse(
        executePublicMarketplaceResearchPlan(principal, plan_id),
        () => toolSuccess({
          success: true, code: 202, processing_state: "running", provider_completed: false,
          plan_id, research_request_id: plan_id, recovery_tool: "get_research_result", retry_after_seconds: 15,
          message: "研究已提交，后台继续同一次执行。请用 get_research_result 查询此编号，勿重新执行或另建计划重试。",
        }),
      ),
    );
  }
  return definitions;
}

async function executePublicMarketplaceResearchPlan(
  principal: AuthenticatedMcpPrincipal,
  planId: string,
) {
  const authorization = await control.authorizeCatalog(principal);
  const rootCallId = `mcp_execute_${taskCallId().replaceAll("-", "")}`;
  let executable;
  try {
    executable = await executeMarketplaceProductResearchPlan(upstream, planId, {
      tenant_id: principal.tenantId,workspace_id: principal.workspaceId,user_id: principal.userId,
      source: "external_mcp",source_call_id: rootCallId,
      request_text: `Execute marketplace research plan ${planId}`,top_n: 50,business_intent: null,
    }, authorization);
  } catch (error) {rethrowResearchRecovery(error);
    if (error instanceof MarketplaceProductResearchPreflightError && error.code === "PLAN_NOT_READY") {
      const existing = await repeatedPlanResult(error.code, planId, () => upstream.getResearchResult({
        research_request_id: planId,
        _commerce_context: { tenant_id: principal.tenantId,workspace_id: principal.workspaceId },
      }));
      if (existing) return toolSuccess(existing);
    }
    return toolError(
      error instanceof MarketplaceProductResearchPreflightError ? error.code : "MARKETPLACE_PLAN_EXECUTION_FAILED",
      error instanceof Error ? error.message : "Marketplace plan could not be executed.",
      { providerDispatched: false },
    );
  }
  const businessIntent = { ...executable.businessIntent,workflow_plan_key: executable.planKey };
  let stepInstances = executable.stepInstances;
  let stepIndex = 0;
  while (stepIndex < stepInstances.length) {
    const instance = stepInstances[stepIndex];
    if (!instance) break;
    const step = executable.steps.find((candidate) => candidate.stepId === instance.stepId);
    if (!step) return toolError("WORKFLOW_STEP_TEMPLATE_MISSING", "Workflow step template is missing.");
    const params = structuredClone(step.parameterTemplate);
    for (const [parameter,bindingName] of Object.entries(step.dynamicParameterBindings)) {
      const value = instance.bindings[bindingName];
      if (value === undefined) {
        return toolError("WORKFLOW_BINDING_UNAVAILABLE", `Missing workflow binding ${bindingName}.`);
      }
      params[parameter] = value;
    }
    const endpointPreflight = await upstream.preflightEndpoint({ endpoint_id: step.endpointId,params });
    if (endpointPreflight.payload.success !== true || !isRecord(endpointPreflight.payload.normalized_params)) {
      return toolError("WORKFLOW_STEP_PREFLIGHT_FAILED",
        typeof endpointPreflight.payload.message === "string" ? endpointPreflight.payload.message : "Workflow step parameters were rejected.",
        { providerDispatched: false,role: step.role,targetOrdinal: instance.targetOrdinal });
    }
    const normalizedParams = endpointPreflight.payload.normalized_params;
    const currentAuthorization = await control.authorizeCatalog(principal);
    assertEndpointAllowed(step.endpointId,currentAuthorization);
    const callId = `${rootCallId}_${instance.stepInstanceKey}`;
    const reservation = await control.reserve(principal, {
      source: "external_mcp",callId,endpointId: step.endpointId,platform: step.catalogPlatform,
      parameterHash: hashExternalDataParameters(normalizedParams),
      parameterKeys: externalDataParameterKeys(normalizedParams),requestedApprovalMode: "policy",
      marketplacePlanId: executable.planId,workflowStepInstanceId: instance.stepInstanceId,
      workflowTargetId: instance.targetId,workflowRole: step.role,
    });
    if (reservation.requiresApproval) {
      return toolError("APPROVAL_REQUIRED","任务等待正式审批，批准后继续原任务。",{reservationId:reservation.reservationId,currency:reservation.currency,billableAmountMicros:reservation.billableAmountMicros});
      }
    await control.dispatch(principal,reservation.reservationId, {
      endpoint_id: step.endpointId,params: normalizedParams,workflow_execution_id: executable.executionId,
      workflow_step_id: step.stepId,marketplace_plan_id: executable.planId,
      workflow_step_instance_id: instance.stepInstanceId,workflow_target_id: instance.targetId,
    });
    let result: ExternalDataServiceToolResult;
    try {
      result = await upstream.callEndpoint({
        endpoint_id: step.endpointId,params: normalizedParams,
        _commerce_context: {
          tenant_id: principal.tenantId,workspace_id: principal.workspaceId,user_id: principal.userId,
          source: "external_mcp",source_call_id: callId,request_text: executable.requestText,
          top_n: readPublicTopN(executable.businessIntent),workflow_execution_id: executable.executionId,
          workflow_step_id: step.stepId,workflow_step_instance_id: instance.stepInstanceId,
          workflow_target_id: instance.targetId,business_intent: {
            ...businessIntent,workflow_step_id: step.stepId,workflow_step_role: step.role,
            workflow_step_instance_id: instance.stepInstanceId,workflow_target_id: instance.targetId,
          },
        },
      });
    } catch (error) {rethrowResearchRecovery(error);
      if(error instanceof ProviderNotDispatchedError){const payload=notDispatchedPayload(error);await control.settle(principal,reservation.reservationId,{state:'business_failed',upstreamCode:null,upstreamMessage:error.message,resultBytes:null,responsePayload:payload});return {...toolSuccess(payload),isError:true};}
      const normalized = error instanceof ExternalDataServiceMcpError
        ? error
        : new ExternalDataServiceMcpError("SHUEHO external-data workflow step failed.","CALL_FAILED",true);
      await control.settle(principal,reservation.reservationId, {
        state: "unknown",upstreamCode: null,upstreamMessage: normalized.message,
        resultBytes: null,responsePayload: null,
      }).catch(error=>{rethrowResearchRecovery(error);if(error instanceof SettlementNotPersistedError)throw error;});
      return toolError("UPSTREAM_RESULT_UNKNOWN",normalized.message,
        { ...normalized.details, role: step.role,targetOrdinal: instance.targetOrdinal,
          plan_id: executable.planId, workflow_execution_id: executable.executionId,
          research_request_id: executable.executionId, recovery_tool: "get_research_result" });
    }
    const outcome = classifyExternalDataServiceOutcome(result.payload,result.isError);
      if(outcome.settlementState===null)throw new ResearchProcessingPendingError();
    await control.settle(principal,reservation.reservationId, {
      state: outcome.settlementState,upstreamCode: outcome.upstreamCode,
      upstreamMessage: typeof result.payload.message === "string" ? result.payload.message : null,
      resultBytes: result.resultBytes,responsePayload: result.payload,
    });
    if (outcome.businessUsable && step.role === "discovery") {
      const resolved = await upstream.resolveMarketplaceProductBindings({
        workflow_execution_id: executable.executionId,
        _commerce_context: { tenant_id: principal.tenantId,workspace_id: principal.workspaceId },
      });
      if (resolved.payload.success !== true) {
        const partial = await upstream.completeMarketplaceProductResearch({
          workflow_execution_id: executable.executionId,
          _commerce_context: { tenant_id: principal.tenantId,workspace_id: principal.workspaceId },
        });
        return toolError(typeof resolved.payload.code === "string" ? resolved.payload.code : "WORKFLOW_BINDING_UNAVAILABLE",
          typeof resolved.payload.message === "string" ? resolved.payload.message : "No representative targets were available.",partial.payload);
      }
      stepInstances = parseMarketplaceProductResearchStepInstances(resolved.payload.step_instances);
      executable.coverage.provider_calls_planned = 1 + stepInstances.length;
      executable.coverage.detailed_products_selected = Array.isArray(resolved.payload.targets)
        ? resolved.payload.targets.length
        : new Set(stepInstances.map((item) => item.targetId).filter(Boolean)).size;
      stepIndex = 0;
      continue;
    }
    stepIndex += 1;
  }
  const completed = await upstream.completeMarketplaceProductResearch({
    workflow_execution_id: executable.executionId,
    _commerce_context: { tenant_id: principal.tenantId,workspace_id: principal.workspaceId },
  });
  return completed.payload.success === true
    ? toolSuccess({ ...completed.payload,business_tool: "execute_marketplace_research" })
    : toolError("WORKFLOW_INCOMPLETE","Marketplace workflow completed only partially.",completed.payload);
}

async function executeSocialResearch(principal:AuthenticatedMcpPrincipal,args:Record<string,any>,collect:boolean){
 const authorization=await control.authorizeCatalog(principal);
 let preflight;
 try{preflight=await preflightSocialContentResearch(upstream,{platform:args.platform,keyword:args.keyword,semantic_scope:args.semantic_scope,start_date:args.start_date,end_date:args.end_date,objective:args.objective,requested_metrics:args.requested_metrics,max_results:args.max_results},authorization);}
 catch(error){rethrowResearchRecovery(error);return toolError(error instanceof SocialContentResearchPreflightError?error.code:"SOCIAL_RESEARCH_PREFLIGHT_FAILED",error instanceof Error?error.message:"Preflight failed",{providerDispatched:false});}
 const policyId=(preflight.coverage.collection as any)?.policy_receipt_id;
 const pages:Record<string,any>[]=[],seen=new Set<string>(),evidence=new Map<string,any>();
 let params=preflight.normalizedParams,ordinal=0,stop="single_call",failure:any;
 while(true){
  const call=()=>executePublicResearch(principal,{businessTool:"research_social_content",preflight:{...preflight,normalizedParams:params},researchRequest:args.research_request,maxResults:args.max_results});
  let result:any;
  try{result=ordinal===0?await call():await withTaskPage(ordinal+1,call);}
  catch(error){rethrowResearchRecovery(error);failure=toolError(error instanceof ExternalDataControlError?error.code:"SOCIAL_COLLECTION_FAILED",error instanceof Error?error.message:"Collection failed");stop="page_failed";break;}
  const value=result.structuredContent;
  if(result.isError || value.success!==true){failure=result;stop="page_failed";break;}
  pages.push(value);
  for(const row of value.evidence??[]){
   const key=row.provider_entity_id?`${row.source_platform}:${row.provider_entity_id}`:`${value.research_request_id}:${row.evidence_id}`;
   if(!evidence.has(key))evidence.set(key,row);
  }
  if(!collect||!policyId)break;
  const continuation=await upstream.taskOperation("get_research_continuation",{research_request_id:value.research_request_id,policy_id:policyId,platform:String(args.platform).toUpperCase(),objective:args.objective,
   _commerce_context:{tenant_id:principal.tenantId,workspace_id:principal.workspaceId,user_id:principal.userId}});
  const next=continuation.payload;
  if(next.success!==true)throw new Error("CONTINUATION_READ_FAILED");
  if(next.signature && seen.has(String(next.signature))){stop="source_repeated_page";break;}
  if(next.signature)seen.add(String(next.signature));
  if(!next.next_params){stop=String(next.reason);break;}
  if(evidence.size>=args.max_results){stop="requested_count_reached";break;}
  if(!next.signature){stop="source_no_identifiable_records";break;}
  if(hashExternalDataParameters(params)===hashExternalDataParameters(next.next_params)){stop="source_repeated_cursor";break;}
  params=next.next_params as Record<string,unknown>;ordinal++;
 }
 if(!pages.length&&failure)return failure;
 const last=pages.at(-1)??{};
 const publicPlan={...preflight.coverage};delete publicPlan.collection;
 const payload={...last,...(failure?.structuredContent??{}),research_plan:publicPlan,evidence:[...evidence.values()].slice(0,args.max_results),
  research_requests:pages.map(p=>({research_request_id:p.research_request_id,observed_at:p.observed_at})),
  coverage:{...last.coverage,pages_completed:pages.length,stop_reason:stop,collectionComplete:stop==="source_end",
   acceptedEvidence:Math.min(evidence.size,args.max_results),rankingScope:"collected_qualified_samples",
   pageCoverage:pages.map(p=>({research_request_id:p.research_request_id,...p.coverage}))},
  message:failure?"后续采集未完成，已归档结果保留；查看当前错误。":`本任务处理了 ${pages.length} 页、获得 ${Math.min(evidence.size,args.max_results)} 条合格证据；覆盖和结束原因见 coverage。`};
 return {...toolSuccess(payload),...(failure?{isError:true}:{})};
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
  const callId = `mcp_${taskCallId().replaceAll("-", "")}`;
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
    return toolError("APPROVAL_REQUIRED","任务等待正式审批，批准后继续原任务。",{reservationId:reservation.reservationId,currency:reservation.currency,billableAmountMicros:reservation.billableAmountMicros});
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
  } catch (error) {rethrowResearchRecovery(error);
    if(error instanceof ProviderNotDispatchedError){const payload=notDispatchedPayload(error);await control.settle(principal,reservation.reservationId,{state:'business_failed',upstreamCode:null,upstreamMessage:error.message,resultBytes:null,responsePayload:payload});return {...toolSuccess(payload),isError:true};}
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
    } catch(error) {rethrowResearchRecovery(error);
      if(error instanceof SettlementNotPersistedError)throw error;
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
  if(settlementState===null)throw new ResearchProcessingPendingError();
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

function readPublicTopN(intent: Record<string, unknown>): number {
  const value = intent.requested_top_n;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 500 ? value : 50;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}


}
