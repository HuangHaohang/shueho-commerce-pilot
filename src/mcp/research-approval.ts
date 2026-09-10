import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {ExternalDataServiceMcpClient} from '../integrations/external-data-service-mcp-client.js';
import type {ExternalDataControlClient,AuthenticatedMcpPrincipal} from '../integrations/external-data-control-client.js';
import {getTask} from './research-task-runtime.js';

/** Business approval only. Agent questions and Harness permissions retain their native owners. */
export function researchApprovalHandler(server:McpServer,upstream:ExternalDataServiceMcpClient,control:ExternalDataControlClient,p:AuthenticatedMcpPrincipal){
 const pending=new Map<string,{work:Promise<Record<string,any>>;seen:Set<string>}>();
 const owner={tenant_id:p.tenantId,workspace_id:p.workspaceId,user_id:p.userId,root_thread_id:p.rootThreadId??null};
 const manage=(id:string,action:'resume'|'cancel',reservationId:string)=>upstream.taskOperation('manage_research_task',{action,task_id:id,approval_reservation_id:reservationId,_commerce_context:owner});
 async function resolve(id:string,signal?:AbortSignal,native=false,seen?:Set<string>){
  await control.authorizeCatalog(p);let task=await getTask(upstream,p,id);
  const approval=task.approval as Record<string,any>|undefined;
  if(task.state!=='waiting_approval'||!approval?.reservationId)return task;
  // An approval reply may have been lost after the financial transaction committed.
  let live;
  try{live=await control.revalidate(p,approval.reservationId);}catch(error){
   const fresh=await getTask(upstream,p,id);
   if(fresh.state!=='waiting_approval'||((fresh.approval??{}) as Record<string,unknown>).reservationId!==approval.reservationId)return fresh;
   throw error;
  }
  const fresh=await getTask(upstream,p,id);
  if(fresh.state!=='waiting_approval'||((fresh.approval??{}) as Record<string,unknown>).reservationId!==approval.reservationId)return fresh;
  if(live.state==='cancelled'||live.approvalState==='denied'){await manage(id,'cancel',approval.reservationId);return getTask(upstream,p,id);}
  if(live.state==='reserved'&&['approved','not_required'].includes(live.approvalState)){await manage(id,'resume',approval.reservationId);return getTask(upstream,p,id);}
  if(live.state!=='reserved'||live.approvalState!=='pending')throw new Error('APPROVAL_RECEIPT_STATE_INVALID');
  if(!server.server.getClientCapabilities()?.elicitation?.form)return task;
  if(seen?.has(approval.reservationId))return task;
  const amount=approval.billableAmountMicros;
  const message=typeof amount==='number'&&Number.isFinite(amount)?`此任务需要批准一次数据调用，费用 ${amount/1000000} ${approval.currency??'CNY'}。`:'此任务缺少可核实的报价，请核实服务端定价后再批准。';
  if(typeof amount!=='number'||!Number.isFinite(amount))throw new Error('APPROVAL_PRICE_UNAVAILABLE');
  seen?.add(approval.reservationId);
  const response=await server.server.elicitInput({mode:'form',message,requestedSchema:{type:'object',properties:{approve:{type:'boolean',title:'批准本次调用'}},required:['approve']},...(native?{_meta:{'io.modelcontextprotocol/related-task':{taskId:id}}}:{})},{signal});
  if(response.action==='accept'&&response.content?.approve===true){
   try{await control.approve(p,approval.reservationId);}catch(error){
    const latest=await getTask(upstream,p,id);
    if(latest.state!=='waiting_approval'||((latest.approval??{}) as Record<string,unknown>).reservationId!==approval.reservationId)return latest;
    live=await control.revalidate(p,approval.reservationId);
    const after=await getTask(upstream,p,id);
    if(after.state!=='waiting_approval'||((after.approval??{}) as Record<string,unknown>).reservationId!==approval.reservationId)return after;
    if(live.state!=='reserved'||live.approvalState!=='approved')throw error;
   }
   const latest=await getTask(upstream,p,id);
   if(latest.state!=='waiting_approval'||((latest.approval??{}) as Record<string,unknown>).reservationId!==approval.reservationId)return latest;
   await manage(id,'resume',approval.reservationId);
  }else if(response.action==='decline'||response.action==='accept'&&response.content?.approve===false){
   // Persist cancellation first. Its durable release outbox owns financial cleanup.
   await manage(id,'cancel',approval.reservationId);
  }
  return getTask(upstream,p,id);
 }
 return (id:string,signal?:AbortSignal,native=false,seen?:Set<string>)=>{
  const existing=pending.get(id);
  if(existing)return existing.work.finally(()=>{for(const key of existing.seen)seen?.add(key);});
  const requested=new Set(seen);
  const work=resolve(id,signal,native,requested).finally(()=>{for(const key of requested)seen?.add(key);if(pending.get(id)?.work===work)pending.delete(id);});
  pending.set(id,{work,seen:requested});return work;
 };
}
