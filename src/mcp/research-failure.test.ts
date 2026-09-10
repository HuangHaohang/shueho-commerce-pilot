import {test} from 'node:test';import assert from 'node:assert/strict';import {setImmediate} from 'node:timers/promises';
import {ExternalDataControlError} from '../integrations/external-data-control-client.js';import {startResearchTaskWorker} from './research-task-runtime.js';
test('a monthly call-limit refusal finishes once as failed, without retries or reconciliation',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const updates:any[]=[];let claimed=false;
 const task:any={id:'fixture',kind:'social',principal:{tenantId:'t',workspaceId:'w',userId:'u'},inputs:{},attempts:1};
 const store:any={taskOperation:async(name:string,a:any)=>{if(name==='claim_research_task'){if(claimed)return {payload:{success:true,task:null}};claimed=true;return {payload:{success:true,task}};}if(name==='read_research_task')return {payload:{success:true,partial_results:[]}};updates.push(a);return {payload:{success:true}};}};
 const stop=startResearchTaskWorker(store,async()=>{throw new ExternalDataControlError('每月调用次数已达上限','EXTERNAL_DATA_CALL_LIMIT',429,{providerDispatched:false});});
 try{t.mock.timers.tick(1000);await setImmediate();assert.equal(updates.length,1);assert.equal(updates[0].action,'finish');assert.equal(updates[0].state,'failed');assert.equal(updates[0].result.error.code,'EXTERNAL_DATA_CALL_LIMIT');assert.equal(updates[0].error_code,'EXTERNAL_DATA_CALL_LIMIT');}finally{stop();}
});
