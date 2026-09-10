import {test} from 'node:test';import assert from 'node:assert/strict';import {drainResearchSettlement} from './research-settlement-worker.js';
test('settlement retries the same stored payload independently of completed collection',async()=>{
 const payload={state:'succeeded',upstreamCode:0,upstreamMessage:null,resultBytes:10,responsePayload:{success:true}};
 let attempts=0;const finishes:any[]=[];
 const upstream:any={taskOperation:async(name:string,args:any)=>name==='claim_research_settlement'?{payload:{job:{reservation_id:'original',principal:{tenantId:'t',workspaceId:'w',userId:'u'},payload}}}:(finishes.push(args),{payload:{success:true}})};
 const control:any={settle:async(_p:any,id:string,value:any)=>{assert.equal(id,'original');assert.deepEqual(value,payload);if(++attempts===1)throw new Error('response lost');}};
 await drainResearchSettlement(upstream,control);await drainResearchSettlement(upstream,control);
 assert.equal(finishes[0].succeeded,false);assert.equal(finishes[1].succeeded,true);assert.equal(attempts,2);
});
