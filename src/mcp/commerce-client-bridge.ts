import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema,ListToolsRequestSchema,ToolListChangedNotificationSchema,ElicitRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {preserveNullablePrimitiveSchemas} from './nullable-schema.js';
import {retryResearchRead} from './read-only-retry.js';
export async function createCommerceClientBridge(url:URL,authorization:string){
 const discovery=new Client({name:'commerce-bridge-discovery',version:'2'});
 await discovery.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:authorization}}}));
 const server=new Server(discovery.getServerVersion()??{name:'shueho-commerce-pilot',version:'2'},
  {capabilities:{tools:{listChanged:true}},instructions:discovery.getInstructions()});
 await discovery.close();
 let upstream:Client|null=null,connecting:Promise<Client>|null=null,closed=false;
 const reads=new Set(['get_research_task','list_research_tasks','get_research_records','get_research_result','search_business_data','search_data_capabilities','get_data_capability','list_marketplace_research_platforms','get_marketplace_options']);
 async function connect():Promise<Client>{
  if(closed)throw new Error('BRIDGE_CLOSED');if(upstream)return upstream;if(connecting)return connecting;
  connecting=(async()=>{
   const elicitation=server.getClientCapabilities()?.elicitation;
   const client=new Client({name:'commerce-client-bridge',version:'2'},{capabilities:elicitation?{elicitation}: {}});
   if(elicitation)client.setRequestHandler(ElicitRequestSchema,(request,extra)=>server.elicitInput(request.params,{signal:extra.signal}));
   client.setNotificationHandler(ToolListChangedNotificationSchema,()=>server.notification({method:'notifications/tools/list_changed'}));
   await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:authorization}}}));upstream=client;return client;
  })().finally(()=>{connecting=null;});return connecting;
 }
 async function perform<T>(read:boolean,operation:(client:Client)=>Promise<T>):Promise<T>{
  const client=await connect();try{return await operation(client);}catch(error){
   if(!read||(error as {code?:number}).code!==404)throw error;
   if(upstream===client){upstream=null;await client.close();}return operation(await connect());
  }
 }
 server.setRequestHandler(ListToolsRequestSchema,async(request,extra)=>{
  const result=await perform(true,c=>c.listTools(request.params,{signal:extra.signal,timeout:30000}));
  return {...result,tools:result.tools.filter(t=>t.execution?.taskSupport!=='required').map(t=>({...t,inputSchema:preserveNullablePrimitiveSchemas(t.inputSchema)}))};
 });
 server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  try{
   if(request.params.task)throw new Error('Use ordinary submit tools through this compatibility bridge.');
   return await retryResearchRead(request.params.name,()=>perform(reads.has(request.params.name),c=>c.callTool(request.params,undefined,{signal:extra.signal,timeout:300000})));
  }catch(error){
   const e=error as {code?:number;cause?:{code?:string}};const cause=e.cause?.code;
   const payload={success:false,error:{code:'MCP_REQUEST_FAILED',message:'MCP请求未完成；保留原任务ID和幂等键，不要重新采集。',protocolCode:typeof e.code==='number'?e.code:null,transportCode:cause&&/^(ECONNRESET|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|UND_ERR_[A-Z_]+)$/.test(cause)?cause:null}};
   return {isError:true,structuredContent:payload,content:[{type:'text',text:JSON.stringify(payload)}]};
  }
 });
 return {server,async close(){closed=true;await Promise.allSettled([server.close(),upstream?.close()]);}};
}
