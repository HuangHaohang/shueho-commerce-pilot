import {test} from 'node:test';import assert from 'node:assert/strict';import {retryResearchRead} from './read-only-retry.js';
test('retries a transient result read but never a task submission or supplier execution',async()=>{
 for(const name of ['submit_marketplace_research','execute_marketplace_research','submit_data_request']){
  let count=0;await assert.rejects(retryResearchRead(name,async()=>{count++;throw new Error('fetch failed');},async()=>{}));assert.equal(count,1);
 }
 let count=0;const result=await retryResearchRead('get_research_task',async()=>{if(++count<3)throw new Error('fetch failed');return 'completed';},async()=>{});assert.equal(result,'completed');assert.equal(count,3);
});
test('does not retry authorization errors',async()=>{let count=0;await assert.rejects(retryResearchRead('get_research_task',async()=>{count++;throw new Error('401 Unauthorized');},async()=>{}));assert.equal(count,1);});
