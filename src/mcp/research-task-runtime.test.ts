import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {taskAwareClient,withResearchTaskExecution,withTaskPage,markTaskLeaseLost} from './research-task-runtime.js';
import {taskToolContract} from '../integrations/research-task-contract.js';
function fixture(){
 const ops=new Map<string,any>();let calls=0;
 const journal:any={taskOperation:async(name:string,a:any)=>{
  if(name==='recover_research_call')return {payload:{terminal:true,result:{success:true,processing_state:'completed',evidence:[{value:7}]}}};
  let op=ops.get(a.operation_key);const fresh=!op;if(!op){op={state:'started',input_hash:a.input_hash};ops.set(a.operation_key,op);}
  assert.equal(op.input_hash,a.input_hash);
  if(a.action==='complete_operation'){op.state='completed';op.result=a.result;}
  return {payload:{success:true,fresh,operation:{...op}}};
 }};
 const target={callEndpoint:async(_:unknown)=>{calls++;return {payload:{success:true,value:7}};},preflightEndpoint:async()=>({allowed:true})};
 const task={id:randomUUID(),kind:'social' as const,inputs:{},attempts:1,principal:{tenantId:randomUUID(),workspaceId:randomUUID(),userId:'test',tokenId:'opaque',scopes:[]}};
 return {ops,journal,target,task,calls:()=>calls};
}
test('completed supplier checkpoints survive worker restart without resending',async()=>{
 const f=fixture();const client=taskAwareClient(f.target,f.journal,'upstream');const args={_commerce_context:{source_call_id:'same_source'}};
 const a=await withResearchTaskExecution(f.task,randomUUID(),()=>client.callEndpoint(args));
 const b=await withResearchTaskExecution(f.task,randomUUID(),()=>client.callEndpoint(args));
 assert.deepEqual(a,b);assert.equal(f.calls(),1);
});
test('lost supplier response is recovered from original warehouse request, never resent',async()=>{
 const f=fixture();f.target.callEndpoint=async()=>{throw new Error('connection lost after dispatch');};
 const client=taskAwareClient(f.target,f.journal,'upstream');const args={_commerce_context:{source_call_id:'same_source'}};
 await assert.rejects(withResearchTaskExecution(f.task,randomUUID(),()=>client.callEndpoint(args)));
 const result:any=await withResearchTaskExecution(f.task,randomUUID(),()=>client.callEndpoint(args));assert.equal(result.payload.processing_state,'completed');
 assert.equal([...f.ops.values()][0].state,'completed');
});
test('unconfirmed dispatch checkpoint never replays the financial side effect',async()=>{
 const f=fixture();let dispatched=0;const control=taskAwareClient({dispatch:async()=>{dispatched++;throw new Error('lost');}},f.journal,'control');
 await assert.rejects(withResearchTaskExecution(f.task,randomUUID(),()=>control.dispatch()));
 await assert.rejects(withResearchTaskExecution(f.task,randomUUID(),()=>control.dispatch()),/RECONCILIATION/);assert.equal(dispatched,1);
});
test('model contract removes the planning/execution pair and adds task submission/read',()=>{
 const spec=taskToolContract({tools:['plan_marketplace_research','execute_marketplace_research','plan_data_request','execute_data_request','research_social_content'].map(name=>({name,inputSchema:{properties:{},required:[]}}))});
 assert.deepEqual(spec.tools.map((t:any)=>t.name),['submit_marketplace_research','submit_data_request','submit_social_research','get_research_task','list_research_tasks','cancel_research_task','get_research_records']);
 assert(spec.tools[0].inputSchema.required.includes('idempotency_key'));
});

test('task instrumentation preserves synchronous client status methods',()=>{
 const f=fixture();const client=taskAwareClient({readStatus:()=>({connected:true}),configured:true},f.journal,'upstream');
 assert.deepEqual(client.readStatus(),{connected:true});assert.equal(client.configured,true);
});

test('v2 checkpoint identity is independent of unrelated call order and live checks run before dispatch',async()=>{
 const f=fixture();let validations=0;const task={...f.task,execution_version:2};
 const live={revalidate:async()=>{validations++;return {state:'dispatched',approvalState:'not_required'};}};
 const control=taskAwareClient({reserve:async(..._args:unknown[])=>({reservationId:'reservation',requiresApproval:false}),quote:async()=>({priced:true})},f.journal,'control',live);
 const provider=taskAwareClient(f.target,f.journal,'upstream',live);
 await withResearchTaskExecution(task,randomUUID(),async()=>{await control.reserve({}, {source:"external_mcp",callId:"fixture_call"});await provider.callEndpoint({_commerce_context:{source_call_id:'stable'}});});
 await withResearchTaskExecution(task,randomUUID(),async()=>{await control.quote();await control.reserve({}, {source:"external_mcp",callId:"fixture_call"});await provider.callEndpoint({_commerce_context:{source_call_id:'stable'}});});
 assert.equal(f.calls(),1);assert.equal(validations,1);
});
test('revoked admission prevents a new supplier dispatch',async()=>{
 const f=fixture();const task={...f.task,execution_version:2};const live={revalidate:async()=>{throw new Error('REVOKED');}};
 const control=taskAwareClient({reserve:async(..._args:unknown[])=>({reservationId:'r'})},f.journal,'control',live);
 const provider=taskAwareClient(f.target,f.journal,'upstream',live);
 await assert.rejects(withResearchTaskExecution(task,randomUUID(),async()=>{await control.reserve({}, {source:"external_mcp",callId:"fixture_call"});await provider.callEndpoint({});}),/blocked before dispatch/);assert.equal(f.calls(),0);
});

test('page scopes share lease invalidation with the parent and subsequent pages',async()=>{
 const f=fixture();const provider=taskAwareClient(f.target,f.journal,'upstream');
 await withResearchTaskExecution(f.task,randomUUID(),async()=>{
  await withTaskPage(1,async()=>{markTaskLeaseLost();});
  await assert.rejects(withTaskPage(2,()=>provider.callEndpoint({})),/LEASE_LOST/);
  await assert.rejects(provider.callEndpoint({}),/LEASE_LOST/);
 });assert.equal(f.calls(),0);
});
