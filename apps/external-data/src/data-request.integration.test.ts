import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({tokenIds:[] as string[]}));
vi.mock("./justoneapi-runtime.js",()=>({getJustOneApiClient:()=>({configuredCredentialIds:async()=>mocks.tokenIds})}));
import { config } from "./config.js";
import { database } from "./database.js";
import { capabilityId, readDataCapability } from "./data-capabilities.js";
import { createDataRequestPlan, claimDataRequestPlan, cancelDataRequestPlan } from "./data-request-plans.js";
import { executeDataRequestPlan, readDataRequestResult } from "./data-request-execution.js";
import { ExternalDataPipeline } from "./pipeline.js";
import { credentialForToken } from "./justoneapi-credentials.js";
import { importJustOneApiQuotaSnapshot } from "./justoneapi-quota-import.js";
import type { JustOneApiClient } from "./justoneapi-client.js";
import type { LocalModelClient } from "./local-model-client.js";
import type { ExternalDataScope, ProviderCallResult } from "./types.js";
const github=process.env.GITHUB_ACTIONS==="true" && process.env.NODE_ENV==="test";
const runtimeUrl=process.env.JUSTONEAPI_TEST_DATABASE_URL ?? (github ? process.env.EXTERNAL_DATA_DATABASE_URL : undefined);
const ownerUrl=process.env.JUSTONEAPI_TEST_MIGRATION_DATABASE_URL ?? (github ? process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL : undefined);
const owner=new Pool({connectionString:ownerUrl});
const endpointId=`fixture_data.ask_${randomUUID().replaceAll("-","")}`;
const apiPath=`/api/fixture/${randomUUID()}`;
const tenantId=randomUUID(),workspaceId=randomUUID();
const scope=():ExternalDataScope=>({tenantId,workspaceId,userId:"fixture-user",source:"external_mcp",sourceCallId:`fixture_${randomUUID()}`,requestText:"查询品牌问答"});
const auth={allowedEndpointIds:[endpointId],allowedCatalogPlatforms:["fixture_data"]};

describe.skipIf(!runtimeUrl || !ownerUrl)("full catalog data plans with isolated PostgreSQL",()=>{
  beforeAll(async()=>{
    expect(config.databaseUrl).toBe(runtimeUrl);
    await owner.query(`INSERT INTO provider_endpoint(endpoint_id,platform_id,platform_name,display_name,capability,api_path,http_method,schema_version,
      request_schema,request_codec,response_family,enabled,catalog_status,pricing_status,permission_status,normalizer_version)
      VALUES($1,'fixture_data','Fixture AI','Fixture 问答 AI','问答输出',$2,'GET','v1',
      '{"type":"object","required":["keyword"],"properties":{"keyword":{"type":"string"},"sort":{"type":"string","enum":["latest","popular"],"default":"latest"}},"additionalProperties":false}',
      '{"query":["keyword","sort"],"path":[],"header":[],"form":[],"bodyContentType":null}',
      'generic_json_v1',true,'active','priced','allowed','generic-json-v1')`,[endpointId,apiPath]);
    const credential=credentialForToken(`fixture-${randomUUID()}`);mocks.tokenIds=[credential.id];
    await importJustOneApiQuotaSnapshot(owner,[credential],{schemaVersion:1,mode:"initial",sourceReference:"https://dashboard.justoneapi.com/zh/dashboard/free-trial",
      observedAt:new Date(Date.now()-1000).toISOString(),evidenceSha256:["b".repeat(64)],quotas:{[apiPath]:10}});
  });
  afterAll(async()=>{await owner.end();await database.end();});
  it("plans without dispatch, claims once, links before sending, and returns validated source fields",async()=>{
    const actor=scope();const planned=await createDataRequestPlan(actor,capabilityId(endpointId),{keyword:"品牌"},auth);
    expect(planned.state).toBe("ready");
    expect(await createDataRequestPlan(actor,capabilityId(endpointId),{keyword:"品牌"},auth)).toMatchObject({plan_id:planned.plan_id});
    const executor={...actor,sourceCallId:`execute_${randomUUID()}`};
    const claimed=await claimDataRequestPlan(executor,planned.plan_id,auth);
    expect(claimed.reused).toBe(false);
    expect((await claimDataRequestPlan(executor,planned.plan_id,auth)).reused).toBe(false); // same RPC claim retry
    expect((await claimDataRequestPlan({...executor,sourceCallId:`other_${randomUUID()}`},planned.plan_id,auth)).reused).toBe(true);
    const payload={code:0,data:{answer:"没有提及这个品牌",sources:[{title:"公开来源",id:"0001"}],api_key:"private-fixture"}};
    const rawBody=JSON.stringify(payload),rawBytes=Buffer.from(rawBody);
    const response:ProviderCallResult={state:"succeeded",httpStatus:200,payload,rawBody,rawBytes,responseSha256:createHash("sha256").update(rawBytes).digest("hex"),
      contentType:"application/json",responseBytes:rawBytes.length,providerCode:0,providerMessage:null,providerRequestId:null,providerRecordedAt:null};
    const call=vi.fn(async()=>{
      const pending=await readDataRequestResult(actor,planned.plan_id);
      expect(pending?.processing_state).toBe("collecting");
      return response;
    });
    const models={health:vi.fn(()=>{throw new Error("Direct field validation does not require a relevance model");})};
    const pipeline=new ExternalDataPipeline({call,configured:true} as unknown as JustOneApiClient,models as unknown as LocalModelClient);
    const result=await executeDataRequestPlan(pipeline,executor,planned.plan_id);
    expect(result.success).toBe(true);expect(call).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.evidence)).toContain("没有提及这个品牌");
    expect(JSON.stringify(result.evidence)).not.toContain("private-fixture");
    expect((await claimDataRequestPlan(executor,planned.plan_id,auth)).reused).toBe(true);
    expect((await readDataRequestResult(actor,planned.plan_id,{limit:1}))?.coverage).toMatchObject({returnedFields:1,nextFieldOffset:1});
    const stored=await owner.query("SELECT response_sha256 FROM external_api_call_raw WHERE research_request_id=$1",[result.research_request_id]);
    expect(stored.rows[0].response_sha256).toBe(response.responseSha256);
    await expect(owner.query("UPDATE provider_data_request_plan SET normalized_input='{}' WHERE id=$1",[planned.plan_id])).rejects.toThrow("immutable");
    expect(await readDataRequestResult({...actor,tenantId:randomUUID()},planned.plan_id)).toBeNull();
  });
  it("rejects changed inputs, foreign ownership, stale catalog schemas and protects cancelled plans",async()=>{
    const actor=scope();const planned=await createDataRequestPlan(actor,capabilityId(endpointId),{keyword:"A"},auth);
    await expect(createDataRequestPlan(actor,capabilityId(endpointId),{keyword:"B"},auth)).rejects.toMatchObject({code:"DATA_PLAN_IDEMPOTENCY_CONFLICT"});
    await expect(claimDataRequestPlan({...actor,userId:"foreign"},planned.plan_id,auth)).rejects.toMatchObject({code:"DATA_PLAN_NOT_FOUND"});
    await cancelDataRequestPlan(actor,planned.plan_id);
    expect((await claimDataRequestPlan(actor,planned.plan_id,auth)).reused).toBe(true);
    const second=await createDataRequestPlan(scope(),capabilityId(endpointId),{keyword:"C"},auth);
    await owner.query("UPDATE provider_endpoint SET openapi_sha256=$2 WHERE endpoint_id=$1",[endpointId,"c".repeat(64)]);
    await expect(claimDataRequestPlan({...actor,sourceCallId:"new_claim"},second.plan_id,auth)).rejects.toMatchObject({code:"DATA_PLAN_REVISION_CHANGED"});
    expect((await readDataCapability(capabilityId(endpointId),auth)).view.registered).toBe(true);
  });
});
