import { database,withScope } from './database.js';
import { sha256Json } from './canonical.js';
import type { JsonObject } from './types.js';

type Scope={tenantId:string;workspaceId:string;userId:string};
export async function submitResearchTask(scope:Scope,input:JsonObject) {
 if(JSON.stringify(input).length>262144)throw new Error("TASK_INPUT_TOO_LARGE");
 const principal=input.principal as JsonObject;
 if(principal.tenantId!==scope.tenantId || principal.workspaceId!==scope.workspaceId || principal.userId!==scope.userId)throw new Error('Task principal mismatch');
 const hash=sha256Json({kind:input.kind,inputs:input.inputs,source:input.source,principal});
 return withScope(scope,async c=>{
  const args=[scope.tenantId,scope.workspaceId,scope.userId,input.source,input.idempotency_key];
  await c.query(`INSERT INTO research_task(tenant_id,workspace_id,user_id,source,idempotency_key,input_hash,kind,inputs,principal)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) ON CONFLICT DO NOTHING`,[...args,hash,input.kind,JSON.stringify(input.inputs),JSON.stringify(principal)]);
  const row=(await c.query(`SELECT * FROM research_task WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3 AND source=$4 AND idempotency_key=$5`,args)).rows[0];
  if(!row || row.input_hash!==hash)throw new Error('TASK_IDEMPOTENCY_CONFLICT');
  return taskReceipt(row);
 });
}
export async function readResearchTask(scope:Scope,id:string){return withScope(scope,async c=>{
 const row=(await c.query(`SELECT * FROM research_task WHERE id=$1 AND user_id=$2`,[id,scope.userId])).rows[0];
 if(!row)throw new Error('TASK_NOT_FOUND');
 const operations=await c.query(`SELECT operation_name,state,count(*)::int AS count FROM research_task_operation WHERE task_id=$1 GROUP BY operation_name,state`,[id]);
 return {...taskReceipt(row),progress:operations.rows};
});}
export async function claimResearchTask(leaseId:string){const r=await database.query('SELECT * FROM claim_research_task($1)',[leaseId]);return {success:true,task:r.rows[0]??null};}
export async function updateResearchTask(scope:Scope,input:JsonObject){return withScope(scope,async c=>{
 const row=(await c.query(`SELECT * FROM research_task WHERE id=$1 AND user_id=$2 AND state='running' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE`,[input.task_id,scope.userId,input.lease_id])).rows[0];
 if(!row)throw new Error('TASK_LEASE_LOST');
 if(input.action==='heartbeat')await c.query(`UPDATE research_task SET lease_until=clock_timestamp()+INTERVAL '90 seconds',updated_at=clock_timestamp() WHERE id=$1`,[input.task_id]);
 else if(input.action==='finish')await c.query(`UPDATE research_task SET state=$2,result=$3::jsonb,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`,[input.task_id,input.state,JSON.stringify(input.result??{})]);
 else if(input.action==='retry')await c.query(`UPDATE research_task SET state='queued',lease_until=NULL,next_run_at=clock_timestamp()+INTERVAL '15 seconds',updated_at=clock_timestamp() WHERE id=$1`,[input.task_id]);
 else {
  const hash=String(input.input_hash);
  const inserted=await c.query(`INSERT INTO research_task_operation(task_id,operation_key,input_hash,operation_name,state) VALUES($1,$2,$3,$4,'started') ON CONFLICT DO NOTHING RETURNING task_id`,[input.task_id,input.operation_key,hash,input.operation_name]);
  const op=(await c.query(`SELECT * FROM research_task_operation WHERE task_id=$1 AND operation_key=$2`,[input.task_id,input.operation_key])).rows[0];
  if(op.input_hash!==hash)throw new Error('TASK_OPERATION_CONFLICT');
  if(input.action==='complete_operation' && op.state!=='completed')await c.query(`UPDATE research_task_operation SET state='completed',result=$3::jsonb,completed_at=clock_timestamp() WHERE task_id=$1 AND operation_key=$2`,[input.task_id,input.operation_key,JSON.stringify(input.result)]);
  return {success:true,operation:op,fresh:inserted.rowCount===1};
 }
 return {success:true};
});}
function taskReceipt(row:Record<string,any>){return {success:true,task_id:row.id,state:row.state,kind:row.kind,created_at:row.created_at,updated_at:row.updated_at,
 polling:{action:['queued','running'].includes(row.state)?'poll_same_task':'stop',retryAfterSeconds:['queued','running'].includes(row.state)?15:null},
 result:row.result??null};}
