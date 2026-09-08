import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DATA_CAPABILITY_TOOL_DESCRIPTIONS, publicDataPlanReceipt, requireDataPayload } from "../integrations/data-capability-contract.js";
import { externalDataParameterKeys, hashExternalDataParameters, type AuthenticatedMcpPrincipal, type ExternalDataControlClient } from "../integrations/external-data-control-client.js";
import type { ExternalDataServiceMcpClient } from "../integrations/external-data-service-mcp-client.js";
import { classifyExternalDataServiceOutcome } from "../integrations/external-data-outcome.js";
import { researchExecutionResponse } from "./research-execution-response.js";

export function registerDataCapabilityTools(server: McpServer, principal: AuthenticatedMcpPrincipal,
  control: ExternalDataControlClient, upstream: ExternalDataServiceMcpClient): void {
  const context = (callId: string, request = "读取数据计划") => ({tenant_id:principal.tenantId,workspace_id:principal.workspaceId,user_id:principal.userId,
    source:"external_mcp",source_call_id:callId,request_text:request,top_n:50,business_intent:null});
  const authorization = async () => {
    const allowed = await control.authorizeCatalog(principal);
    return { allowed_catalog_platforms:allowed.allowedPlatforms,allowed_endpoint_ids:allowed.allowedEndpointIds };
  };
  const readResult = async (planId: string) => (await upstream.getResearchResult({ research_request_id:planId,
    _commerce_context:{tenant_id:principal.tenantId,workspace_id:principal.workspaceId} })).payload;
  if (principal.scopes.includes("external_data.catalog.read")) {
    server.registerTool("search_data_capabilities", {title:"搜索全部数据能力",description:DATA_CAPABILITY_TOOL_DESCRIPTIONS.search_data_capabilities,
      inputSchema:{query:z.string().max(500).default(""),platform:z.string().max(64).optional(),offset:z.number().int().min(0).max(10000).default(0),limit:z.number().int().min(1).max(50).default(20)},
      annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}}, async(args) => {
      try {return success(requireDataPayload(await upstream.searchDataCapabilities({...args,...await authorization()})));} catch(error) {return failure(error);} });
    server.registerTool("get_data_capability", {title:"查看数据能力参数",description:DATA_CAPABILITY_TOOL_DESCRIPTIONS.get_data_capability,
      inputSchema:{capability_id:z.string().regex(/^cap_[a-f0-9]{24}$/)},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async(args)=>{
      try {return success(requireDataPayload(await upstream.getDataCapability({...args,...await authorization()})));} catch(error) {return failure(error);} });
  }
  if (!principal.scopes.includes("external_data.call")) return;
  server.registerTool("plan_data_request", {title:"免费规划数据查询",description:DATA_CAPABILITY_TOOL_DESCRIPTIONS.plan_data_request,
    inputSchema:{capability_id:z.string().regex(/^cap_[a-f0-9]{24}$/),inputs:z.record(z.unknown()),idempotency_key:z.string().uuid(),research_request:z.string().min(1).max(50000)},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}, async(args)=>{
    try {
      const plan = requireDataPayload(await upstream.planDataRequest({capability_id:args.capability_id,inputs:args.inputs,...await authorization(),
        _commerce_context:context(`data_plan_${args.idempotency_key.replaceAll("-","")}`,args.research_request)}));
      const quote = await control.quote(principal,{planId:String(plan.plan_id),planKey:String(plan.plan_key),source:"external_mcp",
        calls:[{endpointId:String(plan.endpoint_id),platform:String(plan.platform),count:1}]});
      return success(publicDataPlanReceipt(plan,quote));
    } catch(error) {return failure(error);}
  });
  server.registerTool("execute_data_request", {title:"执行固定数据计划",description:DATA_CAPABILITY_TOOL_DESCRIPTIONS.execute_data_request,
    inputSchema:{plan_id:z.string().uuid()},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}},
  async({plan_id})=>researchExecutionResponse(execute(plan_id),()=>success({success:true,code:202,plan_id,research_request_id:plan_id,
    processing_state:"executing",provider_completed:false,retry_after_seconds:15,recovery_tool:"get_research_result",message:"同一数据请求正在执行，请按计划编号查询，不要新建计划重采。"})));

  async function execute(planId: string) {
    const scope = context(`data_execute_${randomUUID().replaceAll("-","")}`);
    let claimed: Record<string,unknown> | null = null;
    try {
      claimed = requireDataPayload(await upstream.claimDataRequestPlan({plan_id:planId,...await authorization(),_commerce_context:scope}));
      if (claimed.reused === true) return success({...await readResult(planId),reused:true});
      const params = claimed.normalized_inputs as Record<string,unknown>;
      const reservation = await control.reserve(principal,{source:"external_mcp",callId:String(claimed.source_call_id),endpointId:String(claimed.endpoint_id),
        platform:String(claimed.platform),parameterHash:hashExternalDataParameters(params),parameterKeys:externalDataParameterKeys(params),requestedApprovalMode:"policy"});
      if (reservation.requiresApproval) {
        await control.cancel(principal,reservation.reservationId,"approval_required");
        await upstream.cancelDataRequestPlan({plan_id:planId,_commerce_context:scope});
        return failure(Object.assign(new Error("当前策略要求人工审批，请通过 Commerce Pilot 工作台审批。"),{code:"APPROVAL_REQUIRED"}));
      }
      await control.dispatch(principal,reservation.reservationId,{endpoint_id:claimed.endpoint_id,params});
      let result;
      try {result = await upstream.executeDataRequestPlan({plan_id:planId,_commerce_context:scope});}
      catch(error) {
        await control.settle(principal,reservation.reservationId,{state:"unknown",upstreamCode:null,upstreamMessage:"Data execution response is uncertain.",resultBytes:null,responsePayload:null}).catch(()=>undefined);
        return failure(Object.assign(new Error("数据请求结果不确定，请查询原计划编号并对账，禁止重新采集。"),{code:"DATA_RESULT_UNKNOWN",details:{research_request_id:planId}}));
      }
      const outcome = classifyExternalDataServiceOutcome(result.payload,result.isError);
      let settlementPending=false;
      try { await control.settle(principal,reservation.reservationId,{state:outcome.settlementState,upstreamCode:outcome.upstreamCode,
        upstreamMessage:typeof result.payload.message==="string" ? result.payload.message : null,resultBytes:result.resultBytes,responsePayload:result.payload}); }
      catch {settlementPending=true;}
      return success({...result.payload,plan_id:planId,...(settlementPending ? {billing_reconciliation_pending:true} : {})});
    } catch(error) {
      if (claimed && claimed.reused !== true) await upstream.cancelDataRequestPlan({plan_id:planId,_commerce_context:scope}).catch(()=>undefined);
      return failure(error);
    }
  }
}

function success(payload: Record<string,unknown>) {return {content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};}
function failure(error: unknown) {
  const value = error as {code?:string;message?:string;details?:unknown};
  const payload={success:false,error:{code:value.code ?? "DATA_CAPABILITY_FAILED",message:value.message ?? "数据能力请求失败。",details:value.details ?? {}}};
  return {isError:true,content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};
}
