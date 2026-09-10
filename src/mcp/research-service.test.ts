import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createResearchService} from './research-service.js';
import {ProviderNotDispatchedError} from '../integrations/provider-dispatch-stage.js';
import {SettlementNotPersistedError} from '../integrations/settlement-delivery-error.js';
test('one task owns page traversal and stops at the provider end without fetching another page',async()=>{
 const planned:number[]=[];const calls:number[]=[];const plans=new Map<string,number>();
 const principal:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture',tokenId:'fixture',scopes:['external_data.catalog.read','external_data.call']};
 const upstream:any={
  getDataCapability:async()=>({payload:{success:true,input_schema:{properties:{page:{type:'integer'}}}}}),
  planDataRequest:async(a:any)=>{const id=randomUUID();plans.set(id,a.inputs.page);planned.push(a.inputs.page);return {payload:{success:true,state:'ready',plan_id:id,plan_key:'a'.repeat(64),endpoint_id:'fixture.reviews',platform:'fixture',normalized_inputs:a.inputs}};},
  claimDataRequestPlan:async(a:any)=>({payload:{success:true,plan_id:a.plan_id,endpoint_id:'fixture.reviews',platform:'fixture',source_call_id:a.plan_id,normalized_inputs:{page:plans.get(a.plan_id)}}}),
  executeDataRequestPlan:async(a:any)=>{calls.push(plans.get(a.plan_id)!);return {payload:{success:true,provider_completed:true,processing_state:'completed',research_request_id:a.plan_id},isError:false,resultBytes:100};},
  taskOperation:async(_n:string,a:any)=>({payload:{success:true,total_records:20,pagination:{hasNextPage:plans.get(a.research_request_id)!<2}}}),
 };
 const control:any={authorizeCatalog:async()=>({allowedPlatforms:['fixture'],allowedEndpointIds:[]}),quote:async()=>({}),reserve:async()=>({reservationId:randomUUID(),requiresApproval:false}),dispatch:async()=>{},settle:async()=>{}};
 const result=await createResearchService(upstream,control).execute({id:randomUUID(),kind:'data',principal,attempts:1,inputs:{capability_id:'cap_'+'a'.repeat(24),inputs:{itemId:'known'},pagination:{max_pages:10},idempotency_key:randomUUID(),research_request:'fixture'}});
 assert.deepEqual(planned,[1,2]);assert.deepEqual(calls,[1,2]);assert.equal(result.structuredContent.coverage.all_source_pages,true);
});
test('known pre-dispatch rejection is not an unknown charge; an undurable settlement keeps the task recoverable',async()=>{
 const principal:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture',tokenId:'fixture',scopes:['external_data.call']};
 const plan=randomUUID();let states:string[]=[];
 const upstream:any={planDataRequest:async()=>({payload:{success:true,state:'ready',plan_id:plan,plan_key:'a'.repeat(64),endpoint_id:'fixture.read',platform:'fixture',normalized_inputs:{}}}),
  claimDataRequestPlan:async()=>({payload:{success:true,source_call_id:'fixture_call',endpoint_id:'fixture.read',platform:'fixture',normalized_inputs:{}}}),executeDataRequestPlan:async()=>{throw new ProviderNotDispatchedError('REVOKED');}};
 const control:any={authorizeCatalog:async()=>({allowedPlatforms:['fixture'],allowedEndpointIds:[]}),quote:async()=>({}),reserve:async()=>({reservationId:randomUUID(),requiresApproval:false}),dispatch:async()=>{},settle:async(_p:any,_r:any,x:any)=>{states.push(x.state);}};
 const task:any={id:randomUUID(),kind:'data',principal,attempts:1,inputs:{capability_id:'cap_'+'a'.repeat(24),inputs:{},idempotency_key:randomUUID(),research_request:'fixture'}};
 const response=await createResearchService(upstream,control).execute(task);assert.equal(response.structuredContent.error.code,'PROVIDER_NOT_DISPATCHED');assert.deepEqual(states,['business_failed']);
 upstream.executeDataRequestPlan=async()=>({payload:{success:true,provider_completed:true,processing_state:'completed'},isError:false,resultBytes:10});
 control.settle=async()=>{throw new SettlementNotPersistedError();};await assert.rejects(createResearchService(upstream,control).execute(task),SettlementNotPersistedError);
});

test('real research entrypoint resumes financial and journal reply loss without cancelling or recollecting',async()=>{
 const {taskAwareClient,withResearchTaskExecution}=await import('./research-task-runtime.js');
 const {ResearchRecoveryRequiredError}=await import('../integrations/research-recovery-error.js');
 const {hashExternalDataParameters}=await import('../integrations/external-data-control-client.js');
 const principal:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture',tokenId:'fixture',scopes:['external_data.call']};
 const task:any={id:randomUUID(),kind:'data',principal,attempts:1,execution_version:2,inputs:{capability_id:'cap_'+'a'.repeat(24),inputs:{q:'fixture'},idempotency_key:randomUUID(),research_request:'fixture'}};
 const planId=randomUUID(),reservationId=randomUUID(),params={q:'fixture'};let dispatches=0,providerCalls=0,cancellations=0,settlements=0,loseCheckpoint=true,readbackUnavailable=true;let stored:any;
 const ops=new Map<string,any>();
 const journal:any={getResearchResult:async()=>stored,taskOperation:async(name:string,a:any)=>{
  if(name==='enqueue_research_settlement'){settlements++;return {payload:{success:true}};}
  if(a.action==='read_operation')return {payload:{success:true,operation:ops.get(a.operation_key)??null}};
  let op=ops.get(a.operation_key);const fresh=!op;if(!op){op={state:'started'};ops.set(a.operation_key,op);}
  if(a.action==='complete_operation'){
   if(a.operation_name==='upstream.executeDataRequestPlan'&&loseCheckpoint){loseCheckpoint=false;throw new Error('checkpoint transport lost');}
   op.state='completed';op.result=a.result;
  }
  return {payload:{success:true,fresh,operation:{...op}}};
 }};
 const rawUp:any={planDataRequest:async()=>({payload:{success:true,state:'ready',plan_id:planId,plan_key:'a'.repeat(64),endpoint_id:'fixture.read',platform:'fixture',normalized_inputs:params}}),claimDataRequestPlan:async()=>({payload:{success:true,source_call_id:'fixture_call',endpoint_id:'fixture.read',platform:'fixture',normalized_inputs:params}}),executeDataRequestPlan:async()=>{providerCalls++;return stored={payload:{success:true,processing_state:'completed',provider_completed:true,research_request_id:planId},isError:false,resultBytes:100};},cancelDataRequestPlan:async()=>{cancellations++;}};
 const rawControl:any={authorizeCatalog:async()=>({allowedPlatforms:['fixture'],allowedEndpointIds:[]}),quote:async()=>({}),reserve:async()=>({reservationId,requiresApproval:false}),dispatch:async()=>{dispatches++;throw new Error('financial response lost');},settle:async()=>{},revalidate:async()=>{if(readbackUnavailable){readbackUnavailable=false;throw Object.assign(new Error('control temporarily unavailable'),{code:'CONTROL_UNAVAILABLE',status:503});}return {reservationId,sourceCallId:'fixture_call',endpointId:'fixture.read',parameterHash:hashExternalDataParameters(params),state:'dispatched',approvalState:'not_required'};}};
 const service=createResearchService(taskAwareClient(rawUp,journal,'upstream',rawControl),taskAwareClient(rawControl,journal,'control',rawControl));
 const run=()=>withResearchTaskExecution(task,randomUUID(),()=>service.execute(task));
 await assert.rejects(run(),ResearchRecoveryRequiredError);assert.equal(providerCalls,0);assert.equal(cancellations,0);
 await assert.rejects(run(),ResearchRecoveryRequiredError);assert.equal(providerCalls,0);assert.equal(cancellations,0);
 await assert.rejects(run(),ResearchRecoveryRequiredError);assert.equal(providerCalls,1);assert.equal(settlements,0);assert.equal(cancellations,0);
 const result=await run();assert.equal(result.structuredContent.success,true);assert.equal(dispatches,1);assert.equal(providerCalls,1);assert.equal(settlements,1);assert.equal(cancellations,0);
});

test('social research traverses qualified coverage with independent paid receipts and stops on a repeated cursor',async()=>{
 const principal:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture',scopes:['external_data.call']};
 const calls:number[]=[],settled:string[]=[];
 const upstream:any={
  preflightSocialContentResearch:async()=>({payload:{success:true,business_tool:'research_social_content',endpoint_id:'fixture.social',platform:'fixture',research_plan_key:'a'.repeat(64),normalized_params:{page:1},business_intent:{},coverage:{collection:{policy_receipt_id:randomUUID()}}}}),
  callEndpoint:async(a:any)=>{calls.push(a.params.page);return {payload:{success:true,provider_completed:true,processing_state:'completed',research_request_id:'r'+a.params.page,evidence:a.params.page===1?[]:[{provider_entity_id:'one',source_platform:'fixture'}]},isError:false,resultBytes:10};},
  taskOperation:async(_name:string,a:any)=>({payload:{success:true,next_params:{page:a.research_request_id==='r1'?2:2},signature:a.research_request_id,reason:'continue'}}),
 };
 const control:any={authorizeCatalog:async()=>({allowedPlatforms:['fixture'],allowedEndpointIds:[]}),reserve:async()=>({reservationId:randomUUID(),requiresApproval:false}),dispatch:async()=>{},settle:async(_p:any,id:string)=>{settled.push(id);}};
 const r=await createResearchService(upstream,control).execute({id:randomUUID(),kind:'social',principal,attempts:1,execution_version:3,inputs:{platform:'fixture',max_results:3,research_request:'fixture'}});
 assert.deepEqual(calls,[1,2]);assert.equal(settled.length,2);assert.equal(r.structuredContent.coverage.stop_reason,'source_repeated_cursor');
 assert.equal(r.structuredContent.evidence.length,1);
 assert.equal(r.structuredContent.research_plan.collection,undefined);
});
