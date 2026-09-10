import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchTaskOutcome} from '../integrations/research-task-outcome.js';
import {classifyExternalDataServiceOutcome} from '../integrations/external-data-outcome.js';
test('all explicit uncertain outcomes retain reconciliation and monetary reservation',()=>{
 for(const code of ['DATA_EXECUTION_UNCERTAIN','DATA_RESULT_UNKNOWN','UPSTREAM_RESULT_UNKNOWN','RESULT_UNKNOWN']){
  const payload={success:false,error:{code,message:'timeout'}};
  assert.equal(researchTaskOutcome(payload),'reconciliation_required');
  assert.equal(classifyExternalDataServiceOutcome(payload,true).settlementState,'unknown');
 }
 assert.equal(researchTaskOutcome({success:true,evidence:[{text:'RESULT_UNKNOWN'}]}),'completed');
 assert.equal(researchTaskOutcome({success:false,partial_results:[{research_request_id:'existing'}]}),'partial');
 assert.equal(researchTaskOutcome({success:false,error:{code:'APPROVAL_REQUIRED'}}),'waiting_approval');
});

test('nonterminal provider acknowledgements cannot mark research completed',()=>{for(const processing_state of ['executing','running','queued','processing'])assert.equal(researchTaskOutcome({success:true,processing_state}),'reconciliation_required');});
