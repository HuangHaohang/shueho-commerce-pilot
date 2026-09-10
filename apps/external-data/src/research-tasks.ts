import { database,withScope } from './database.js';
import { sha256Json } from './canonical.js';
import type { JsonObject } from './types.js';

type Scope={tenantId:string;workspaceId:string;userId:string;rootThreadId?:string|null};
export async function submitResearchTask(scope:Scope,input:JsonObject) {
 if(JSON.stringify(input).length>262144)throw new Error("TASK_INPUT_TOO_LARGE");
 const principal=input.principal as JsonObject;
 if(principal.tenantId!==scope.tenantId || principal.workspaceId!==scope.workspaceId || principal.userId!==scope.userId)throw new Error('Task principal mismatch');
 const hash=sha256Json({kind:input.kind,inputs:input.inputs,source:input.source,principal});
 return withScope(scope,async c=>{
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`research-submit:${scope.tenantId}:${scope.workspaceId}`]);
  const existing=await c.query('SELECT id FROM research_task WHERE user_id=$1 AND source=$2 AND idempotency_key=$3',[scope.userId,input.source,input.idempotency_key]);
  if(!existing.rowCount){
   const pending=await c.query("SELECT count(*)::int AS count FROM research_task WHERE state IN ('queued','running','waiting_approval')");
   if(pending.rows[0].count>=100)throw new Error('TASK_QUEUE_CAPACITY');
  }
  const args=[scope.tenantId,scope.workspaceId,scope.userId,input.source,input.idempotency_key];
  await c.query(`INSERT INTO research_task(tenant_id,workspace_id,user_id,source,idempotency_key,input_hash,kind,inputs,principal)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) ON CONFLICT DO NOTHING`,[...args,hash,input.kind,JSON.stringify(input.inputs),JSON.stringify(principal)]);
  const row=(await c.query(`SELECT * FROM research_task WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3 AND source=$4 AND idempotency_key=$5`,args)).rows[0];
  if(!row || row.input_hash!==hash)throw new Error('TASK_IDEMPOTENCY_CONFLICT');
  return taskReceipt(row);
 });
}
export async function readResearchTask(scope:Scope,id:string){return withScope(scope,async c=>{
 const row=(await c.query(`SELECT t.*,COALESCE(f.state,t.state) AS state FROM research_task t LEFT JOIN research_task_readback_correction f ON f.task_id=t.id WHERE t.id=$1 AND user_id=$2`,[id,scope.userId])).rows[0];
 if(!row)throw new Error('TASK_NOT_FOUND');
 if(scope.rootThreadId && row.principal.rootThreadId!==scope.rootThreadId)throw new Error('TASK_NOT_FOUND');
 const operations=await c.query(`SELECT operation_name,state,count(*)::int AS count FROM research_task_operation WHERE task_id=$1 GROUP BY operation_name,state`,[id]);
 const partial=await c.query(`SELECT DISTINCT result#>>'{payload,research_request_id}' AS research_request_id FROM research_task_operation
  WHERE task_id=$1 AND state='completed' AND result#>>'{payload,research_request_id}' IS NOT NULL`,[id]);
 const billing=(await c.query(`SELECT count(*)::int AS total,count(*) FILTER(WHERE state='completed')::int AS completed,
 count(*) FILTER(WHERE state IN ('pending','running'))::int AS pending,count(*) FILTER(WHERE state='attention_required')::int AS attention_required
 FROM research_settlement_outbox WHERE task_id=$1`,[id])).rows[0];
 return {...taskReceipt(row),progress:operations.rows,partial_results:partial.rows,
  settlement:{...billing,state:billing.attention_required?'attention_required':billing.pending?'pending':billing.total?'completed':'not_enqueued'}};
});}
export async function claimResearchTask(leaseId:string,issuedAt?:string){const r=await database.query(issuedAt?'SELECT * FROM claim_research_task_v2($1,$2)':'SELECT * FROM claim_research_task($1)',issuedAt?[leaseId,issuedAt]:[leaseId]);return {success:true,task:r.rows[0]??null};}
export async function updateResearchTask(scope:Scope,input:JsonObject){return withScope(scope,async c=>{
 const finalizing=input.action==='complete_operation' || input.action==='begin_operation' && input.operation_name==='control.settle';
 const row=(await c.query(`SELECT * FROM research_task WHERE id=$1 AND user_id=$2 AND lease_id=$3 AND
  ((state='running' AND lease_until>clock_timestamp()) OR (state='cancelled' AND $4::boolean)) FOR UPDATE`,[input.task_id,scope.userId,input.lease_id,finalizing])).rows[0];
 if(!row)throw new Error('TASK_LEASE_LOST');
 if(row.cancel_requested_at && !finalizing && !['heartbeat','finish'].includes(String(input.action)))throw new Error('TASK_CANCELLED');
 if(input.action==='heartbeat')await c.query(`UPDATE research_task SET lease_until=clock_timestamp()+INTERVAL '90 seconds',updated_at=clock_timestamp() WHERE id=$1`,[input.task_id]);
 else if(input.action==='finish')await c.query(`UPDATE research_task SET state=$2,result=$3::jsonb,approval=$4::jsonb,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`,[input.task_id,input.state,JSON.stringify(input.result??{}),JSON.stringify(input.approval??null)]);
 else if(input.action==='retry')await c.query(`UPDATE research_task SET state='queued',lease_until=NULL,next_run_at=clock_timestamp()+INTERVAL '15 seconds',updated_at=clock_timestamp() WHERE id=$1`,[input.task_id]);
 else {
  const hash=String(input.input_hash);
  const inserted=await c.query(`INSERT INTO research_task_operation(task_id,operation_key,input_hash,operation_name,state,operation_context) VALUES($1,$2,$3,$4,'started',$5::jsonb) ON CONFLICT DO NOTHING RETURNING task_id`,[input.task_id,input.operation_key,hash,input.operation_name,JSON.stringify(input.operation_context??{})]);
  const op=(await c.query(`SELECT * FROM research_task_operation WHERE task_id=$1 AND operation_key=$2`,[input.task_id,input.operation_key])).rows[0];
  if(op.input_hash!==hash)throw new Error('TASK_OPERATION_CONFLICT');
  if(input.action==='complete_operation' && op.state!=='completed')await c.query(`UPDATE research_task_operation SET state='completed',result=$3::jsonb,completed_at=clock_timestamp() WHERE task_id=$1 AND operation_key=$2`,[input.task_id,input.operation_key,JSON.stringify(input.result)]);
  return {success:true,operation:op,fresh:inserted.rowCount===1};
 }
 return {success:true,cancel_requested:!!row.cancel_requested_at};
});}
export async function manageResearchTask(scope:Scope,input:JsonObject):Promise<Record<string,any>>{
 if(input.action==='list')return withScope(scope,async c=>{
  const rows=await c.query(`SELECT t.*,COALESCE(f.state,t.state) AS state FROM research_task t LEFT JOIN research_task_readback_correction f ON f.task_id=t.id WHERE user_id=$1 AND ($2::uuid IS NULL OR t.id<$2) AND ($3::text IS NULL OR principal->>'rootThreadId'=$3) ORDER BY t.id DESC LIMIT $4`,[scope.userId,input.cursor??null,scope.rootThreadId??null,Number(input.limit??20)+1]);
  const more=rows.rows.length>Number(input.limit??20);const page=rows.rows.slice(0,Number(input.limit??20));
  return {success:true,tasks:page.map(r=>({...taskReceipt(r),result:undefined})),next_cursor:more?page.at(-1)?.id:null};
 });
 await readResearchTask(scope,String(input.task_id));
 return withScope(scope,async c=>{
  const task=(await c.query('SELECT * FROM research_task WHERE id=$1 FOR UPDATE',[input.task_id])).rows[0];
  if(input.action==='resume' && typeof input.approval_reservation_id!=='string')throw new Error('TASK_APPROVAL_RECEIPT_REQUIRED');
  if((input.action==='resume'||input.approval_reservation_id) && task.approval?.reservationId!==input.approval_reservation_id)throw new Error('TASK_APPROVAL_RECEIPT_MISMATCH');
  if(input.action==='cancel' && ['queued','waiting_approval','running'].includes(task.state)){
   await c.query(`UPDATE research_task SET cancel_requested_at=clock_timestamp(),state='cancelled',lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`,[task.id]);
  }else if(input.action==='resume' && task.state==='waiting_approval'){
   await c.query(`UPDATE research_task SET state='queued',next_run_at=clock_timestamp(),lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1`,[task.id]);
  }
  return taskReceipt((await c.query('SELECT * FROM research_task WHERE id=$1',[task.id])).rows[0]);
 });
}
export async function researchQueueHealth(){return {...(await database.query('SELECT research_queue_health() AS health')).rows[0].health,
 ...(await database.query('SELECT research_settlement_health() AS health')).rows[0].health};}
function taskReceipt(row:Record<string,any>){return {success:true,task_id:row.id,state:row.state,kind:row.kind,created_at:row.created_at,updated_at:row.updated_at,
 execution_version:row.execution_version,cancel_requested:!!row.cancel_requested_at,approval:row.approval??null,
 polling:{action:['queued','running'].includes(row.state)?'poll_same_task':'stop',retryAfterSeconds:['queued','running'].includes(row.state)?15:null},
 result:row.result??null};}
