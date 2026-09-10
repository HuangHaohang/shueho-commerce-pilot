import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';import {ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';import {z} from 'zod';
import {McpSessionPool} from './mcp-session-pool.js';
test('separate HTTP requests retain capabilities and deliver elicitation; another actor cannot reuse the session',async()=>{
 const pool=new McpSessionPool();let created=0,elicited=0;
 const http=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;
  await pool.handle(req,res,raw?JSON.parse(raw):undefined,String(req.headers.authorization),()=>{
   created++;const server=new McpServer({name:'session-test',version:'1'});
   server.registerTool('approve',{inputSchema:{value:z.string()}},async()=>{
    assert(server.server.getClientCapabilities()?.elicitation?.form);
    const response=await server.server.elicitInput({mode:'form',message:'fixture approval',requestedSchema:{type:'object',properties:{approve:{type:'boolean'}},required:['approve']}});
    return {content:[{type:'text',text:response.action}],structuredContent:{action:response.action}};
   });return server;
  });
 }catch(error){res.writeHead(500);res.end(String(error));}});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));
 const url=new URL(`http://127.0.0.1:${(http.address() as any).port}/mcp`);
 const client=new Client({name:'fixture',version:'1'},{capabilities:{elicitation:{form:{}}}});
 client.setRequestHandler(ElicitRequestSchema,async()=>{elicited++;return {action:'accept',content:{approve:true}};});
 const transport=new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'actor-a'}}});
 try{
  await client.connect(transport);await client.listTools();
  const result=await client.callTool({name:'approve',arguments:{value:'fixture'}});assert.equal((result.structuredContent as any)?.action,'accept');
  assert.equal(created,1);assert.equal(elicited,1);
  const response=await fetch(url,{method:'GET',headers:{Authorization:'actor-b','mcp-session-id':transport.sessionId!,Accept:'text/event-stream'}});assert.equal(response.status,404);
 }finally{await client.close();await pool.close();http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));}
});
