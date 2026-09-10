import {describe,it,expect,vi,beforeAll,afterAll} from 'vitest';import {Pool} from 'pg';import {randomUUID} from 'node:crypto';
const holder=vi.hoisted(()=>({run:null as null|((fn:any)=>Promise<any>)}));
vi.mock('@/lib/enterprise/database-context',()=>({withEnterpriseTenantDatabaseContext:async(_s:any,fn:any)=>holder.run!(fn),withEnterpriseDatabaseContext:async(_s:any,fn:any)=>holder.run!(fn)}));
import {cancelExternalDataSource,reserveExternalDataCall} from './external-data';
const ci=process.env.GITHUB_ACTIONS==='true'&&process.env.NODE_ENV==='test';
const url=process.env.BUDGET_TEST_DATABASE_URL??(ci?process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL:undefined);const pool=new Pool({connectionString:url});const schema='budget_'+randomUUID().replaceAll('-','');
const scope={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture'};
describe.skipIf(!url)('budget cancellation fence against PostgreSQL',()=>{
 beforeAll(async()=>{
  await pool.query(`CREATE SCHEMA ${schema}`);
  await pool.query(`CREATE TABLE ${schema}.commerce_external_data_call(id uuid PRIMARY KEY,tenant_id uuid,workspace_id uuid,user_id text,source text,call_id text,state text,completed_at timestamptz,updated_at timestamptz)`);
  await pool.query(`CREATE TABLE ${schema}.commerce_external_call_cancel_fence(tenant_id uuid,workspace_id uuid,user_id text,source text,call_id text,PRIMARY KEY(tenant_id,source,call_id))`);
  holder.run=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query(`SET LOCAL search_path TO ${schema},public`);
   const proxy={query:async(sql:string,args?:unknown[])=>sql.includes('INSERT INTO commerce_enterprise_audit_event')?{rows:[],rowCount:1}:c.query(sql,args)};
   const result=await fn(proxy);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 });
 afterAll(async()=>{await pool.query(`DROP SCHEMA ${schema} CASCADE`);await pool.end();});
 it('cancellation before a late reservation prevents allocation',async()=>{
  const callId='late_'+randomUUID().replaceAll('-','');await cancelExternalDataSource(scope,'external_mcp',callId);
  await expect(reserveExternalDataCall(scope,{source:'external_mcp',callId,endpointId:'fixture.read',platform:'fixture',parameterHash:'a'.repeat(64),parameterKeys:[],requestedApprovalMode:'policy'})).rejects.toMatchObject({code:'EXTERNAL_DATA_CALL_CANCELLED'});
 });
 it('only reserved amounts are released; dispatched and unknown calls are left for settlement',async()=>{
  for(const state of ['reserved','dispatched','unknown']){
   const callId='call_'+randomUUID().replaceAll('-','');await pool.query(`INSERT INTO ${schema}.commerce_external_data_call VALUES($1,$2,$3,$4,'external_mcp',$5,$6,NULL,NULL)`,[randomUUID(),scope.tenantId,scope.workspaceId,scope.userId,callId,state]);
   await cancelExternalDataSource(scope,'external_mcp',callId);await cancelExternalDataSource(scope,'external_mcp',callId);
   expect((await pool.query(`SELECT state FROM ${schema}.commerce_external_data_call WHERE call_id=$1`,[callId])).rows[0].state).toBe(state==='reserved'?'cancelled':state);
  }
 });
});
