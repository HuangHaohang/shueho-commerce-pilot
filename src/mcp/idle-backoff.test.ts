import {test} from 'node:test';import assert from 'node:assert/strict';import {IdleBackoff} from './idle-backoff.js';
test('idle polling becomes sparse and queued work resets backoff',()=>{
 let now=0;const backoff=new IdleBackoff(()=>now);let polls=0;
 for(let second=0;second<3600;second++){now=second*1000;if(backoff.ready()){polls++;backoff.observed(false);}}
 assert(polls<130);backoff.observed(true);assert(backoff.ready());
});
