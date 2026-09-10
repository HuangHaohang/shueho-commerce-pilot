export const TASK_TOOL_NAMES=['submit_marketplace_research','submit_social_research','submit_data_request','get_research_task','list_research_tasks','cancel_research_task','get_research_records'] as const;
export const LEGACY_RESEARCH_TOOLS=['plan_marketplace_research','execute_marketplace_research','plan_data_request','execute_data_request','research_social_content','research_marketplace_products'];
export function taskToolContract(spec:any):any{
 const renamed:Record<string,string>={plan_marketplace_research:'submit_marketplace_research',research_social_content:'submit_social_research',plan_data_request:'submit_data_request'};
 const tools=spec.tools.filter((t:any)=>!['execute_marketplace_research','execute_data_request','research_marketplace_products'].includes(t.name)).map((t:any)=>{
  if(!renamed[t.name])return t;
  return {...t,name:renamed[t.name],description:'Submit a fixed-scope durable research task and immediately receive task_id. The backend validates pricing, permissions and budget and owns collection, retries and recovery. No planning tool or separate execution call. Reuse idempotency_key for the same request.',inputSchema:{...t.inputSchema,
   properties:{...t.inputSchema.properties,idempotency_key:{type:'string',format:'uuid'},...(t.name==='plan_data_request'?{pagination:{type:'object',additionalProperties:false,properties:{max_pages:{type:'integer',minimum:1,maximum:100}},required:['max_pages']}}:{})},required:[...new Set([...(t.inputSchema.required??[]),'idempotency_key'])]}};
 });
 tools.push({type:'function',name:'get_research_task',description:'Read durable task progress and results by task_id. Does not dispatch supplier requests. Follow polling instructions and stop on terminal status.',deferLoading:false,inputSchema:{type:'object',additionalProperties:false,properties:{task_id:{type:'string',format:'uuid'}},required:['task_id']}});
 tools.push(...[
 {name:'list_research_tasks',properties:{cursor:{type:'string',format:'uuid'},limit:{type:'integer',minimum:1,maximum:50}},required:[]},
 {name:'cancel_research_task',properties:{task_id:{type:'string',format:'uuid'}},required:['task_id']},
 {name:'get_research_records',properties:{snapshot_id:{type:'string',format:'uuid'},task_id:{type:'string',format:'uuid'},research_request_id:{type:'string',format:'uuid'},offset:{type:'integer',minimum:0,maximum:10000},limit:{type:'integer',minimum:1,maximum:100}},required:[]},
 ].map(t=>({type:'function',name:t.name,description:t.name==='cancel_research_task'?'Cancel future steps without refunding or replaying dispatched work.':'Read owned tasks or validated record-level data; never recollect.',deferLoading:false,inputSchema:{type:'object',additionalProperties:false,properties:t.properties,required:t.required}})));
 return {...spec,tools};
}
