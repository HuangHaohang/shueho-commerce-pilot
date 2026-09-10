import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createResearchService} from './research-service.js';
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
