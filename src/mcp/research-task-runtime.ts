import {permanentResearchFailure} from '../integrations/research-failure.js';
import {researchResultPending,researchResultTerminal,transientControlFailure} from '../integrations/research-lifecycle.js';
import {ResearchRecoveryRequiredError,ResearchProcessingPendingError} from '../integrations/research-recovery-error.js';
import {hashExternalDataParameters,ExternalDataControlError} from '../integrations/external-data-control-client.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash,randomUUID} from 'node:crypto';
import type {ExternalDataServiceMcpClient} from '../integrations/external-data-service-mcp-client.js';
import type {AuthenticatedMcpPrincipal} from '../integrations/external-data-control-client.js';
import {researchTaskOutcome,researchTaskNeedsRecovery} from '../integrations/research-task-outcome.js';
import {ProviderNotDispatchedError,notDispatchedPayload} from '../integrations/provider-dispatch-stage.js';
import {SettlementNotPersistedError} from '../integrations/settlement-delivery-error.js';
import {IdleBackoff} from './idle-backoff.js';

export type Task={id:string;kind:'marketplace'|'social'|'data';inputs:Record<string,unknown>;principal:AuthenticatedMcpPrincipal;attempts:number;recovery_failures?:number;execution_version?:number};
type Run={task:Task;lease:string;sequence:number;control:{recover:boolean;lost:boolean};reservationId?:string;reservationCallId?:string;page?:number};
const current=new AsyncLocalStorage<Run>();
export const taskCallId=()=>{const r=current.getStore();return r?r.page?`${r.task.id.replaceAll('-','')}_p${r.page}`:r.task.id:randomUUID();};
export async function withTaskPage<T>(page:number,operation:()=>Promise<T>):Promise<T>{const r=current.getStore();return r?current.run({...r,page},operation):operation();}
export const withResearchTaskExecution=<T>(task:Task,lease:string,execute:()=>Promise<T>)=>current.run({task,lease,sequence:0,control:{recover:false,lost:false}},execute);
export const markTaskLeaseLost=()=>{const run=current.getStore();if(run)run.control.lost=true;};
export const isTaskExecution=()=>!!current.getStore();
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const scope=(p:AuthenticatedMcpPrincipal)=>({tenant_id:p.tenantId,workspace_id:p.workspaceId,user_id:p.userId,root_thread_id:p.rootThreadId??null});
export function taskAwareClient<T extends object>(target:T,journal:ExternalDataServiceMcpClient,group:string,control?:{revalidate:(principal:AuthenticatedMcpPrincipal,id:string)=>Promise<Record<string,any>>}):T {
 const tracked=new Set(group==='control'?['quote','reserve','dispatch','settle','cancel']:['preflightSocialContentResearch','planDataRequest','claimDataRequestPlan','executeDataRequestPlan','planMarketplaceProductResearch','executeMarketplaceProductResearchPlan','resolveMarketplaceProductBindings','completeMarketplaceProductResearch','cancelMarketplaceProductResearch','callEndpoint']);
 return new Proxy(target,{get(object,name){const method=Reflect.get(object,name);if(typeof method!=='function')return method;
  if(!tracked.has(String(name)))return method.bind(object);
  return async(...args:unknown[])=>{
   const run=current.getStore();if(!run || !tracked.has(String(name)))return method.apply(object,args);
   if(group==='control' && name==='settle'){
    try{await journal.taskOperation('enqueue_research_settlement',{task_id:run.task.id,reservation_id:String(args[1]),payload:args[2],_commerce_context:scope(run.task.principal)});}
    catch{throw new SettlementNotPersistedError();}
    return;
   }
   if(run.control.lost && !(group==='control' && name==='settle'))throw new ResearchRecoveryRequiredError('TASK_LEASE_LOST');
   const actor=run.task.principal as AuthenticatedMcpPrincipal & {taskThreadId?:string;taskTurnId?:string};
   if(actor.rootThreadId){
    if(group==='control' && ['quote','reserve'].includes(String(name)))args[1]={...(args[1] as object),source:'codex_harness',threadId:actor.taskThreadId,turnId:actor.taskTurnId};
    if(group==='upstream' && (args[0] as any)?._commerce_context)args[0]={...(args[0] as any),_commerce_context:{...(args[0] as any)._commerce_context,source:'codex_harness',root_thread_id:actor.rootThreadId,thread_id:actor.taskThreadId,turn_id:actor.taskTurnId}};
   }
   const operationKey=(run.task.execution_version??1)<2?`${++run.sequence}:${group}.${String(name)}`:`v2:${group}.${String(name)}:${hash(args).slice(0,32)}`;
   const base={task_id:run.task.id,lease_id:run.lease,_commerce_context:scope(run.task.principal),operation_key:operationKey,operation_name:`${group}.${String(name)}`,input_hash:hash(args),...(group==='control'&&name==='reserve'?{operation_context:{source:(args[1] as any).source,callId:(args[1] as any).callId}}:{})};
   const provider=group==='upstream'&&['callEndpoint','executeDataRequestPlan'].includes(String(name));
   if(provider){
    const inspected=(await checkpoint(journal,{...base,action:'read_operation'})).payload.operation;
    if(!inspected){
     try{if(control){
      if(!run.reservationId)throw new Error('TASK_RESERVATION_MISSING');
      const live=await control.revalidate(run.task.principal,run.reservationId);
      if(live.state!=='dispatched'||!['approved','not_required'].includes(live.approvalState))throw new Error('TASK_ADMISSION_REVOKED');
     }}catch(error){
      // No provider checkpoint exists yet, so a transient governance outage can safely retry.
      if(transientControlFailure(error))throw new ResearchRecoveryRequiredError();
      const blocked=new ProviderNotDispatchedError(String((error as {code?:string}).code??'ADMISSION_REJECTED'));
      const payload=notDispatchedPayload(blocked);
      await checkpoint(journal,{...base,action:'begin_operation'});
      await checkpoint(journal,{...base,action:'complete_operation',result:{payload,isError:true,resultBytes:Buffer.byteLength(JSON.stringify(payload))}});
      throw blocked;
     }
    }
   }
   const refresh=async()=>{
    const finalBase={...base,operation_key:base.operation_key+':terminal',operation_name:base.operation_name+'.terminal'};
    const stored=(await checkpoint(journal,{...finalBase,action:'read_operation'})).payload.operation as {state:string;result:any}|null;
    if(stored?.state==='completed')return stored.result;
    const input=args[0] as Record<string,any>;
    let refreshed:any;
    if(name==='executeDataRequestPlan')refreshed=await recoverOperation(()=>journal.getResearchResult({research_request_id:input.plan_id,_commerce_context:scope(run.task.principal)}));
    else{
     const recovered=(await recoverOperation(()=>journal.taskOperation('recover_research_call',{source_call_id:input._commerce_context.source_call_id,_commerce_context:scope(run.task.principal)}))).payload;
     if(!recovered.terminal){if(researchResultPending((recovered.result??{}) as Record<string,unknown>))throw new ResearchProcessingPendingError();throw new ResearchRecoveryRequiredError();}
     refreshed={payload:recovered.result,isError:false,resultBytes:Buffer.byteLength(JSON.stringify(recovered.result))};
    }
    if(researchResultPending(refreshed.payload))throw new ResearchProcessingPendingError();
    if(!researchResultTerminal(refreshed.payload))throw new ResearchRecoveryRequiredError();
    await checkpoint(journal,{...finalBase,action:'begin_operation'});
    await checkpoint(journal,{...finalBase,action:'complete_operation',result:refreshed});
    return refreshed;
   };
   const begun=(await checkpoint(journal,{...base,action:'begin_operation'})).payload;
   const op=begun.operation as {state:string;result:any};
   if(group==='control' && name==='reserve')run.reservationCallId=(args[1] as any).callId;
   if(group==='control' && name==='reserve' && op.state==='completed')run.reservationId=op.result.reservationId;
   if(group==='control' && name==='dispatch')run.reservationId=String(args[1]);
   if(op.state==='completed'){
    if(provider&&researchResultPending(op.result?.payload??{}))return refresh();
    if(group==='control' && name==='reserve' && op.result.requiresApproval && control){
     const live=await control.revalidate(run.task.principal,op.result.reservationId);
     return {...op.result,requiresApproval:live.approvalState==='pending',approvalState:live.approvalState};
    }
    if(op.result?.payload?.dispatch_phase==='not_dispatched')throw new ProviderNotDispatchedError(op.result.payload.error?.details?.reasonCode??'ADMISSION_REJECTED');
    return op.result;
   }
   let result:unknown;
   if(!begun.fresh && ['callEndpoint','executeDataRequestPlan','dispatch','executeMarketplaceProductResearchPlan'].includes(String(name))){
    // An ambiguous side effect is never sent again. Recover the original source result only.
    const input=args[0] as Record<string,any>;
    if(group==='control' && name==='dispatch' && control){
     const live=await recoverOperation(()=>control.revalidate(run.task.principal,String(args[1])));
     const payload=args[2] as Record<string,unknown>;
     if(live.reservationId!==args[1] || !run.reservationCallId || live.sourceCallId!==run.reservationCallId ||
       live.endpointId!==payload.endpoint_id || live.parameterHash!==hashExternalDataParameters(payload.params))throw new Error('TASK_DISPATCH_RECEIPT_MISMATCH');
     if(run.control.lost)throw new ResearchRecoveryRequiredError('TASK_LEASE_LOST');
     if(live.state==='dispatched')result=null;
     else if(live.state==='reserved'){await recoverOperation(()=>method.apply(object,args));result=null;}
    }else if(provider)result=await refresh();
    if(result===undefined){run.control.recover=true;throw new ResearchRecoveryRequiredError();}
   }else {
    try{result=await method.apply(object,args);}catch(error){
     const e=error as {code?:string;status?:number};
     const provider=group==='upstream'&&['callEndpoint','executeDataRequestPlan'].includes(String(name));
     if(!provider && (!e.code || e.code==='CALL_FAILED'||e.code==='CONTROL_UNAVAILABLE'||(e.status??0)>=500))throw new ResearchRecoveryRequiredError();
     if(group==='control'&&name==='reserve'&&error instanceof ExternalDataControlError)throw new ExternalDataControlError(error.message,error.code,error.status,{...error.details,providerDispatched:false,scope:'current_step'});
     throw error;
    }
   }
   if(group==='control' && name==='reserve')run.reservationId=(result as any).reservationId;
   await checkpoint(journal,{...base,action:'complete_operation',result});
   if(provider&&researchResultPending((result as any)?.payload??{}))throw new ResearchProcessingPendingError();
   return result;
  };
 }});
}
async function recoverOperation<T>(read:()=>Promise<T>){try{return await read();}catch(error){const e=error as {code?:string;status?:number};if(!e.code||e.code==='CALL_FAILED'||(e.status??0)>=500)throw new ResearchRecoveryRequiredError();throw error;}}
async function checkpoint(journal:ExternalDataServiceMcpClient,args:Record<string,unknown>){try{return await journal.taskOperation('update_research_task',args);}catch{throw new ResearchRecoveryRequiredError();}}
export async function enqueueTask(upstream:ExternalDataServiceMcpClient,p:AuthenticatedMcpPrincipal,kind:Task['kind'],inputs:Record<string,unknown>){
 return (await upstream.taskOperation('submit_research_task',{kind,source:p.rootThreadId?'codex_harness':'external_mcp',idempotency_key:inputs.idempotency_key,inputs,principal:p,_commerce_context:scope(p)})).payload;
}
export async function getTask(upstream:ExternalDataServiceMcpClient,p:AuthenticatedMcpPrincipal,id:string){return (await upstream.taskOperation('read_research_task',{task_id:id,_commerce_context:scope(p)})).payload;}
export function startResearchTaskWorker(upstream:ExternalDataServiceMcpClient,execute:(task:Task)=>Promise<any>){
 let active=0,stopped=false;
 const idle=new IdleBackoff();
 const tick=async()=>{
  if(stopped || active>=2||!idle.ready())return;active++;
  let task:Task|undefined,lease=randomUUID();
  try{
   const claimed=(await upstream.taskOperation('claim_research_task',{lease_id:lease,issued_at:new Date().toISOString()})).payload;task=claimed.task as Task|undefined;idle.observed(!!task);if(!task)return;
   const run:Run={task,lease,sequence:0,control:{recover:false,lost:false}};
   const base={task_id:task.id,lease_id:lease,_commerce_context:scope(task.principal)};
   const heartbeat=setInterval(()=>{void upstream.taskOperation('update_research_task',{...base,action:'heartbeat'}).then(r=>{if(r.payload.cancel_requested)run.control.lost=true;}).catch(()=>{run.control.lost=true;});},20_000);
   let response:any,processingPending=false;
   try{response=await current.run(run,()=>execute(task!));}
   catch(error){
    if(error instanceof ResearchProcessingPendingError)processingPending=true;
    const code=(error as {code?:string;message?:string}).code??(error as Error).message;
    const failure=permanentResearchFailure(error);
    if(code==='TASK_CANCELLED'){run.control.lost=true;}
    else if(failure){const currentTask=await getTask(upstream,task!.principal,task!.id);response={payload:{...failure,partial_results:currentTask.partial_results??[]}};}
    else run.control.recover=true;
   }
   finally{clearInterval(heartbeat);}
   if(run.control.lost)return;
   if(processingPending||researchTaskNeedsRecovery(response?.structuredContent??response?.payload??{})){await upstream.taskOperation('update_research_task',{...base,action:'wait'});return;}
   if(run.control.recover && (task.recovery_failures??0)<4){await upstream.taskOperation('update_research_task',{...base,action:'retry'});return;}
   const payload=response?.structuredContent ?? response?.payload ?? {success:false,error:{code:'TASK_RECONCILIATION_REQUIRED',message:'任务执行中断，保留原任务及调用记录待对账。'}};
   const state=run.control.recover?'reconciliation_required':researchTaskOutcome(payload);
   await upstream.taskOperation('update_research_task',{...base,action:'finish',state,result:payload,error_code:payload.error?.code,...(state==='waiting_approval'?{approval:payload.error?.details??{}}:{})});
  }catch{idle.observed(false);console.error(JSON.stringify({event:'research_task_worker_retry',task_id:task?.id??null}));}
  finally{active--;}
 };
 const timer=setInterval(()=>void tick(),1000);
 return ()=>{stopped=true;clearInterval(timer);};
}
