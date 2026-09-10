import {database,withScope} from './database.js';
import {sha256Json} from './canonical.js';
import type {JsonObject} from './types.js';
type Scope={tenantId:string;workspaceId:string;userId:string};
export async function enqueueSettlement(scope:Scope,taskId:string,reservationId:string,payload:JsonObject){
 return withScope(scope,async c=>{
  const owned=await c.query(`SELECT 1 FROM research_task t JOIN research_task_operation op ON op.task_id=t.id
   WHERE t.id=$1 AND t.user_id=$2 AND op.operation_name='control.reserve' AND op.state='completed' AND op.result->>'reservationId'=$3`,[taskId,scope.userId,reservationId]);
  if(!owned.rowCount)throw new Error('SETTLEMENT_RESERVATION_NOT_OWNED');
  const hash=sha256Json(payload);
  await c.query(`INSERT INTO research_settlement_outbox(reservation_id,task_id,tenant_id,workspace_id,user_id,payload,payload_hash)
   VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT DO NOTHING`,[reservationId,taskId,scope.tenantId,scope.workspaceId,scope.userId,JSON.stringify(payload),hash]);
  const row=(await c.query('SELECT payload_hash,state FROM research_settlement_outbox WHERE reservation_id=$1',[reservationId])).rows[0];
  if(!row||row.payload_hash!==hash)throw new Error('SETTLEMENT_PAYLOAD_CONFLICT');return {success:true,state:row.state};
 });
}
export async function claimSettlement(id:string){return {success:true,job:(await database.query('SELECT * FROM claim_research_settlement($1)',[id])).rows[0]??null};}
export async function finishSettlement(scope:Scope,reservationId:string,leaseId:string,success:boolean,code:string|null){
 return withScope(scope,async c=>{
  const result=await c.query(`UPDATE research_settlement_outbox SET state=CASE WHEN $3 THEN 'completed' WHEN attempts>=20 THEN 'attention_required' ELSE 'pending' END,
   completed_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,next_run_at=clock_timestamp()+LEAST(300,5*power(2,LEAST(attempts,6))) * INTERVAL '1 second',
   lease_until=NULL,last_error_code=$4 WHERE reservation_id=$1 AND lease_id=$2 AND state='running' AND user_id=$5 RETURNING state`,[reservationId,leaseId,success,code,scope.userId]);
  return {success:true,state:result.rows[0]?.state??'unchanged'};
 });
}
