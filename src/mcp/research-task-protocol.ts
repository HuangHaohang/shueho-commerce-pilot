import type {TaskStore} from '@modelcontextprotocol/sdk/experimental/tasks/interfaces.js';
import type {Task as McpTask} from '@modelcontextprotocol/sdk/types.js';
import type {AuthenticatedMcpPrincipal,ExternalDataControlClient} from '../integrations/external-data-control-client.js';
import type {ExternalDataServiceMcpClient} from '../integrations/external-data-service-mcp-client.js';
import {enqueueTask,getTask} from './research-task-runtime.js';
import {z} from 'zod';
import {GetTaskPayloadRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';

export const taskOutputSchema=z.object({success:z.boolean(),task_id:z.string().uuid().optional(),state:z.string().optional(),
 error:z.object({code:z.string(),message:z.string(),details:z.record(z.unknown()).optional()}).optional()}).passthrough();
export function mcpTaskView(value:Record<string,any>):McpTask {
 const statuses:Record<string,McpTask['status']>={queued:'working',running:'working',waiting_approval:'input_required',completed:'completed',partial:'failed',failed:'failed',reconciliation_required:'failed',cancelled:'cancelled'};
 return {taskId:value.task_id,status:statuses[value.state]??'failed',statusMessage:value.state,createdAt:String(value.created_at),lastUpdatedAt:String(value.updated_at),ttl:null,pollInterval:15000};
}
export function taskResultPayload(task:Record<string,any>){
 const failed=['partial','failed','reconciliation_required','cancelled'].includes(task.state);
 const result={...task.result,task_id:task.task_id,state:task.state,settlement:task.settlement};
 if(failed){result.success=false;if(task.state==='cancelled')result.error={code:'TASK_CANCELLED',message:'任务已取消，已完成的结果与结算记录仍保留。'};}
 return result;
}
export function mcpResult(payload:Record<string,any>){return {isError:payload.success===false,structuredContent:payload,content:[{type:'text' as const,text:JSON.stringify(payload)}]};}
export function mcpFailure(error:unknown){const e=error as {code?:string;message?:string};return mcpResult({success:false,error:{code:e.code??'RESEARCH_REQUEST_FAILED',message:e.message??'研究请求未完成。'}});}
export function researchTaskStore(upstream:ExternalDataServiceMcpClient,control:ExternalDataControlClient,p:AuthenticatedMcpPrincipal):TaskStore {
 const owner={tenant_id:p.tenantId,workspace_id:p.workspaceId,user_id:p.userId,root_thread_id:p.rootThreadId??null};
 const read=async(id:string)=>{await control.authorizeCatalog(p);return getTask(upstream,p,id);};
 return {
  async createTask(_params,_id,request){
   if(request.method!=='tools/call')throw new Error('TASK_REQUEST_UNSUPPORTED');
   const args=(request.params as any).arguments;const name=(request.params as any).name;
   const kinds:Record<string,'data'|'marketplace'|'social'>={run_data_research:'data',run_marketplace_research:'marketplace',run_social_research:'social'};
   if(!kinds[name])throw new Error('TASK_REQUEST_UNSUPPORTED');
   await control.authorizeCatalog(p);return mcpTaskView(await enqueueTask(upstream,p,kinds[name]!,args));
  },
  async getTask(id){return mcpTaskView(await read(id));},
  async getTaskResult(id){const task=await read(id);return mcpResult(taskResultPayload(task));},
  async storeTaskResult(){throw new Error('TASK_RESULTS_ARE_WORKER_OWNED');},
  async updateTaskStatus(id,status){if(status!=='cancelled')throw new Error('TASK_STATUS_IS_WORKER_OWNED');await control.authorizeCatalog(p);await read(id);await upstream.taskOperation('manage_research_task',{action:'cancel',task_id:id,_commerce_context:owner});},
  async listTasks(cursor){await control.authorizeCatalog(p);const result=(await upstream.taskOperation('manage_research_task',{action:'list',cursor,limit:20,_commerce_context:owner})).payload;return {tasks:(result.tasks as Record<string,any>[]).map(mcpTaskView),...(result.next_cursor?{nextCursor:String(result.next_cursor)}:{})};},
 };
}

/** Database workers do not share the SDK's process-local task wakeup queue. */
export function registerDurableTaskResult(server:McpServer,store:TaskStore,resolveInput?:(id:string,signal:AbortSignal,seen:Set<string>)=>Promise<void>){
 server.server.setRequestHandler(GetTaskPayloadRequestSchema,async(request,extra)=>{
  const seenInputs=new Set<string>();
  while(!extra.signal.aborted){
   const task=await store.getTask(request.params.taskId);
   if(!task)throw new Error('TASK_NOT_FOUND');
   if(['completed','failed','cancelled'].includes(task.status)){
    const result=await store.getTaskResult(task.taskId);
    return {...result,_meta:{...result._meta,'io.modelcontextprotocol/related-task':{taskId:task.taskId}}};
   }
   if(task.status==='input_required'&&resolveInput){await resolveInput(task.taskId,extra.signal,seenInputs);const refreshed=await store.getTask(task.taskId);if(refreshed?.status!=='input_required')continue;}
   await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);extra.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,15000);extra.signal.addEventListener('abort',done,{once:true});});
  }
  throw new Error('TASK_RESULT_WAIT_CANCELLED');
 });
}
