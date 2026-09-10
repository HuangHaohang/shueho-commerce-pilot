import {test} from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {z} from 'zod';
import {researchTaskStore,registerDurableTaskResult,mcpTaskView} from './research-task-protocol.js';
test('SDK MCP task capability creates, reads, lists and cancels a durable task',async()=>{
 const principal:any={tenantId:randomUUID(),workspaceId:randomUUID(),userId:'test',tokenId:'test',scopes:[]};
 let state='queued';const id=randomUUID();const now=new Date().toISOString();
 const view=()=>({success:true,task_id:id,state,created_at:now,updated_at:now,result:{success:true,records:[{value:7}]}});
 const upstream:any={taskOperation:async(name:string,args:any)=>{
  if(name==='manage_research_task'&&args.action==='cancel')state='cancelled';
  return {payload:args.action==='list'?{success:true,tasks:[view()]}:view()};
 }};
 const control:any={authorizeCatalog:async()=>({}),cancel:async()=>{}};
 const store=researchTaskStore(upstream,control,principal);
 const server=new McpServer({name:'task-test',version:'1'},{capabilities:{tasks:{list:{},cancel:{},requests:{tools:{call:{}}}}},taskStore:store});
 server.experimental.tasks.registerToolTask('run_data_research',{inputSchema:{idempotency_key:z.string().uuid()},execution:{taskSupport:'required'}},{
  createTask:async()=>({task:mcpTaskView(view())}),getTask:async()=>mcpTaskView(view()),getTaskResult:async()=>({content:[],structuredContent:view().result}),
 });
 registerDurableTaskResult(server,store);
 const client=new Client({name:'test',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();
 await server.connect(a);await client.connect(b);
 try{
  assert(client.getServerCapabilities()?.tasks?.requests?.tools?.call);
  const response:any=await client.request({method:'tools/call',params:{name:'run_data_research',arguments:{idempotency_key:randomUUID()},task:{}}},z.any());
  assert.equal(response.task.taskId,id);assert.equal(response.task.status,'working');
  const list:any=await client.request({method:'tasks/list',params:{}},z.any());assert.equal(list.tasks[0].taskId,id);
  state='completed';const result:any=await client.request({method:'tasks/result',params:{taskId:id}},z.any());assert.equal(result.structuredContent.records[0].value,7);
  state='queued';const cancelled:any=await client.request({method:'tasks/cancel',params:{taskId:id}},z.any());assert.equal(cancelled.status,'cancelled');
 }finally{await client.close();await server.close();}
});

test('native cancellation persists even if financial cancellation is unavailable; terminal error remains an error',async()=>{
 let state='waiting_approval',financialCalls=0;const id=randomUUID(),now=new Date().toISOString();
 const upstream:any={taskOperation:async(_:string,a:any)=>{if(a.action==='cancel')state='cancelled';return {payload:{success:true,task_id:id,state,created_at:now,updated_at:now,approval:{reservationId:randomUUID()},result:{success:false,error:{code:'APPROVAL_REQUIRED'}}}};}};
 const control:any={authorizeCatalog:async()=>({}),cancel:async()=>{financialCalls++;throw new Error('unavailable');}};
 const store=researchTaskStore(upstream,control,{tenantId:randomUUID(),workspaceId:randomUUID(),userId:'fixture'} as any);
 await store.updateTaskStatus(id,'cancelled');assert.equal(financialCalls,0);assert.equal(state,'cancelled');
 const result:any=await store.getTaskResult(id);assert.equal(result.isError,true);assert.equal(result.structuredContent.error.code,'TASK_CANCELLED');
 assert.equal(mcpTaskView({task_id:id,state:'partial',created_at:now,updated_at:now}).status,'failed');
});
