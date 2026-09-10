import {retryResearchRead} from "../src/mcp/read-only-retry.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { preserveNullablePrimitiveSchemas } from "../src/mcp/nullable-schema.js";

const authorization = process.env.COMMERCE_MCP_AUTH_HEADER;
if (!authorization || !/^Bearer cp_[A-Za-z0-9]{8}_[A-Za-z0-9_-]{32,}$/.test(authorization)) {
  throw new Error("A Commerce Pilot MCP authorization header is required.");
}
let upstream = new Client({ name: "commerce-pilot-nullable-schema-bridge", version: "1.0.2" });
await upstream.connect(new StreamableHTTPClientTransport(new URL("https://commerce-mcp.shueho.com/mcp"), {
  requestInit: { headers: { Authorization: authorization } },
}));
const server = new Server(upstream.getServerVersion() ?? { name: "shueho-commerce-pilot", version: "1" }, {
  capabilities: { tools: { listChanged: true } },
  instructions: upstream.getInstructions(),
});
let reconnecting:Promise<void>|null=null;
async function reconnect(stale:Client){
 if(stale!==upstream)return;
 reconnecting??=(async()=>{
  const next=new Client({name:'commerce-pilot-nullable-schema-bridge',version:'1.0.2'});
  await next.connect(new StreamableHTTPClientTransport(new URL('https://commerce-mcp.shueho.com/mcp'),{requestInit:{headers:{Authorization:authorization!}}}));
  next.setNotificationHandler(ToolListChangedNotificationSchema,async()=>{await server.notification({method:'notifications/tools/list_changed'});});
  upstream=next;await stale.close().catch(()=>undefined);
 })().finally(()=>{reconnecting=null;});
 await reconnecting;
}
async function readWithSession<T>(operation:(client:Client)=>Promise<T>){
 const current=upstream;
 try{return await operation(current);}catch(error){
  if((error as {code?:number}).code!==404)throw error;
  await reconnect(current);return operation(upstream);
 }
}
server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
  const response = await readWithSession(client=>client.listTools(request.params, { signal: extra.signal, timeout: 30_000 }));
  return { ...response, tools: response.tools.map((tool) => ({ ...tool, inputSchema: preserveNullablePrimitiveSchemas(tool.inputSchema) })) };
});
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {try{return await retryResearchRead(request.params.name,()=>{
 const call=(client:Client)=>client.callTool(request.params, undefined, {
  signal: extra.signal, timeout: 300_000,
 });
 return ['get_research_task','list_research_tasks','get_research_records','get_research_result','search_business_data','search_data_capabilities','get_data_capability','list_marketplace_research_platforms','get_marketplace_options'].includes(request.params.name)?readWithSession(call):call(upstream);
});}catch(error){
 const failure=error as {message?:string;code?:number;cause?:{code?:string}};
 const transient=/fetch failed|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket|connection.*closed/i.test(failure.message??'');
 const cause=failure.cause?.code;
 const payload={success:false,error:{code:transient?"MCP_TRANSPORT_FAILED":"MCP_REQUEST_FAILED",message:transient?"研究服务连接失败，请保留原 task_id 或研究编号；不应新建任务重复采集。":"MCP 请求未完成，请检查工具、权限与参数；不应重新发起采集。",protocolCode:typeof failure.code==='number'?failure.code:null,transportCode:cause&&/^(ECONNRESET|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|UND_ERR_[A-Z_]+)$/.test(cause)?cause:null}};
 return {isError:true,content:[{type:"text",text:JSON.stringify(payload)}],structuredContent:payload};
}});
upstream.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
  await server.notification({ method: "notifications/tools/list_changed" });
});
let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await Promise.allSettled([server.close(), upstream.close()]);
}
process.on("SIGINT", () => { void close(); });
process.on("SIGTERM", () => { void close(); });
server.onclose = () => { void close(); };
await server.connect(new StdioServerTransport());
