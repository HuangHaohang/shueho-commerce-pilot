import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';import {z} from 'zod';
import {researchApprovalHandler} from './research-approval.js';import {researchTaskStore,registerDurableTaskResult} from './research-task-protocol.js';
for(const scenario of ['accept','decline','lost_approval_reply','already_approved'] as const)test(`native task input_required resumes through elicitation: ${scenario}`,async()=>{
 const id=randomUUID(),reservation=randomUUID(),now=new Date().toISOString();let state='waiting_approval',approval=scenario==='already_approved'?'approved':'pending',prompts=0,approvals=0;
 const p:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture',scopes:[]};
 const view=()=>({task_id:id,state,created_at:now,updated_at:now,approval:{reservationId:reservation,billableAmountMicros:100000,currency:'CNY'},result:{success:true}});
 const upstream:any={taskOperation:async(_:string,a:any)=>{if(a.action==='resume')state='completed';if(a.action==='cancel')state='cancelled';return {payload:view()};}};
 const control:any={authorizeCatalog:async()=>({}),revalidate:async()=>({state:'reserved',approvalState:approval}),approve:async()=>{approvals++;approval='approved';if(scenario==='lost_approval_reply')throw new Error('reply lost');}};
 const server=new McpServer({name:'fixture',version:'1'},{capabilities:{tasks:{requests:{tools:{call:{}}}}}});
 const resolver=researchApprovalHandler(server,upstream,control,p);const store=researchTaskStore(upstream,control,p);
 registerDurableTaskResult(server,store,async(id,signal,seen)=>{await resolver(id,signal,true,seen);});
 const client=new Client({name:'fixture',version:'1'},{capabilities:{elicitation:{form:{}}}});
 client.setRequestHandler(ElicitRequestSchema,async r=>{prompts++;assert.equal((r.params._meta?.['io.modelcontextprotocol/related-task'] as any)?.taskId,id);return scenario==='decline'?{action:'decline'}:{action:'accept',content:{approve:true}};});
 const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 try{const results:any[]=await Promise.all([client.request({method:'tasks/result',params:{taskId:id}},z.any()),client.request({method:'tasks/result',params:{taskId:id}},z.any())]);
  assert.equal(prompts,scenario==='already_approved'?0:1);assert.equal(approvals,['accept','lost_approval_reply'].includes(scenario)?1:0);assert.equal(results[0].structuredContent.state,scenario==='decline'?'cancelled':'completed');
 }finally{await client.close();await server.close();}
});

test('two independent MCP sessions observe one approved task without stale-approval failure',async()=>{
 const id=randomUUID(),reservation=randomUUID(),now=new Date().toISOString();let state='waiting_approval',approved=false,transitions=0,prompts=0;
 const p:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture'};
 const view=()=>({task_id:id,state,created_at:now,updated_at:now,approval:{reservationId:reservation,billableAmountMicros:100000,currency:'CNY'},result:{success:true}});
 const upstream:any={taskOperation:async(_:string,a:any)=>{if(a.action==='resume'&&state==='waiting_approval'){transitions++;state='completed';}return {payload:view()};}};
 const control:any={authorizeCatalog:async()=>({}),revalidate:async()=>({state:state==='completed'?'dispatched':'reserved',approvalState:approved?'approved':'pending'}),approve:async()=>{if(approved)throw new Error('STALE');approved=true;}};
 let release!:()=>void;const barrier=new Promise<void>(r=>{release=r;});const clients:Client[]=[],servers:McpServer[]=[];
 for(let n=0;n<2;n++){
  const server=new McpServer({name:'fixture',version:'1'},{capabilities:{tasks:{requests:{tools:{call:{}}}}}});const resolver=researchApprovalHandler(server,upstream,control,p);
  registerDurableTaskResult(server,researchTaskStore(upstream,control,p),async(id,signal,seen)=>{await resolver(id,signal,true,seen);});
  const c=new Client({name:'fixture',version:'1'},{capabilities:{elicitation:{form:{}}}});c.setRequestHandler(ElicitRequestSchema,async()=>{prompts++;if(prompts===2)release();await barrier;return {action:'accept',content:{approve:true}};});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await c.connect(b);clients.push(c);servers.push(server);
 }
 try{const results:any[]=await Promise.all(clients.map(c=>c.request({method:'tasks/result',params:{taskId:id}},z.any(),{timeout:2000})));assert.equal(transitions,1);for(const r of results)assert.equal(r.structuredContent.state,'completed');}
 finally{await Promise.all(clients.map(c=>c.close()));await Promise.all(servers.map(s=>s.close()));}
});
