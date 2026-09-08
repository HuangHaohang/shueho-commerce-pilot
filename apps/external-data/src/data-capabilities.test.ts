import { expect, it } from "vitest";
import { capabilityId, capabilityView, type DataCapabilityRow } from "./data-capabilities.js";
import { assertBusinessDataInputs } from "./data-request-plans.js";
import { normalizeProviderFields } from "./provider-data-observations.js";

const row: DataCapabilityRow = {endpoint_id:"fixture.ask_ai",platform_id:"fixture",platform_name:"AI 服务",display_name:"问答 AI",capability:"问题探索",
  api_path:"/api/fixture/ask",http_method:"GET",enabled:true,catalog_status:"active",pricing_status:"priced",permission_status:"allowed",
  request_schema:{type:"object",required:["keyword"],properties:{keyword:{type:"string"},token:{type:"string"}}},request_codec:{},response_family:"generic_json_v1",
  source_catalog_import_id:null,openapi_sha256:null,quota_pairs:6,quota_ready:0,quota_remaining:"0"};

it("distinguishes an existing AI capability with no local quota from a missing interface", () => {
  const view=capabilityView(row,{},true);
  expect(view).toMatchObject({registered:true,executable:false,category:"ai_answers",blocking_reasons:["TOKEN_QUOTA_UNAVAILABLE"]});
  expect(JSON.stringify(view)).not.toContain("/api/fixture");
  expect((view.input_schema as {properties:object}).properties).not.toHaveProperty("token");
  expect(capabilityId(row.endpoint_id)).toMatch(/^cap_[a-f0-9]{24}$/);
});
it("reports pricing, provider permission and workspace permission independently", () => {
  expect(capabilityView({...row,pricing_status:"missing",permission_status:"unavailable",quota_ready:1},
    {allowedEndpointIds:["other.operation"]})).toMatchObject({blocking_reasons:["PRICING_UNAVAILABLE","PROVIDER_PERMISSION_UNAVAILABLE","WORKSPACE_PERMISSION_DENIED"]});
});
it("rejects nested credential and prototype inputs", () => {
  for(const input of [{cookie:"private"},{request:{apiKey:"private"}},JSON.parse('{"__proto__":{"admin":true}}')]) {
    expect(()=>assertBusinessDataInputs(input)).toThrow();
  }
  expect(()=>assertBusinessDataInputs({keyword:"接口安全",page:1,price:null})).not.toThrow();
});
it("preserves negative AI observations, empty/null values and source pointers without credential leakage", () => {
  const original={code:0,data:{answer:"本次回答没有提及目标品牌。",sources:[{title:"来源",url:"https://example.com/note"}],missing:null,empty:[],zero:0,
    api_key:"do-not-expose",unsafeId:9007199254740992}};
  const before=JSON.stringify(original);
  const normalized=normalizeProviderFields(original);
  const visible=normalized.observations.filter(row=>row.quality_status==="valid");
  expect(visible).toEqual(expect.arrayContaining([
    expect.objectContaining({field_path:"/data/answer",normalized_value:"本次回答没有提及目标品牌。"}),
    expect.objectContaining({field_path:"/data/empty",normalized_value:[],value_type:"array"}),
    expect.objectContaining({field_path:"/data/missing",normalized_value:null}),
    expect.objectContaining({field_path:"/data/zero",normalized_value:0}),
  ]));
  expect(JSON.stringify(visible)).not.toContain("do-not-expose");
  expect(visible.some(row=>row.field_name==="unsafeId")).toBe(false);
  expect(JSON.stringify(original)).toBe(before);
});
