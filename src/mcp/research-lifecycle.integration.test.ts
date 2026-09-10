import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createResearchService} from './research-service.js';import {taskAwareClient,withResearchTaskExecution} from './research-task-runtime.js';
import {ResearchProcessingPendingError,ResearchRecoveryRequiredError} from '../integrations/research-recovery-error.js';
function fixture(initial:string,transient=false){
 const principal:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture',tokenId:'fixture',scopes:['external_data.call']};const id=randomUUID(),reservationId=randomUUID(),params={q:'fixture'};let calls=0,reads=0,stage=initial,fail=transient;
 const ops=new Map<string,any>(),settlements=new Map<string,any>();
 const result=()=>({payload:{success:stage==='completed',provider_completed:['normalizing','enriching','completed'].includes(stage),processing_state:stage,research_request_id:id},isError:false,resultBytes:100});
 const journal:any={getResearchResult:async()=>{reads++;return result();},taskOperation:async(name:string,a:any)=>{
  if(name==='enqueue_research_settlement'){const old=settlements.get(a.reservation_id);if(old)assert.deepEqual(old,a.payload);settlements.set(a.reservation_id,a.payload);return {payload:{success:true}};}
  if(name==='recover_research_call'){reads++;return {payload:{success:true,terminal:['completed','failed','unknown'].includes(stage),result:result().payload}};}
  if(a.action==='read_operation')return {payload:{success:true,operation:ops.get(a.operation_key)??null}};
  let op=ops.get(a.operation_key);const fresh=!op;if(!op){op={state:'started',operation_name:a.operation_name};ops.set(a.operation_key,op);}if(a.action==='complete_operation'){op.state='completed';op.result=a.result;}return {payload:{success:true,fresh,operation:{...op}}};
 }};
 const raw:any={planDataRequest:async()=>({payload:{success:true,state:'ready',plan_id:id,plan_key:'a'.repeat(64),endpoint_id:'fixture.read',platform:'fixture',normalized_inputs:params}}),claimDataRequestPlan:async()=>({payload:{success:true,source_call_id:'fixture_call',endpoint_id:'fixture.read',platform:'fixture',normalized_inputs:params}}),executeDataRequestPlan:async()=>{calls++;return result();},callEndpoint:async()=>{calls++;return result();},cancelDataRequestPlan:async()=>{throw new Error('Must not cancel recoverable plan');}};
 const control:any={authorizeCatalog:async()=>({allowedPlatforms:['fixture'],allowedEndpointIds:[]}),quote:async()=>({}),reserve:async()=>({reservationId,requiresApproval:false}),dispatch:async()=>{},settle:async()=>{},revalidate:async()=>{if(fail){fail=false;throw Object.assign(new Error('temporary'),{code:'CONTROL_UNAVAILABLE',status:503});}return {state:'dispatched',approvalState:'not_required'};}};
 const c=taskAwareClient(control,journal,'control',control),up=taskAwareClient(raw,journal,'upstream',control),service=createResearchService(up,c);
 const task:any={id:randomUUID(),kind:'data',principal,attempts:1,execution_version:2,inputs:{capability_id:'cap_'+'a'.repeat(24),inputs:params,idempotency_key:randomUUID(),research_request:'fixture'}};
 return {ops,settlements,setStage:(s:string)=>{stage=s;},calls:()=>calls,reads:()=>reads,run:()=>withResearchTaskExecution(task,randomUUID(),()=>service.execute(task)),runEndpoint:()=>withResearchTaskExecution(task,randomUUID(),async()=>{await c.reserve(principal,{source:'external_mcp',callId:'fixture_call'});return up.callEndpoint({_commerce_context:{source_call_id:'fixture_call'}});})};
}
for(const stage of ['created','collecting','normalizing','enriching','executing','running','queued','processing'])test(`full entrypoint waits for ${stage}, refreshes original result and settles once`,async()=>{
 const f=fixture(stage);await assert.rejects(f.run(),ResearchProcessingPendingError);assert.equal(f.settlements.size,0);
 await assert.rejects(f.run(),ResearchProcessingPendingError);assert.equal(f.reads(),1);assert.equal(f.settlements.size,0);
 f.setStage('completed');const r=await f.run();assert.equal(r.structuredContent.success,true);await f.run();
 assert.equal(f.calls(),1);assert.equal(f.reads(),2);assert.equal(f.settlements.size,1);assert.equal([...f.settlements.values()][0].state,'succeeded');
 assert.equal([...f.ops.values()].find(o=>o.operation_name==='upstream.executeDataRequestPlan').result.payload.processing_state,stage);
});
test('temporary admission 503 leaves no provider checkpoint and can safely resume',async()=>{
 const f=fixture('completed',true);await assert.rejects(f.run(),ResearchRecoveryRequiredError);assert.equal(f.calls(),0);assert.equal(f.settlements.size,0);assert(![...f.ops.values()].some(o=>o.operation_name==='upstream.executeDataRequestPlan'));
 assert.equal((await f.run()).structuredContent.success,true);assert.equal(f.calls(),1);assert.equal(f.settlements.size,1);
});
test('endpoint tasks refresh by original source call, including an unknown terminal result',async()=>{
 const f=fixture('collecting');await assert.rejects(f.runEndpoint(),ResearchProcessingPendingError);f.setStage('unknown');const r=await f.runEndpoint();assert.equal(r.payload.processing_state,'unknown');assert.equal(f.calls(),1);assert.equal(f.reads(),1);
});
