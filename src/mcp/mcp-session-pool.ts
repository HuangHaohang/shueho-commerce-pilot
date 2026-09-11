import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {usePortablePublicToolSchemas} from './public-tool-schemas.js';

type Session={server:McpServer;transport:StreamableHTTPServerTransport;owner:string;lastSeen:number;active:number};
/** A protocol session retains negotiated client capabilities and pending server requests. */
export class McpSessionPool {
 private sessions=new Map<string,Session>();
 private timer:ReturnType<typeof setInterval>;
 constructor(private maxSessions=1000,private idleMs=30*60_000){this.timer=setInterval(()=>void this.sweep(),60_000);this.timer.unref();}
 async handle(request:IncomingMessage,response:ServerResponse,body:unknown,owner:string,create:()=>McpServer){
  const id=request.headers['mcp-session-id'];
  let session:Session|undefined;
  if(typeof id==='string'){
   session=this.sessions.get(id);
   if(!session || session.owner!==owner){response.writeHead(404,{'Content-Type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32001,message:'MCP session not found; initialize a new session.'},id:null}));return;}
  }else{
   if(request.method!=='POST' || (body as {method?:string}|null)?.method!=='initialize'){
    response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({jsonrpc:'2.0',error:{code:-32000,message:'MCP initialization and session ID are required.'},id:null}));return;
   }
   await this.sweep();
   if(this.sessions.size>=this.maxSessions){response.writeHead(503,{'Retry-After':'30'});response.end();return;}
   const sessionId=randomUUID();const server=create();
   const transport=new StreamableHTTPServerTransport({sessionIdGenerator:()=>sessionId,enableJsonResponse:false,keepAliveMs:10000,
    onsessionclosed:async()=>{this.sessions.delete(sessionId);await server.close();}});
   usePortablePublicToolSchemas(transport);
   session={server,transport,owner,lastSeen:Date.now(),active:0};
   this.sessions.set(sessionId,session);
   try{await server.connect(transport);}catch(error){this.sessions.delete(sessionId);throw error;}
  }
  session.lastSeen=Date.now();session.active++;
  const active=session;
  response.once('close',()=>{active.active--;active.lastSeen=Date.now();});
  await session.transport.handleRequest(request,response,body);
 }
 async sweep(){for(const [id,s] of this.sessions)if(s.active===0&&Date.now()-s.lastSeen>this.idleMs){this.sessions.delete(id);await s.server.close();}}
 async close(){clearInterval(this.timer);await Promise.allSettled([...this.sessions.values()].map(s=>s.server.close()));this.sessions.clear();}
}
