import {test} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {runHarnessModel} from "./harness-model-call.js";
test("bounded model operations use native ephemeral thread/turn and refuse client tools",async()=>{
 const calls:Array<{method:string;params:any}>=[],denials:any[]=[];
 class NativeFixture extends EventEmitter{
  async start(){}async stop(){}
  rejectServerRequest(...args:any[]){denials.push(args);}
  async request(method:string,params:any){
   calls.push({method,params});
   if(method==="thread/start")return {thread:{id:"owned-ephemeral"}};
   if(method==="turn/start"){
    this.emit("event",{type:"server_request",id:1,method:"item/tool/call",params:{tool:"shell"}});
    for(const [method,rest] of [
     ["item/completed",{item:{type:"webSearch",id:"s",results:[{url:"https://example.org",title:"Source"}]}}],
     ["item/completed",{item:{type:"agentMessage",id:"a",text:"answer"}}],
     ["turn/completed",{turn:{id:"native-turn",status:"completed"}}],
    ])this.emit("event",{type:"notification",method,params:{threadId:"owned-ephemeral",...(rest as object)}});
    return {turn:{id:"native-turn"}};
   }
  }
 }
 const r=await runHarnessModel({model:"gpt-5.6-luna",prompt:"fixture",instructions:"fixture",webSearch:true,timeoutMs:1000},()=>new NativeFixture() as any);
 assert.equal(r.turnId,"native-turn");assert.equal(r.sources.length,1);
 assert.equal(calls[0].params.ephemeral,true);assert.equal(calls[0].params.config["mcp_servers.commerce_web.enabled"],false);
 assert.equal(calls[0].params.config["web_search"],"live");assert.equal(denials.length,1);
 assert.deepEqual(calls.map(c=>c.method),["thread/start","turn/start"]);
});
