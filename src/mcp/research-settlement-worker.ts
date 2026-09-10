import {randomUUID} from 'node:crypto';
import type {ExternalDataServiceMcpClient} from '../integrations/external-data-service-mcp-client.js';
import type {ExternalDataControlClient,AuthenticatedMcpPrincipal} from '../integrations/external-data-control-client.js';
export async function drainResearchSettlement(upstream:ExternalDataServiceMcpClient,control:ExternalDataControlClient){
 const lease=randomUUID();const claim=await upstream.taskOperation('claim_research_settlement',{lease_id:lease});
 const job=claim.payload.job as {reservation_id:string;principal:AuthenticatedMcpPrincipal;payload:Parameters<ExternalDataControlClient['settle']>[2]}|null;
 if(!job)return false;
 let succeeded=false,code:string|null=null;
 try{await control.settle(job.principal,job.reservation_id,job.payload);succeeded=true;}
 catch(error){const candidate=(error as {code?:unknown}).code;code=typeof candidate==='string'&&/^[A-Z0-9_]{1,100}$/.test(candidate)?candidate:'SETTLEMENT_TRANSPORT_FAILED';}
 await upstream.taskOperation('finish_research_settlement',{reservation_id:job.reservation_id,lease_id:lease,succeeded,error_code:code,
  _commerce_context:{tenant_id:job.principal.tenantId,workspace_id:job.principal.workspaceId,user_id:job.principal.userId}});
 return true;
}
export function startResearchSettlementWorker(upstream:ExternalDataServiceMcpClient,control:ExternalDataControlClient){
 let busy=false;const timer=setInterval(()=>{if(busy)return;busy=true;void drainResearchSettlement(upstream,control).catch(()=>console.error(JSON.stringify({event:'research_settlement_worker_unavailable'}))).finally(()=>{busy=false;});},2000);
 return ()=>clearInterval(timer);
}
