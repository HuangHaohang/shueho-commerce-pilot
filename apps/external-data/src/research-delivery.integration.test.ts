import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {config} from './config.js';import {database} from './database.js';import {readTaskRecords,readResearchRecords} from './research-records.js';
import {enqueueSettlement,claimSettlement,finishSettlement} from './research-settlements.js';
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.NODE_ENV==='test';
const url=process.env.JUSTONEAPI_TEST_DATABASE_URL??(ci?process.env.EXTERNAL_DATA_DATABASE_URL:undefined);
const ownerUrl=process.env.JUSTONEAPI_TEST_MIGRATION_DATABASE_URL??(ci?process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL:undefined);
const owner=new Pool({connectionString:ownerUrl});const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'delivery-fixture'};const task=randomUUID();
async function source(ids:number[]){
 const id=randomUUID();await owner.query(`INSERT INTO research_request(id,tenant_id,workspace_id,user_id,source,source_call_id,request_text,structured_intent,intent_key,status)
 VALUES($1::uuid,$2,$3,$4,'external_mcp',$1::uuid::text,'fixture','{}',$5,'completed')`,[id,scope.tenantId,scope.workspaceId,scope.userId,'a'.repeat(64)]);
 let ordinal=0;for(let n=0;n<ids.length;n++)for(const [key,value] of [['rateId',ids[n]],['content',`review-${ids[n]}`]]){
 await owner.query(`INSERT INTO provider_data_observation(tenant_id,workspace_id,research_request_id,ordinal,field_path,field_name,value_type,normalized_value,quality_status,reason_codes)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'valid','{}')`,[scope.tenantId,scope.workspaceId,id,ordinal++,`/data/comments/${n}/${key}`,key,typeof value,JSON.stringify(value)]);}
 await owner.query(`INSERT INTO research_task_operation(task_id,operation_key,input_hash,operation_name,state,result)
 VALUES($1,$2,'fixture','upstream.executeDataRequestPlan','completed',$3::jsonb)`,[task,id,JSON.stringify({payload:{research_request_id:id}})]);return id;
}
describe.skipIf(!url||!ownerUrl)('record snapshots and settlement recovery',()=>{
 beforeAll(async()=>{expect(config.databaseUrl).toBe(url);await owner.query(`INSERT INTO research_task(id,tenant_id,workspace_id,user_id,source,idempotency_key,input_hash,kind,inputs,principal,state)
 VALUES($1,$2,$3,$4,'external_mcp',$5,'fixture','data','{}',$6::jsonb,'completed')`,[task,scope.tenantId,scope.workspaceId,scope.userId,randomUUID(),JSON.stringify(scope)]);});
 afterAll(async()=>{await owner.end();await database.end();});
 it('pins record membership, deduplicates stable IDs and does not shift an old cursor when pages arrive',async()=>{
  const first=await source([1,2]);const snapshot=await readTaskRecords(scope,task,0,1);expect(snapshot.total_records).toBe(2);
  await source([2,3]);const next=await readTaskRecords(scope,task,1,1,snapshot.snapshot_id);expect(next.records[0]?.fields.rateId).toBe(2);expect(next.total_records).toBe(2);
  const current=await readTaskRecords(scope,task,0,50);expect(current.total_records).toBe(3);expect(current.duplicates_removed).toBe(1);
  await expect(readTaskRecords(scope,task,1,1)).rejects.toThrow('SNAPSHOT_REQUIRED');
  await expect(readTaskRecords({...scope,workspaceId:randomUUID()},task,0,1,snapshot.snapshot_id)).rejects.toThrow('NOT_FOUND');
  expect((await readResearchRecords(scope,first,1,1)).records[0].fields.rateId).toBe(2);
  expect(Number((await owner.query('SELECT count(*) FROM research_record_manifest WHERE research_request_id=$1',[first])).rows[0].count)).toBe(1);
 });
 it('retains settlement after task completion and fences retries with idempotent claim receipts',async()=>{
  const reservation=randomUUID();await owner.query(`INSERT INTO research_task_operation(task_id,operation_key,input_hash,operation_name,state,result) VALUES($1,'reserve','fixture','control.reserve','completed',$2::jsonb)`,[task,JSON.stringify({reservationId:reservation})]);
  const payload={state:'succeeded',upstreamCode:0,upstreamMessage:null,resultBytes:10,responsePayload:{success:true}};
  expect((await enqueueSettlement(scope,task,reservation,payload)).state).toBe('pending');await enqueueSettlement(scope,task,reservation,payload);
  await expect(enqueueSettlement(scope,task,reservation,{...payload,state:'business_failed'})).rejects.toThrow('CONFLICT');
  const lease=randomUUID();expect((await claimSettlement(lease)).job.reservation_id).toBe(reservation);expect((await claimSettlement(lease)).job.reservation_id).toBe(reservation);
  await finishSettlement(scope,reservation,lease,false,'TIMEOUT');
  await owner.query("UPDATE research_settlement_outbox SET next_run_at=clock_timestamp()-INTERVAL '1 second' WHERE reservation_id=$1",[reservation]);
  const replacement=randomUUID();await claimSettlement(replacement);
  expect((await finishSettlement(scope,reservation,lease,true,null)).state).toBe('unchanged');
  expect((await finishSettlement(scope,reservation,replacement,true,null)).state).toBe('completed');
  expect((await database.query('SELECT * FROM research_settlement_outbox')).rowCount).toBe(0);
 });
});
