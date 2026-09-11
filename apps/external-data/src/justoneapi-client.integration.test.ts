import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultJustOneApiResilience } from "./justoneapi-retry-policy.js";
import { JustOneApiClient } from "./justoneapi-client.js";
import { credentialForToken, type JustOneApiCredential } from "./justoneapi-credentials.js";
import { JustOneApiError } from "./justoneapi-errors.js";
import type { JustOneApiTransport } from "./justoneapi-http-transport.js";
import { importJustOneApiQuotaSnapshot } from "./justoneapi-quota-import.js";
import { PostgresJustOneApiTokenStore, type JustOneApiCallIdentity } from "./justoneapi-token-store.js";
import { buildProviderTransportRequest } from "./transport-request.js";
import type { ProviderCallResult, ProviderEndpoint } from "./types.js";

const githubTest = process.env.GITHUB_ACTIONS === "true" && process.env.NODE_ENV === "test";
const runtimeUrl = process.env.JUSTONEAPI_TEST_DATABASE_URL ?? (githubTest ? process.env.EXTERNAL_DATA_DATABASE_URL : undefined);
const ownerUrl = process.env.JUSTONEAPI_TEST_MIGRATION_DATABASE_URL ?? (githubTest ? process.env.EXTERNAL_DATA_MIGRATION_DATABASE_URL : undefined);
const enabled = Boolean(runtimeUrl && ownerUrl);
const runtime = new Pool({ connectionString: runtimeUrl, max: 20 });
const owner = new Pool({ connectionString: ownerUrl, max: 2 });
const scope = { tenantId: randomUUID(), workspaceId: randomUUID() };
const pathA = "/api/search/v1";
const pathB = "/api/taobao/search-item-list/v1";
const endpoint = (apiPath = pathA): ProviderEndpoint => ({
  endpointId: apiPath === pathA ? "search.search_v1" : "taobao.search_item_list_v1",
  platformId: "test", platformName: "test", displayName: "test", capability: "test", apiPath, httpMethod: "GET",
  schemaVersion: "v1", requestSchema: {}, responseSchema: {}, requestCodec: {}, paginationStrategy: {},
  responseFamily: "test", normalizerVersion: "1", catalogStatus: "active", pricingStatus: "priced", permissionStatus: "allowed",
  enabled: true, documentationUrl: null, openapiUrl: null,
});

function response(code = 0): ProviderCallResult {
  const payload = { code, data: code === 0 ? { items: [{ id: "fixture" }] } : null };
  const rawBody = JSON.stringify(payload); const rawBytes = Buffer.from(rawBody);
  return { state: code === 0 ? "succeeded" : "business_failed", httpStatus: 200, payload, rawBody, rawBytes,
    responseSha256: createHash("sha256").update(rawBytes).digest("hex"), contentType: "application/json",
    responseBytes: rawBytes.length, providerCode: code, providerMessage: null, providerRequestId: null, providerRecordedAt: null };
}

async function ownedRequest(apiPath = pathA, selectedScope = scope) {
  const ep = endpoint(apiPath); const request = buildProviderTransportRequest(ep, {});
  const client = await owner.connect();
  try {
    await client.query("BEGIN");
    const research = await client.query<{ id: string }>(`INSERT INTO research_request(tenant_id,workspace_id,user_id,source,source_call_id,request_text,structured_intent,intent_key)
      VALUES ($1,$2,'fixture','external_mcp',$3,'fixture','{}',$4) RETURNING id`,
    [selectedScope.tenantId,selectedScope.workspaceId,randomUUID(),"a".repeat(64)]);
    const query = await client.query<{ id: string }>(`INSERT INTO external_query(tenant_id,workspace_id,research_request_id,endpoint_id,schema_version,query_key,page_key,requested_params,canonical_query_params)
      VALUES ($1,$2,$3,$4,'v1',$5,$5,'{}','{}') RETURNING id`,
    [selectedScope.tenantId,selectedScope.workspaceId,research.rows[0]!.id,ep.endpointId,"b".repeat(64)]);
    const raw = await client.query<{ id: string }>(`INSERT INTO external_api_call_raw(tenant_id,workspace_id,user_id,research_request_id,external_query_id,endpoint_id,api_path,http_method,state,request_params,request_sha256,request_bytes,dispatched_at)
      VALUES ($1,$2,'fixture',$3,$4,$5,$6,'GET','dispatched','{}',$7,$8,CURRENT_TIMESTAMP) RETURNING id`,
    [selectedScope.tenantId,selectedScope.workspaceId,research.rows[0]!.id,query.rows[0]!.id,ep.endpointId,apiPath,request.requestSha256,request.requestBytes]);
    await client.query("COMMIT");
    const identity: JustOneApiCallIdentity = { ...selectedScope,userId:"fixture",rawCallId: raw.rows[0]!.id,apiPath,requestSha256: request.requestSha256 };
    return { ep, request, identity };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function fixture(count = 2, quotaA = 3, quotaB = 2) {
  const credentials = Array.from({ length: count }, () => credentialForToken(`fixture-${randomUUID()}`));
  const snapshot = { schemaVersion: 1, mode: "initial", sourceReference: "https://dashboard.justoneapi.com/zh/dashboard/free-trial",
    observedAt: new Date(Date.now()-1000).toISOString(), evidenceSha256: ["c".repeat(64)], quotas: { [pathA]: quotaA,[pathB]: quotaB } };
  const receipt = await importJustOneApiQuotaSnapshot(owner, credentials, snapshot);
  const store = new PostgresJustOneApiTokenStore(runtime);
  const sent: string[] = [];
  const make = (send: (credential: JustOneApiCredential) => Promise<ProviderCallResult> = async () => response(), before?: () => Promise<void>, customStore = store, maxAttempts = 1) => {
    const transport: JustOneApiTransport = { prepare: async () => {
      await before?.();
      return { proxyNodeId: "node-0000000000000001", close() {}, send: async (credential) => { sent.push(credential.id); return send(credential); } };
    } };
    return new JustOneApiClient({
      admission: { acquire: async () => ({ acquired: true,waitMs: 0,reason: null }),feedback: async () => 0,release: async () => undefined },
      resilience: { ...defaultJustOneApiResilience,maxAttempts,minimumAttemptWindowMs: 1,retryBaseMs: 1 }, credentials: async () => credentials, store: customStore, transport, timeoutMs: () => 5000, configured: true });
  };
  const counters = async (apiPath = pathA) => (await owner.query(`SELECT token_id,remaining_calls::int,reserved_calls::int,
    used_calls::int,inflight_calls::int,state FROM justoneapi_token_endpoint_quota WHERE api_path=$1 AND token_id=ANY($2) ORDER BY array_position($2::text[],token_id)`,
  [apiPath,credentials.map((token) => token.id)])).rows;
  return { credentials,snapshot,receipt,store,sent,make,counters };
}

describe.skipIf(!enabled)("unified JustOneAPI client with real PostgreSQL quotas", () => {
  beforeAll(async () => {
    const role = await runtime.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  afterAll(async () => { await runtime.end(); await owner.end(); });

  it("rotates tokens by endpoint, debits once, survives a new client, and retains complete raw responses", async () => {
    const f = await fixture();
    for (let index = 0; index < 4; index += 1) {
      const call = await ownedRequest();
      await f.make().call(call.ep,call.request,call.identity);
    }
    expect(f.sent).toEqual([f.credentials[0]!.id,f.credentials[1]!.id,f.credentials[0]!.id,f.credentials[1]!.id]);
    expect((await f.counters()).map((row) => [row.remaining_calls,row.used_calls,row.reserved_calls,row.inflight_calls])).toEqual([[1,2,0,0],[1,2,0,0]]);
    expect((await f.counters(pathB)).map((row) => row.remaining_calls)).toEqual([2,2]);
    const saved = await owner.query("SELECT response_raw_bytes,response_payload,response_sha256 FROM justoneapi_token_attempt WHERE token_id=ANY($1)", [f.credentials.map((token) => token.id)]);
    expect(saved.rowCount).toBe(4);
    expect(saved.rows[0].response_raw_bytes.toString()).toBe(response().rawBody);
    expect(JSON.stringify(saved.rows)).not.toContain(f.credentials[0]!.token);
  });

  it("does not over-allocate under concurrent processes", async () => {
    const f = await fixture(2,2);
    const calls = await Promise.all(Array.from({ length: 15 }, () => ownedRequest()));
    const results = await Promise.allSettled(calls.map((call) => f.make().call(call.ep,call.request,call.identity)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    expect(f.sent).toHaveLength(4);
    expect((await f.counters()).map((row) => [row.remaining_calls,row.used_calls,row.reserved_calls])).toEqual([[0,2,0],[0,2,0]]);
  });

  it("shares the provider budget across independently owned tenant calls", async () => {
    const f = await fixture(1,2);
    const otherScope = {tenantId:randomUUID(),workspaceId:randomUUID()};
    const calls = await Promise.all([ownedRequest(),ownedRequest(pathA,otherScope),ownedRequest(pathA,otherScope)]);
    const results = await Promise.allSettled(calls.map((call) => f.make().call(call.ep,call.request,call.identity)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(f.sent).toHaveLength(2);
    expect((await f.counters())[0]).toMatchObject({remaining_calls:0,used_calls:2,reserved_calls:0});
  });

  it("only one duplicate execution may claim the same immutable warehouse call", async () => {
    const f = await fixture(); const call = await ownedRequest();
    const results = await Promise.allSettled([f.make().call(call.ep,call.request,call.identity),f.make().call(call.ep,call.request,call.identity)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(f.sent).toHaveLength(1);
    await expect(f.make().call(call.ep,call.request,call.identity)).rejects.toMatchObject({ code: "CALL_ALREADY_CLAIMED" });
    expect(f.sent).toHaveLength(1);
  });

  it.each([303,601,602])("archives quota code %s and succeeds with a different key in the same governed call", async code => {
    const f = await fixture(); const call = await ownedRequest();
    const result = await f.make(async credential => response(credential.id === f.credentials[0]!.id ? code : 0),undefined,f.store,3)
      .call(call.ep,call.request,call.identity);
    expect(result.providerCode).toBe(0);
    expect(f.sent).toEqual(f.credentials.map(c=>c.id));
    expect(await f.counters()).toMatchObject([
      {remaining_calls:0,state:'exhausted',used_calls:1,reserved_calls:0,inflight_calls:0},
      {remaining_calls:2,state:'active',used_calls:1,reserved_calls:0,inflight_calls:0},
    ]);
    expect((await f.counters(pathB)).map(r=>[r.remaining_calls,r.state,r.used_calls])).toEqual([[2,'active',0],[2,'active',0]]);
    const archive=await owner.query('SELECT provider_code,response_payload,response_raw_bytes FROM justoneapi_token_attempt WHERE raw_call_id=$1 ORDER BY ordinal',[call.identity.rawCallId]);
    expect(archive.rows.map(r=>r.provider_code)).toEqual([code,0]);
    expect(archive.rows[0]!.response_payload.code).toBe(code);
    expect(JSON.parse(archive.rows[0]!.response_raw_bytes.toString()).code).toBe(code);
    const next=await ownedRequest();await f.make().call(next.ep,next.request,next.identity);
    expect(f.sent[2]).toBe(f.credentials[1]!.id);
  });

  it("archives an endpoint quota rejection once and rotates the next governed call when attempt budget is one", async () => {
    const f = await fixture(); const call = await ownedRequest();
    await f.make(async (credential) => response(credential.id === f.credentials[0]!.id ? 601 : 0)).call(call.ep,call.request,call.identity);
    expect(f.sent).toHaveLength(1);
    const next = await ownedRequest();
    await f.make().call(next.ep,next.request,next.identity);
    const rows = await f.counters();
    expect(rows[0]).toMatchObject({ state: "exhausted", remaining_calls: 0, used_calls: 1 });
    expect(rows[1]).toMatchObject({ remaining_calls: 2, used_calls: 1 });
    const another = await ownedRequest(pathB);
    await f.make().call(another.ep,another.request,another.identity);
    expect(f.sent[2]).toBe(f.credentials[0]!.id);
    const raw = await owner.query("SELECT provider_code,response_raw_bytes FROM justoneapi_token_attempt WHERE raw_call_id=ANY($1::uuid[]) ORDER BY created_at",[[call.identity.rawCallId,next.identity.rawCallId]]);
    expect(raw.rows.map((row) => row.provider_code)).toEqual([601,0]);
    expect(raw.rows.every((row) => row.response_raw_bytes.length > 0)).toBe(true);
  });

  it("invalidates a truly invalid token globally but scopes permission and rate failures to the endpoint", async () => {
    const f = await fixture(3); const call = await ownedRequest();
    await f.make(async (credential) => response(credential.id === f.credentials[0]!.id ? 100 : credential.id === f.credentials[1]!.id ? 600 : 0)).call(call.ep,call.request,call.identity);
    const denied = await ownedRequest();
    await f.make(async () => response(600)).call(denied.ep,denied.request,denied.identity);
    expect((await f.counters())[1]).toMatchObject({ state: "permission_denied", remaining_calls: 2, used_calls: 1 });
    const another = await ownedRequest(pathB);
    await f.make(async () => response(302)).call(another.ep,another.request,another.identity);
    expect(f.sent.at(-1)).toBe(f.credentials[1]!.id);
    const state = await owner.query("SELECT state FROM justoneapi_token WHERE token_id=$1",[f.credentials[0]!.id]);
    expect(state.rows[0].state).toBe("invalid");
  });

  it("releases an unsent reservation on proxy failure and never increments used calls", async () => {
    const f = await fixture(); const call = await ownedRequest();
    await expect(f.make(undefined,async () => { throw new JustOneApiError("proxy unavailable","PROXY_UNAVAILABLE",false); })
      .call(call.ep,call.request,call.identity)).rejects.toMatchObject({ uncertain: false,code: "PROXY_UNAVAILABLE" });
    expect(f.sent).toHaveLength(0);
    expect((await f.counters())[0]).toMatchObject({ remaining_calls: 3,used_calls: 0,reserved_calls: 0 });
  });

  it("holds the debit after an uncertain request and cannot retry or double-settle it", async () => {
    const f = await fixture(); const call = await ownedRequest();
    await expect(f.make(async () => { throw new JustOneApiError("uncertain","RESULT_UNKNOWN",true); })
      .call(call.ep,call.request,call.identity)).rejects.toMatchObject({ uncertain: true });
    expect(f.sent).toHaveLength(1);
    expect((await f.counters())[0]).toMatchObject({ remaining_calls: 2,used_calls: 1,inflight_calls: 0 });
    await expect(f.make().call(call.ep,call.request,call.identity)).rejects.toMatchObject({ code: "CALL_ALREADY_CLAIMED" });
    expect(f.sent).toHaveLength(1);
  });

  it("archives uncertain HTTP responses without trying another token", async () => {
    const f = await fixture(); const call = await ownedRequest();
    await expect(f.make(async () => ({ ...response(601),httpStatus: 503 })).call(call.ep,call.request,call.identity)).rejects.toMatchObject({ uncertain: true });
    expect(f.sent).toHaveLength(1);
    const raw = await owner.query("SELECT state,http_status,response_raw_bytes FROM justoneapi_token_attempt WHERE raw_call_id=$1",[call.identity.rawCallId]);
    expect(raw.rows[0]).toMatchObject({ state: "unknown",http_status: 503 });
    expect(raw.rows[0].response_raw_bytes.length).toBeGreaterThan(0);
    expect((await f.counters())[0].state).toBe("active");
  });

  it("fails closed if raw receipt persistence fails after dispatch", async () => {
    const f = await fixture(); const call = await ownedRequest();
    class FailingStore extends PostgresJustOneApiTokenStore { override async complete(): Promise<void> { throw new Error("fixture database interruption"); } }
    await expect(f.make(undefined,undefined,new FailingStore(runtime)).call(call.ep,call.request,call.identity)).rejects.toMatchObject({ uncertain: true });
    expect(f.sent).toHaveLength(1);
    expect((await f.counters())[0]).toMatchObject({ remaining_calls: 2,used_calls: 1 });
  });

  it("rejects foreign ownership and enforces RLS and immutable receipt permissions", async () => {
    const f = await fixture(); const call = await ownedRequest();
    await expect(f.make().call(call.ep,call.request,{ ...call.identity,tenantId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_PARAMETER" });
    await expect(f.make().call(call.ep,call.request,{ ...call.identity,userId: "different-user" })).rejects.toMatchObject({ code: "INVALID_PARAMETER" });
    await f.make().call(call.ep,call.request,call.identity);
    const invisible = await runtime.query("SELECT id FROM justoneapi_token_attempt WHERE raw_call_id=$1",[call.identity.rawCallId]);
    expect(invisible.rowCount).toBe(0);
    await expect(runtime.query("INSERT INTO justoneapi_quota_import(source_sha256,source_reference,observed_at,entries) VALUES ($1,'fixture',now(),'[]')",["d".repeat(64)])).rejects.toThrow();
    await expect(owner.query("DELETE FROM justoneapi_token_attempt WHERE raw_call_id=$1",[call.identity.rawCallId])).rejects.toThrow("retained");
  });

  it("replays quota imports without refilling consumption and rejects initial reset and stale readbacks", async () => {
    const f = await fixture(); const call = await ownedRequest();
    await f.make().call(call.ep,call.request,call.identity);
    expect((await importJustOneApiQuotaSnapshot(owner,f.credentials,f.snapshot)).replayed).toBe(true);
    expect((await f.counters())[0].remaining_calls).toBe(2);
    await expect(importJustOneApiQuotaSnapshot(owner,f.credentials,{ ...f.snapshot,observedAt:new Date().toISOString() })).rejects.toThrow("already initialized");
    await expect(importJustOneApiQuotaSnapshot(owner,f.credentials.slice(0,1),{ ...f.snapshot,mode:"observed",observedAt:new Date(Date.now()-60_000).toISOString() })).rejects.toThrow("stale");
    await expect(importJustOneApiQuotaSnapshot(owner,f.credentials,{ ...f.snapshot,mode:"observed" })).rejects.toThrow("exactly one");
  });

  it("does not send with an unknown or zero allowance", async () => {
    const f = await fixture(2,0); const call = await ownedRequest();
    await expect(f.make().call(call.ep,call.request,call.identity)).rejects.toMatchObject({ code:"TOKEN_QUOTA_UNAVAILABLE",uncertain:false });
    expect(f.sent).toHaveLength(0);
  });


  it.each([301,302])("archives rejected attempt %s then succeeds once within the same durable call", async (code) => {
    const f = await fixture(code === 301 ? 1 : 2); const call = await ownedRequest();
    let attempts = 0;
    const result = await f.make(async () => ({ ...response(++attempts === 1 ? code : 0),retryAfterMs: 1 }),undefined,undefined,3)
      .call(call.ep,call.request,call.identity);
    expect(result.providerCode).toBe(0);
    expect(f.sent).toHaveLength(2);
    const saved = await owner.query("SELECT state,provider_code,retry_after_ms,response_raw_bytes FROM justoneapi_token_attempt WHERE raw_call_id=$1 ORDER BY ordinal",[call.identity.rawCallId]);
    expect(saved.rows.map((row) => row.provider_code)).toEqual([code,0]);
    expect(saved.rows.every((row) => row.response_raw_bytes.length > 0)).toBe(true);
    expect((await f.counters()).reduce((sum, row) => sum + row.used_calls,0)).toBe(2);
    expect((await owner.query("SELECT state,attempt_count FROM justoneapi_dispatch WHERE raw_call_id=$1",[call.identity.rawCallId])).rows[0])
      .toEqual({ state:"completed",attempt_count:2 });
    await expect(f.make().call(call.ep,call.request,call.identity)).rejects.toMatchObject({ code:"CALL_ALREADY_CLAIMED" });
    expect(f.sent).toHaveLength(2);
  });

  it("keeps a finish failure after a stored response uncertain rather than declaring no dispatch", async () => {
    const f = await fixture(); const call = await ownedRequest();
    class FailingFinishStore extends PostgresJustOneApiTokenStore { override async finish(): Promise<void> { throw new Error("fixture commit response lost"); } }
    await expect(f.make(undefined,undefined,new FailingFinishStore(runtime)).call(call.ep,call.request,call.identity)).rejects.toMatchObject({uncertain:true,code:"RESULT_UNKNOWN"});
    expect(f.sent).toHaveLength(1);
    expect((await f.counters())[0]).toMatchObject({remaining_calls:2,used_calls:1,inflight_calls:0});
    const raw = await owner.query("SELECT state,response_raw_bytes FROM justoneapi_token_attempt WHERE raw_call_id=$1",[call.identity.rawCallId]);
    expect(raw.rows[0].state).toBe("succeeded");
    expect(raw.rows[0].response_raw_bytes.toString()).toBe(response().rawBody);
  });
});
