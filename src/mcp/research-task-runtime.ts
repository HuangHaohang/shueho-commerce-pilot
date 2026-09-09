import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import type {ExternalDataServiceMcpClient} from '../integrations/external-data-service-mcp-client.js';
import type {AuthenticatedMcpPrincipal} from '../integrations/external-data-control-client.js';

type Task={id:string;kind:'marketplace'|'social'|'data';inputs:Record<string,unknown>;principal:AuthenticatedMcpPrincipal;attempts:number};
type Run={task:Task;lease:string;sequence:number;recover:boolean;lost:boolean};
const current=new AsyncLocalStorage<Run>();
export const taskCallId=()=>current.getStore()?.task.id ?? randomUUID();
export const withResearchTaskExecution=<T>(task:Task,lease:string,execute:()=>Promise<T>)=>current.run({task,lease,sequence:0,recover:false,lost:false},execute);
export const isTaskExecution=()=>!!current.getStore();
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const scope=(p:AuthenticatedMcpPrincipal)=>({tenant_id:p.tenantId,workspace_id:p.workspaceId,user_id:p.userId});
export function taskAwareClient<T extends object>(target:T,journal:ExternalDataServiceMcpClient,group:string):T {
 const tracked=new Set(group==='control'?['quote','reserve','dispatch','settle','cancel']:['planDataRequest','claimDataRequestPlan','executeDataRequestPlan','planMarketplaceProductResearch','executeMarketplaceProductResearchPlan','resolveMarketplaceProductBindings','completeMarketplaceProductResearch','cancelMarketplaceProductResearch','callEndpoint']);
 return new Proxy(target,{get(object,name){const method=Reflect.get(object,name);if(typeof method!=='function')return method;
  return async(...args:unknown[])=>{
   const run=current.getStore();if(!run || !tracked.has(String(name)))return method.apply(object,args);
   if(run.lost)throw new Error('TASK_LEASE_LOST');
   const actor=run.task.principal as AuthenticatedMcpPrincipal & {taskThreadId?:string;taskTurnId?:string};
   if(actor.rootThreadId){
    if(group==='control' && ['quote','reserve'].includes(String(name)))args[1]={...(args[1] as object),source:'codex_harness',threadId:actor.taskThreadId,turnId:actor.taskTurnId};
    if(group==='upstream' && (args[0] as any)?._commerce_context)args[0]={...(args[0] as any),_commerce_context:{...(args[0] as any)._commerce_context,source:'codex_harness',root_thread_id:actor.rootThreadId,thread_id:actor.taskThreadId,turn_id:actor.taskTurnId}};
   }
   const operationKey=`${++run.sequence}:${group}.${String(name)}`;
   const base={task_id:run.task.id,lease_id:run.lease,_commerce_context:scope(run.task.principal),operation_key:operationKey,operation_name:`${group}.${String(name)}`,input_hash:hash(args)};
   const begun=(await journal.taskOperation('update_research_task',{...base,action:'begin_operation'})).payload;
   const op=begun.operation as {state:string;result:unknown};if(op.state==='completed')return op.result;
   let result:unknown;
   if(!begun.fresh && ['callEndpoint','executeDataRequestPlan','dispatch','executeMarketplaceProductResearchPlan'].includes(String(name))){
    // An ambiguous side effect is never sent again. Recover the original source result only.
    const input=args[0] as Record<string,any>;
    if(name==='callEndpoint'){
     const recovered=(await journal.taskOperation('recover_research_call',{source_call_id:input._commerce_context.source_call_id,_commerce_context:scope(run.task.principal)})).payload;
     if(recovered.terminal)result={payload:recovered.result,isError:false,resultBytes:Buffer.byteLength(JSON.stringify(recovered.result))};
    }else if(name==='executeDataRequestPlan'){
     const recovered=await journal.getResearchResult({research_request_id:input.plan_id,_commerce_context:scope(run.task.principal)});
     if(['completed','failed','unknown'].includes(String(recovered.payload.processing_state)))result=recovered;
    }
    if(result===undefined){run.recover=true;throw new Error('TASK_OPERATION_REQUIRES_RECONCILIATION');}
   }else result=await method.apply(object,args);
   await journal.taskOperation('update_research_task',{...base,action:'complete_operation',result});
   return result;
  };
 }});
}
export async function enqueueTask(upstream:ExternalDataServiceMcpClient,p:AuthenticatedMcpPrincipal,kind:Task['kind'],inputs:Record<string,unknown>){
 return (await upstream.taskOperation('submit_research_task',{kind,source:p.rootThreadId?'codex_harness':'external_mcp',idempotency_key:inputs.idempotency_key,inputs,principal:p,_commerce_context:scope(p)})).payload;
}
export async function getTask(upstream:ExternalDataServiceMcpClient,p:AuthenticatedMcpPrincipal,id:string){return (await upstream.taskOperation('read_research_task',{task_id:id,_commerce_context:scope(p)})).payload;}
export function startResearchTaskWorker(upstream:ExternalDataServiceMcpClient,execute:(task:Task)=>Promise<any>){
 let active=0,stopped=false;
 const tick=async()=>{
  if(stopped || active>=2)return;active++;
  let task:Task|undefined,lease=randomUUID();
  try{
   const claimed=(await upstream.taskOperation('claim_research_task',{lease_id:lease})).payload;task=claimed.task as Task|undefined;if(!task)return;
   const run:Run={task,lease,sequence:0,recover:false,lost:false};
   const base={task_id:task.id,lease_id:lease,_commerce_context:scope(task.principal)};
   const heartbeat=setInterval(()=>{void upstream.taskOperation('update_research_task',{...base,action:'heartbeat'}).catch(()=>{run.lost=true;});},20_000);
   let response:any;
   try{response=await current.run(run,()=>execute(task!));}
   catch{run.recover=true;}
   finally{clearInterval(heartbeat);}
   if(run.lost)return;
   if(run.recover && task.attempts<5){await upstream.taskOperation('update_research_task',{...base,action:'retry'});return;}
   const payload=response?.structuredContent ?? response?.payload ?? {success:false,error:{code:'TASK_RECONCILIATION_REQUIRED',message:'任务执行中断，保留原任务及调用记录待对账。'}};
   const text=JSON.stringify(payload);
   const state=payload.state==='blocked'?'failed':run.recover || /UPSTREAM_RESULT_UNKNOWN|DATA_RESULT_UNKNOWN|"processing_state":"unknown"/.test(text)?'reconciliation_required':payload.success===true?'completed':(payload.products?.length || payload.error?.details?.products?.length)?'partial':'failed';
   await upstream.taskOperation('update_research_task',{...base,action:'finish',state,result:payload});
  }catch{console.error(JSON.stringify({event:'research_task_worker_retry',task_id:task?.id??null}));}
  finally{active--;}
 };
 const timer=setInterval(()=>void tick(),1000);
 return ()=>{stopped=true;clearInterval(timer);};
}
