import {randomUUID} from 'node:crypto';import {Pool} from 'pg';import {describe,it,expect,afterAll,beforeAll} from 'vitest';
import {config} from './config.js';import {database} from './database.js';
import {submitResearchTask,claimResearchTask,readResearchTask,updateResearchTask,manageResearchTask} from './research-tasks.js';
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.NODE_ENV==='test';
const url=process.env.JUSTONEAPI_TEST_DATABASE_URL??(ci?process.env.EXTERNAL_DATA_DATABASE_URL:undefined);
const ownerUrl=process.env.JUSTONEAPI_TEST_MIGRATION_DATABASE_URL??(ci?process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL:undefined);
const owner=new Pool({connectionString:ownerUrl});
describe.skipIf(!url||!ownerUrl)('durable research queue with PostgreSQL',()=>{
 beforeAll(()=>{expect(config.databaseUrl).toBe(url);});afterAll(async()=>{await database.end();await owner.end();});
 it('deduplicates scoped submissions, fences leases, recovers abandoned tasks and isolates results',async()=>{
  const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture'};
  const input={source:'external_mcp',kind:'social',idempotency_key:randomUUID(),inputs:{keyword:'fixture'},principal:scope};
  const [a,b]=await Promise.all([submitResearchTask(scope,input),submitResearchTask(scope,input)]);expect(a.task_id).toBe(b.task_id);
  await expect(submitResearchTask(scope,{...input,inputs:{keyword:'different'}})).rejects.toThrow('CONFLICT');
  await expect(readResearchTask({...scope,workspaceId:randomUUID()},a.task_id)).rejects.toThrow('NOT_FOUND');
  const lease=randomUUID();const c=await claimResearchTask(lease);expect(c.task.id).toBe(a.task_id);
  expect((await claimResearchTask(lease)).task.id).toBe(a.task_id);
  expect((await claimResearchTask(randomUUID())).task).toBeNull();
  const base={task_id:a.task_id,lease_id:lease,operation_key:'1:call',operation_name:'call',input_hash:'a'};
  expect((await updateResearchTask(scope,{...base,action:'begin_operation'})).fresh).toBe(true);
  await updateResearchTask(scope,{...base,action:'complete_operation',result:{value:7}});
  await owner.query("UPDATE research_task SET lease_until=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[a.task_id]);
  const replacement=randomUUID();expect((await claimResearchTask(replacement)).task.id).toBe(a.task_id);
  await expect(updateResearchTask(scope,{...base,action:'heartbeat'})).rejects.toThrow('LEASE_LOST');
  const replay=await updateResearchTask(scope,{...base,lease_id:replacement,action:'begin_operation'});expect(replay.operation.result).toEqual({value:7});
  await updateResearchTask(scope,{task_id:a.task_id,lease_id:replacement,action:'finish',state:'completed',result:{success:true}});
  expect((await readResearchTask(scope,a.task_id)).state).toBe('completed');
  await expect(owner.query("UPDATE research_task SET inputs='{}' WHERE id=$1",[a.task_id])).rejects.toThrow('immutable');
  const unscoped=await database.query('SELECT * FROM research_task');expect(unscoped.rowCount).toBe(0);
 });
 it('an empty claim replay never consumes a later task; cancellation fences further work',async()=>{
  const emptyLease=randomUUID();expect((await claimResearchTask(emptyLease)).task).toBeNull();
  const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture'};
  const task=await submitResearchTask(scope,{source:'external_mcp',kind:'data',idempotency_key:randomUUID(),inputs:{},principal:scope});
  expect((await claimResearchTask(emptyLease)).task).toBeNull();
  const lease=randomUUID();expect((await claimResearchTask(lease)).task.id).toBe(task.task_id);
  expect((await manageResearchTask(scope,{action:'cancel',task_id:task.task_id})).state).toBe('cancelled');
  await expect(updateResearchTask(scope,{task_id:task.task_id,lease_id:lease,action:'begin_operation',operation_key:'no_dispatch',operation_name:'call',input_hash:'hash'})).rejects.toThrow('LEASE_LOST');
 });
 it('approval waits persist and resume the same immutable task',async()=>{
  const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture'};
  const t=await submitResearchTask(scope,{source:'external_mcp',kind:'data',idempotency_key:randomUUID(),inputs:{},principal:scope});
  const lease=randomUUID();await claimResearchTask(lease);
  const reservationId=randomUUID();
  await updateResearchTask(scope,{task_id:t.task_id,lease_id:lease,action:'finish',state:'waiting_approval',approval:{reservationId},result:{success:false,error:{code:'APPROVAL_REQUIRED'}}});
  expect((await readResearchTask(scope,t.task_id)).state).toBe('waiting_approval');
  await expect(manageResearchTask(scope,{action:'resume',task_id:t.task_id})).rejects.toThrow('RECEIPT_REQUIRED');
  await expect(manageResearchTask(scope,{action:'resume',task_id:t.task_id,approval_reservation_id:randomUUID()})).rejects.toThrow('RECEIPT_MISMATCH');
  expect((await manageResearchTask(scope,{action:'resume',task_id:t.task_id,approval_reservation_id:reservationId})).state).toBe('queued');
  const replacement=randomUUID();expect((await claimResearchTask(replacement)).task.id).toBe(t.task_id);
  await updateResearchTask(scope,{task_id:t.task_id,lease_id:replacement,action:'finish',state:'completed',result:{success:true}});
 });
 it('lists newest tasks with microsecond-safe cursors and retains legacy UUID pagination',async()=>{
  const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'listing'};
  const suffix=randomUUID().slice(8);const ids=['00000000'+suffix,'00000001'+suffix,'ffffffff'+suffix];
  for(let n=0;n<ids.length;n++)await owner.query(`INSERT INTO research_task(id,tenant_id,workspace_id,user_id,source,idempotency_key,input_hash,kind,inputs,principal,state,created_at)
   VALUES($1,$2,$3,$4,'external_mcp',$5,'fixture','data','{}',$6::jsonb,'completed',$7::timestamptz)`,[ids[n],scope.tenantId,scope.workspaceId,scope.userId,randomUUID(),JSON.stringify(scope),`2026-09-10T00:00:00.00000${3-n}Z`]);
  const first=await manageResearchTask(scope,{action:'list',limit:1});expect(first.tasks[0].task_id).toBe(ids[0]);
  const second=await manageResearchTask(scope,{action:'list',limit:1,cursor:first.next_cursor});expect(second.tasks[0].task_id).toBe(ids[1]);
  const third=await manageResearchTask(scope,{action:'list',limit:1,cursor:second.next_cursor});expect(third.tasks[0].task_id).toBe(ids[2]);expect(third.next_cursor).toBeNull();
  expect((await manageResearchTask({...scope,workspaceId:randomUUID()},{action:'list',cursor:first.next_cursor})).tasks).toHaveLength(0);
  const legacy=await manageResearchTask(scope,{action:'list',cursor:ids[2],limit:1});expect(legacy.tasks[0].task_id).toBe(ids[1]);expect(legacy.next_cursor).toBe(ids[1]);
  await expect(manageResearchTask(scope,{action:'list',cursor:'bad'})).rejects.toThrow('INVALID_TASK_CURSOR');
 });

 it('operation inspection is read-only; processing waits do not consume fault retries and expire safely',async()=>{
  const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'wait-fixture'},task=randomUUID(),lease=randomUUID();
  await owner.query(`INSERT INTO research_task(id,tenant_id,workspace_id,user_id,source,idempotency_key,input_hash,kind,inputs,principal,state,lease_id,lease_until,attempts)
   VALUES($1,$2,$3,$4,'external_mcp',$5,'fixture','data','{}',$6::jsonb,'running',$7,clock_timestamp()+INTERVAL '90 seconds',1)`,[task,scope.tenantId,scope.workspaceId,scope.userId,randomUUID(),JSON.stringify(scope),lease]);
  const base={task_id:task,lease_id:lease};
  expect((await updateResearchTask(scope,{...base,action:'read_operation',operation_key:'provider',input_hash:'fixture'})).operation).toBeNull();
  expect(Number((await owner.query('SELECT count(*) FROM research_task_operation WHERE task_id=$1',[task])).rows[0].count)).toBe(0);
  for(let n=0;n<6;n++){
   await updateResearchTask(scope,{...base,action:'wait'});
   expect((await readResearchTask(scope,task)).state).toBe('queued');
   await owner.query("UPDATE research_task SET state='running',attempts=attempts+1,lease_until=clock_timestamp()+INTERVAL '90 seconds' WHERE id=$1",[task]);
  }
  expect(Number((await owner.query('SELECT recovery_failures FROM research_task WHERE id=$1',[task])).rows[0].recovery_failures)).toBe(0);
  await updateResearchTask(scope,{...base,action:'retry'});
  expect(Number((await owner.query('SELECT recovery_failures FROM research_task WHERE id=$1',[task])).rows[0].recovery_failures)).toBe(1);
  await owner.query("UPDATE research_task SET state='running',lease_until=clock_timestamp()+INTERVAL '90 seconds',processing_wait_started_at=clock_timestamp()-INTERVAL '16 minutes' WHERE id=$1",[task]);
  await updateResearchTask(scope,{...base,action:'wait'});const result=await readResearchTask(scope,task);
  expect(result.state).toBe('reconciliation_required');expect(result.result.error.code).toBe('PROCESSING_WAIT_TIMEOUT');
 });

});
