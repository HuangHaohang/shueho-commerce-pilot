import { dataRequestRevision } from "./data-request-market.js";
import { sha256Json } from "./canonical.js";
import { withScope } from "./database.js";
import { DataCapabilityError, capabilityRevision, isProtectedField, readDataCapability, type DataCapabilityAuthorization } from "./data-capabilities.js";
import { getEndpoint, validateEndpointParams } from "./endpoint-registry.js";
import type { ExternalDataScope, JsonObject } from "./types.js";

export type DataRequestPlan = {
  id: string; tenant_id: string; workspace_id: string; user_id: string; source: ExternalDataScope["source"];
  root_thread_id: string | null; thread_id: string | null; turn_id: string | null;
  endpoint_id: string; catalog_revision: string; plan_key: string; request_text: string;
  normalized_input: JsonObject; max_fields: number; state: string; research_request_id: string | null; expires_at: Date; claim_source_call_id: string | null;
};

export function assertBusinessDataInputs(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 64_000) {
    throw new DataCapabilityError("业务参数必须是有效且有界的对象。", "INVALID_DATA_INPUTS");
  }
  const visit = (node: unknown, depth: number) => {
    if (depth > 15) throw new DataCapabilityError("业务参数嵌套过深。", "INVALID_DATA_INPUTS");
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (isProtectedField(key) || ["__proto__","constructor","prototype"].includes(key)) {
        throw new DataCapabilityError("凭证与运行配置不能作为业务参数传入。", "PROTECTED_DATA_INPUT");
      }
      visit(child,depth+1);
    }
  };
  visit(value,0);
}

export async function createDataRequestPlan(scope: ExternalDataScope, capabilityId: string, inputs: JsonObject, authorization: DataCapabilityAuthorization) {
  if (scope.source === "archive_import") throw new DataCapabilityError("原始导入不能创建可执行计划。", "INVALID_PLAN_SOURCE");
  assertBusinessDataInputs(inputs);
  const { row, view } = await readDataCapability(capabilityId,authorization);
  const blockers = (view.blocking_reasons as string[]).filter((reason) => !reason.startsWith("TOKEN_QUOTA_"));
  if (blockers.length) throw new DataCapabilityError("接口已登记，但当前接入条件尚未就绪。", "DATA_CAPABILITY_BLOCKED", { capability: view });
  const endpoint = await getEndpoint(row.endpoint_id);
  const normalized = validateEndpointParams(endpoint,inputs);
  const revision = await dataRequestRevision(row,normalized);
  const key = sha256Json({ version: 1, capabilityId,revision,inputs: normalized,request: scope.requestText,maxFields: 50 });
  const plan = await withScope(scope, async (client) => {
    const inserted = await client.query<DataRequestPlan>(`
      INSERT INTO provider_data_request_plan(tenant_id,workspace_id,user_id,source,source_call_id,root_thread_id,thread_id,turn_id,
        endpoint_id,catalog_revision,plan_key,request_text,normalized_input,max_fields,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,50,clock_timestamp()+INTERVAL '30 minutes')
      ON CONFLICT(tenant_id,source,source_call_id) DO NOTHING RETURNING *`,
    [scope.tenantId,scope.workspaceId,scope.userId,scope.source,scope.sourceCallId,scope.rootThreadId ?? null,scope.threadId ?? null,scope.turnId ?? null,
      endpoint.endpointId,revision,key,scope.requestText,JSON.stringify(normalized)]);
    const result = inserted.rows[0] ?? (await client.query<DataRequestPlan>(`
      SELECT * FROM provider_data_request_plan WHERE tenant_id=$1 AND source=$2 AND source_call_id=$3`,
    [scope.tenantId,scope.source,scope.sourceCallId])).rows[0];
    if (!result || result.workspace_id !== scope.workspaceId || result.user_id !== scope.userId || result.plan_key !== key ||
        result.thread_id !== (scope.threadId ?? null) || result.turn_id !== (scope.turnId ?? null)) {
      throw new DataCapabilityError("幂等键已绑定其他数据计划。", "DATA_PLAN_IDEMPOTENCY_CONFLICT");
    }
    return result;
  });
  return { success: true, plan_id: plan.id, plan_key: plan.plan_key, expires_at: plan.expires_at.toISOString(),
    state: view.executable ? "ready" : "blocked", capability: view,
    endpoint_id: endpoint.endpointId,platform: endpoint.platformId,normalized_inputs: normalized,
    business_intent: dataPlanIntent(plan,endpoint.platformId), provider_calls: 1 };
}

export async function readOwnedDataRequestPlan(scope: ExternalDataScope, id: string): Promise<DataRequestPlan> {
  const plan = await withScope(scope, async (client) => (await client.query<DataRequestPlan>(`
    SELECT * FROM provider_data_request_plan WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3`, [id,scope.tenantId,scope.workspaceId])).rows[0]);
  if (!plan || plan.user_id !== scope.userId || plan.source !== scope.source || plan.root_thread_id !== (scope.rootThreadId ?? null) ||
      plan.thread_id !== (scope.threadId ?? null) || plan.turn_id !== (scope.turnId ?? null)) {
    throw new DataCapabilityError("数据计划不存在或不属于当前任务。", "DATA_PLAN_NOT_FOUND");
  }
  return plan;
}

export async function claimDataRequestPlan(scope: ExternalDataScope, id: string, authorization: DataCapabilityAuthorization) {
  const plan = await readOwnedDataRequestPlan(scope,id);
  const sameClaim = plan.state === "executing" && plan.claim_source_call_id === scope.sourceCallId;
  if (plan.state !== "ready" && !sameClaim) return { success: true, reused: true, plan_id: id, state: plan.state };
  if (plan.expires_at.getTime() <= Date.now()) throw new DataCapabilityError("数据计划已过期，请重新免费规划。", "DATA_PLAN_EXPIRED");
  const { capabilityId } = await import("./data-capabilities.js");
  const { row, view } = await readDataCapability(capabilityId(plan.endpoint_id),authorization);
  if (await dataRequestRevision(row,plan.normalized_input) !== plan.catalog_revision) throw new DataCapabilityError("接口目录或参数定义已更新，请重新免费规划。", "DATA_PLAN_REVISION_CHANGED");
  if (!view.executable) throw new DataCapabilityError("接口已登记，但当前权限或额度不可用。", "DATA_CAPABILITY_BLOCKED", { capability: view });
  const endpoint = await getEndpoint(plan.endpoint_id);
  const normalized = validateEndpointParams(endpoint,plan.normalized_input);
  if (sha256Json(normalized) !== sha256Json(plan.normalized_input)) throw new DataCapabilityError("计划参数已变化。", "DATA_PLAN_REVISION_CHANGED");
  if (!sameClaim) {
    const claimed = await withScope(scope, async (client) => client.query(`
      UPDATE provider_data_request_plan SET state='executing',claim_source_call_id=$2,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='ready' AND expires_at>clock_timestamp() RETURNING id`, [id,scope.sourceCallId]));
    if (claimed.rowCount !== 1) return { success: true, reused: true, plan_id: id, state: "executing" };
  }
  return { success: true, reused: false, plan_id: id, plan_key: plan.plan_key, endpoint_id: plan.endpoint_id,
    platform: endpoint.platformId,normalized_inputs: plan.normalized_input,request_text: plan.request_text,
    source_call_id: dataPlanCallId(id),business_intent: dataPlanIntent(plan,endpoint.platformId),capability: view };
}

export function dataPlanCallId(id: string): string { return `data_plan_${id.replaceAll("-","")}`; }
export function dataPlanIntent(plan: DataRequestPlan, platform: string): JsonObject {
  return { data_plan_id:plan.id,data_plan_source_call_id:dataPlanCallId(plan.id),kind: "provider_data_query",platform,target_product: null,objective: "provider_observation",requested_metrics: [],
    requested_top_n: plan.max_fields,time_range: null,window_enforcement: null };
}

export async function cancelDataRequestPlan(scope: ExternalDataScope, id: string): Promise<void> {
  await readOwnedDataRequestPlan(scope,id);
  await withScope(scope, async (client) => { await client.query(`UPDATE provider_data_request_plan SET state='cancelled',updated_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND state IN ('ready','executing') AND research_request_id IS NULL`, [id]); });
}
