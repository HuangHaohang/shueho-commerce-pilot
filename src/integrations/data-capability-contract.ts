import type { ExternalDataServiceToolResult } from "./external-data-service-mcp-client.js";

export const DATA_CAPABILITY_TOOL_SCHEMAS = {
  search_data_capabilities: {
    type:"object",additionalProperties:false,properties:{query:{type:"string",maxLength:500,default:""},platform:{type:"string",maxLength:64},
      offset:{type:"integer",minimum:0,maximum:10000,default:0},limit:{type:"integer",minimum:1,maximum:50,default:20}},required:[],
  },
  get_data_capability: {type:"object",additionalProperties:false,properties:{capability_id:{type:"string",pattern:"^cap_[a-f0-9]{24}$"}},required:["capability_id"]},
  plan_data_request: {type:"object",additionalProperties:false,properties:{capability_id:{type:"string",pattern:"^cap_[a-f0-9]{24}$"},
    inputs:{type:"object",additionalProperties:true},idempotency_key:{type:"string",format:"uuid"},research_request:{type:"string",minLength:1,maxLength:50000}},
    required:["capability_id","inputs","idempotency_key","research_request"]},
  execute_data_request: {type:"object",additionalProperties:false,properties:{plan_id:{type:"string",format:"uuid"}},required:["plan_id"]},
} as const;

export const DATA_CAPABILITY_TOOL_DESCRIPTIONS: Record<keyof typeof DATA_CAPABILITY_TOOL_SCHEMAS,string> = {
  search_data_capabilities:"Search the full database-backed data catalog across all platforms and categories, including product, social content, comments, profiles, metrics and AI answers. Free. Blocked entries exist but report exact permission/pricing/quota gaps; the marketplace-only list is not the full catalog.",
  get_data_capability:"Read one capability's current credential-free input schema, revision and availability. Use the actual field names, enum values and defaults. Never infer an unavailable provider interface from a missing specialized workflow.",
  plan_data_request:"Create a free immutable plan and live quote for one catalog capability using its exact business-input schema. Use identifiers provided by the user or verified source evidence, never invented IDs. This does not call the supplier; execute only a ready plan_id. Prefer the specialized marketplace plan for comparable product research.",
  execute_data_request:"Execute one fixed data plan under live policy, budget, token quotas, shared admission and safe bounded retries. Repeating a consumed plan reads its original result. Returned observations are validated supplier outputs, potentially AI-generated, not independently verified facts. Query the same plan_id with get_research_result; never replay uncertain calls.",
};

export function requireDataPayload(result: ExternalDataServiceToolResult): Record<string,unknown> {
  if (result.payload.success !== true) {
    const error = new Error(typeof result.payload.message === "string" ? result.payload.message : "数据能力请求未完成。");
    Object.assign(error,{code:typeof result.payload.code === "string" ? result.payload.code : "DATA_REQUEST_FAILED",details:result.payload.details ?? {}});
    throw error;
  }
  return result.payload;
}

export function publicDataPlanReceipt(plan: Record<string,unknown>, quote: unknown): Record<string,unknown> {
  return {success:true,plan_id:plan.plan_id,expires_at:plan.expires_at,state:plan.state,
    capability:plan.capability,inputs:plan.normalized_inputs,quote,provider_calls:plan.provider_calls};
}
