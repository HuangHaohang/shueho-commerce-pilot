import {beforeEach,describe,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('@/lib/enterprise/database-context',()=>({withEnterpriseTenantDatabaseContext:async(_scope:unknown,fn:any)=>fn({query:mock.query}),withEnterpriseDatabaseContext:async(_scope:unknown,fn:any)=>fn({query:mock.query})}));
import {revalidateExternalDataCall} from './external-data';
const scope={tenantId:'tenant',workspaceId:'workspace',userId:'user',mcpAccessTokenId:'token'};
let token=true,permission=true,price=200000,spent=200000,policyMode='policy';
beforeEach(()=>{
 token=true;permission=true;price=200000;spent=200000;policyMode='policy';
 mock.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('FROM commerce_mcp_access_token'))return {rowCount:token?1:0,rows:[]};
  if(sql.includes('effective_roles'))return {rows:[{allowed:permission,denied:false}]};
  if(sql.startsWith('SELECT * FROM commerce_external_data_call'))return {rows:[{state:'dispatched',approval_state:'not_required',endpoint_id:'fixture.reviews',platform:'fixture',billable_amount_micros:200000,currency:'CNY'}]};
  if(sql.includes('INSERT INTO commerce_external_data_policy'))return {rows:[]};
  if(sql.includes('FROM commerce_external_data_policy'))return {rows:[{status:'enabled',approval_mode:policyMode,allowed_platforms:['fixture'],allowed_endpoint_ids:[],monthly_call_limit:100,monthly_spend_limit_micros:500000000,per_call_auto_approval_micros:null}]};
  if(sql.includes('FROM commerce_external_data_rate_card'))return {rows:[]};
  if(sql.includes('FROM commerce_external_provider_endpoint'))return {rows:[{customer_unit_price_micros:price,currency:'CNY'}]};
  if(sql.includes('billing_anchor_day'))return {rows:[{billing_anchor_day:1}]};
  if(sql.includes('unresolved_amounts'))return {rows:[{calls_used:'1',spend_used_micros:String(spent),unresolved_amounts:'0'}]};
  throw new Error('Unexpected query');
 });
});
describe('live dispatch revalidation',()=>{
 it('retains the monthly-only policy and existing dispatch receipt',async()=>{expect((await revalidateExternalDataCall(scope,'reservation')).state).toBe('dispatched');});
 it('refuses a revoked token even when a dispatch checkpoint already exists',async()=>{token=false;await expect(revalidateExternalDataCall(scope,'reservation')).rejects.toMatchObject({code:'MCP_TOKEN_REVOKED'});});
 it('refuses role revocation, new price, budget reduction and changed approval policy',async()=>{
  permission=false;await expect(revalidateExternalDataCall(scope,'r')).rejects.toMatchObject({code:'EXTERNAL_DATA_PERMISSION_REVOKED'});
  permission=true;price=300000;await expect(revalidateExternalDataCall(scope,'r')).rejects.toMatchObject({code:'EXTERNAL_DATA_PRICE_CHANGED'});
  price=200000;spent=500000001;await expect(revalidateExternalDataCall(scope,'r')).rejects.toMatchObject({code:'EXTERNAL_DATA_BUDGET_EXCEEDED'});
  spent=0;policyMode='always_ask';await expect(revalidateExternalDataCall(scope,'r')).rejects.toMatchObject({code:'EXTERNAL_DATA_APPROVAL_CHANGED'});
 });
});
