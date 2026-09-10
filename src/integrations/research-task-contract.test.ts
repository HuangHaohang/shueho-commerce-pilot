import {test} from 'node:test';
import assert from 'node:assert/strict';
import {taskToolContract} from './research-task-contract.js';
test('Harness research tools carry semantic qualifiers without inventing questions or provider controls',()=>{
 const {tools}=taskToolContract({tools:[{name:'research_social_content',inputSchema:{type:'object',properties:{keyword:{type:'string'}},required:['keyword']}}]});
 const submit=tools.find((t:any)=>t.name==='submit_social_research');
 assert.deepEqual(submit.inputSchema.properties.semantic_scope.required,['include','exclude']);
 assert.equal(submit.inputSchema.properties.semantic_scope.additionalProperties,false);
 assert.equal(submit.inputSchema.properties.endpoint_id,undefined);
 assert.equal(submit.inputSchema.properties.page,undefined);
});
