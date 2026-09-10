import {readFile,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {createHash} from "node:crypto";
import {CodexAppServerClient} from "./app-server-client.js";
import type {AppServerEvent} from "./protocol.js";
import {readGatewayConfig} from "../gateway/config.js";
import type {JsonValue} from "./generated/serde_json/JsonValue.js";
export type HarnessModelResult={text:string;turnId:string;usage:unknown;sources:Array<{url:string;title:string|null}>};
/** One native ephemeral thread/turn. No model loop, provider call, tool replay or history store. */
export async function runHarnessModel(input:{model:string;prompt:string;instructions:string;schema?:JsonValue;webSearch:boolean;timeoutMs:number},
 factory=(options:ConstructorParameters<typeof CodexAppServerClient>[0])=>new CodexAppServerClient(options)):Promise<HarnessModelResult>{
 const config=readGatewayConfig();
 const env:NodeJS.ProcessEnv={...process.env,CODEX_HOME:config.codexHome};delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
  let hostedCatalog:string|undefined;
  if(input.webSearch){
   const catalog=JSON.parse(await readFile(resolve("vendor/codex/models.json"),"utf8"));
   const model=catalog.models.find((entry:any)=>entry.slug===input.model);
   if(!model)throw new Error("PINNED_HARNESS_MODEL_METADATA_REQUIRED");
   // The configured custom provider serves standard Responses hosted tools, not
   // Responses Lite standalone search. Preserve model identity and all other
   // upstream metadata; select the native supported wire mode only.
   hostedCatalog=join(config.codexHome,"hosted-"+createHash("sha256").update(input.model).digest("hex")+".json");
   await writeFile(hostedCatalog,JSON.stringify({models:[{...model,use_responses_lite:false}]}),{mode:0o600});
  }
 const client=factory({codexBin:config.codexBin,cwd:config.runtimeRoot,env,modelCatalogPath:hostedCatalog});
 let threadId="",turnId="",usage:unknown=null,sawNativeSearch=false;
 const messages=new Map<string,string>(),sources=new Map<string,{url:string;title:string|null}>();
 let finish!:(value:HarnessModelResult)=>void,fail!:(error:Error)=>void;
 const completed=new Promise<HarnessModelResult>((resolve,reject)=>{finish=resolve;fail=reject;});
 // Register before turn/start: fast Items can arrive before its RPC response.
 const listener=(event:AppServerEvent)=>{
  if(event.type==="process" && event.event==="exit"){fail(new Error("HARNESS_PROCESS_EXITED"));return;}
  if(event.type==="server_request"){client.rejectServerRequest(event.id,{code:-32601,message:"No client tools or permission grants are available to this bounded operation."});return;}
  if(event.type!=="notification" || !event.params || typeof event.params!=="object")return;
  const p=event.params as any;if(p.threadId!==threadId)return;
  if(event.method==="thread/tokenUsage/updated"){const u=p.tokenUsage?.total;usage=u?{input_tokens:u.inputTokens,output_tokens:u.outputTokens,total_tokens:u.totalTokens,input_tokens_details:{cached_tokens:u.cachedInputTokens},output_tokens_details:{reasoning_tokens:u.reasoningOutputTokens}}:null;}
  if(event.method==="item/completed" && p.item?.type==="agentMessage")messages.set(p.item.id,p.item.text);
  if(event.method==="item/completed" && p.item?.type==="webSearch"){
   sawNativeSearch=true;
   const collect=(v:any):void=>{if(!v||typeof v!=="object")return;if(Array.isArray(v)){v.forEach(collect);return;}
    if(typeof v.url==="string" && /^https?:\/\//.test(v.url))sources.set(v.url,{url:v.url,title:typeof v.title==="string"?v.title:null});
    for(const child of Object.values(v))if(child&&typeof child==="object")collect(child);
   };collect(p.item.results);if(p.item.action?.url)collect(p.item.action);
  }
  if(event.method==="turn/completed"){
   turnId=p.turn.id;
   if(p.turn.status!=="completed"){fail(new Error("HARNESS_TURN_"+String(p.turn.status).toUpperCase()));return;}
   const text=[...messages.values()].join("\n");
   // Hosted-search Items in the pinned protocol omit citation annotations. Retain
   // URLs cited by the native answer only after an actual native search Item.
   if(sawNativeSearch && !sources.size)for(const match of text.matchAll(/https?:\/\/[^\s<>\])"']+/g))sources.set(match[0],{url:match[0],title:null});
   finish({text,turnId,usage,sources:[...sources.values()]});
  }
 };
 client.on("event",listener);
 const timeout=setTimeout(()=>fail(new Error("HARNESS_TURN_TIMEOUT_RESULT_UNKNOWN")),input.timeoutMs);
 // Avoid an unhandled rejection if startup fails before we begin awaiting completion.
 void completed.catch(()=>undefined);
 try{
  await client.start();
  const started=await client.request("thread/start",{model:input.model,modelProvider:config.provider.id,ephemeral:true,cwd:config.runtimeRoot,runtimeWorkspaceRoots:[config.runtimeRoot],environments:[],dynamicTools:[],approvalPolicy:"never",sandbox:"read-only",developerInstructions:input.instructions,
   config:{...(hostedCatalog?{model_catalog_json:hostedCatalog}:{}),"mcp_servers.commerce_web.enabled":false,"mcp_servers.commerce_web.required":false,"features.multi_agent":false,"agents.enabled":false,"features.image_generation":false,"web_search":input.webSearch?"live":"disabled"}});
  threadId=(started as any).thread.id;
  await client.request("turn/start",{threadId,input:[{type:"text",text:input.prompt,text_elements:[]}],effort:"low",...(input.schema?{outputSchema:input.schema}:{})});
  return await completed;
 }finally{clearTimeout(timeout);client.off("event",listener);await client.stop();}
}
