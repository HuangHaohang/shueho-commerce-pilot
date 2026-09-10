import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {WAREHOUSE_RESEARCH_STATES,researchResultPending} from './research-lifecycle.js';
import {classifyExternalDataServiceOutcome} from './external-data-outcome.js';import {researchTaskNeedsRecovery} from './research-task-outcome.js';
test('all persisted warehouse statuses are covered by the shared lifecycle contract',async()=>{
 const sql=await readFile(new URL('../../../apps/external-data/migrations/001_external_data_warehouse.sql',import.meta.url),'utf8');
 const declaration=sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS research_request'),sql.indexOf('CREATE TABLE IF NOT EXISTS external_query'));
 const check=declaration.match(/CHECK \(status IN \(([^)]+)\)\)/);assert(check);assert.deepEqual([...check[1]!.matchAll(/'([^']+)'/g)].map(m=>m[1]),[...WAREHOUSE_RESEARCH_STATES]);
});
test('pending statuses hold budget regardless of success flags and only terminal results settle',()=>{
 for(const processing_state of [...WAREHOUSE_RESEARCH_STATES.filter(s=>!['completed','failed','unknown'].includes(s)),'executing','running','queued','processing'])for(const success of [true,false])for(const provider_completed of [true,false]){
  const p={processing_state,success,provider_completed};assert(researchResultPending(p));assert(researchTaskNeedsRecovery(p));assert.equal(classifyExternalDataServiceOutcome(p,false).settlementState,null);
 }
 assert.equal(classifyExternalDataServiceOutcome({processing_state:'unknown',provider_completed:false},true).settlementState,'unknown');
 assert.equal(classifyExternalDataServiceOutcome({processing_state:'failed',provider_completed:true},true).settlementState,'succeeded');
});

const dbUrl=process.env.LIFECYCLE_TEST_DATABASE_URL??(process.env.GITHUB_ACTIONS==='true'&&process.env.NODE_ENV==='test'?process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL:undefined);
test('applied database lifecycle constraint matches adapter contract',{skip:!dbUrl},async()=>{
 const {Client}=await import('pg');const client=new Client({connectionString:dbUrl});await client.connect();
 try{const r=await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='research_request'::regclass AND conname='research_request_status_check'");assert.equal(r.rows.length,1);assert.deepEqual([...r.rows[0].definition.matchAll(/'([^']+)'/g)].map((m:any)=>m[1]),[...WAREHOUSE_RESEARCH_STATES]);}finally{await client.end();}
});
