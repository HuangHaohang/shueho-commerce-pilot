import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createCommerceClientBridge} from './commerce-client-bridge.js';import {McpSessionPool} from './mcp-session-pool.js';
test('actual compatibility bridge forwards accept and decline and renegotiates after HTTP session loss',async()=>{
 let pool=new McpSessionPool(),decision='accept',prompts=0;
 const http=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;
  await pool.handle(req,res,raw?JSON.parse(raw):undefined,'fixture',()=>{
   const server=new McpServer({name:'fixture',version:'1'});
   server.registerTool('get_research_task',{inputSchema:{}},async()=>{
    if(!server.server.getClientCapabilities()?.elicitation?.form)return {content:[{type:'text',text:'unsupported'}]};
    const answer=await server.server.elicitInput({mode:'form',message:'Approve one fixture action?',requestedSchema:{type:'object',properties:{approve:{type:'boolean'}},required:['approve']}});
    return {content:[{type:'text',text:answer.action}]};
   });return server;
  });
 });await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));
 const bridge=await createCommerceClientBridge(new URL(`http://127.0.0.1:${(http.address() as any).port}/mcp`),'fixture');
 const client=new Client({name:'downstream',version:'1'},{capabilities:{elicitation:{form:{}}}});
 client.setRequestHandler(ElicitRequestSchema,async()=>{prompts++;return {action:decision as 'accept'|'decline',...(decision==='accept'?{content:{approve:true}}:{})};});
 const [a,b]=InMemoryTransport.createLinkedPair();await bridge.server.connect(a);await client.connect(b);
 try{
  await client.listTools();let result=await client.callTool({name:'get_research_task',arguments:{}});assert.equal((result.content as any[])[0].text,'accept');
  decision='decline';await pool.close();pool=new McpSessionPool();
  result=await client.callTool({name:'get_research_task',arguments:{}});assert.equal((result.content as any[])[0].text,'decline');assert.equal(prompts,2);
 }finally{await client.close();await bridge.close();await pool.close();http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()));}
});
