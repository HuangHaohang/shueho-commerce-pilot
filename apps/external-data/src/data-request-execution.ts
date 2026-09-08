import { withScope } from "./database.js";
import { dataRequestRevision } from "./data-request-market.js";
import { DataCapabilityError, capabilityId, readDataCapability } from "./data-capabilities.js";
import { dataPlanCallId, readOwnedDataRequestPlan } from "./data-request-plans.js";
import { getEndpoint } from "./endpoint-registry.js";
import type { ExternalDataPipeline } from "./pipeline.js";
import { loadCompactResearchResult } from "./warehouse.js";
import type { ExternalDataScope, JsonObject } from "./types.js";

export async function executeDataRequestPlan(pipeline: ExternalDataPipeline, scope: ExternalDataScope, id: string): Promise<JsonObject> {
  const plan = await readOwnedDataRequestPlan(scope,id);
  if (plan.state !== "executing") throw new DataCapabilityError("数据计划尚未获得执行权，或已经结束。", "DATA_PLAN_NOT_EXECUTING");
  const owner = await withScope(scope, async (client) => client.query(`UPDATE provider_data_request_plan
    SET run_claim_id=gen_random_uuid(),execution_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=$1 AND state='executing' AND run_claim_id IS NULL RETURNING id`,[id]));
  if (owner.rowCount !== 1) return (await readDataRequestResult(scope,id))!;
  try {
  const current = await readDataCapability(capabilityId(plan.endpoint_id),{});
  if (await dataRequestRevision(current.row,plan.normalized_input) !== plan.catalog_revision) throw new DataCapabilityError("接口或市场定义已更新，请重新规划。","DATA_PLAN_REVISION_CHANGED");
  const endpoint = await getEndpoint(plan.endpoint_id);
  const runScope: ExternalDataScope = {
    ...scope, sourceCallId: dataPlanCallId(id), requestText: plan.request_text, topN: plan.max_fields, dataRequestPlanId: id,
    businessIntent: { kind: "provider_data_query", platform: endpoint.platformId,targetProduct: null,objective: "provider_observation",
      requestedMetrics: [],timeRange: null,windowEnforcement: null,requestedTopN: plan.max_fields },
  };
    const result = await pipeline.execute(runScope,plan.endpoint_id,plan.normalized_input);
    await withScope(scope, async (client) => { await client.query(`UPDATE provider_data_request_plan SET state=$2,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='executing'`,[id,result.processing_state === "unknown" ? "unknown" : result.success ? "completed" : "failed"]); });
    return { ...result,plan_id:id };
  } catch (error) {
    await withScope(scope, async (client) => { await client.query(`UPDATE provider_data_request_plan SET state=CASE WHEN research_request_id IS NULL THEN 'failed' ELSE 'unknown' END,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND state='executing'`,[id]); }).catch(() => undefined);
    throw error;
  }
}

export async function readDataRequestResult(scope: Pick<ExternalDataScope,"tenantId" | "workspaceId">, id: string,
  fields: { offset?: number; limit?: number } = {}): Promise<JsonObject | null> {
  const plan = await withScope(scope, async (client) => (await client.query<{
    id: string; state: string; research_request_id: string | null; execution_started_at: Date | null;
  }>(`SELECT id,state,research_request_id,execution_started_at FROM provider_data_request_plan WHERE id=$1`,[id])).rows[0]);
  if (!plan) return null;
  if (plan.research_request_id) return { ...await loadCompactResearchResult(scope,plan.research_request_id,fields),plan_id:id };
  const started=plan.execution_started_at !== null;
  const stalled = plan.execution_started_at !== null && Date.now()-plan.execution_started_at.getTime()>300_000;
  return { success: plan.state === "executing" && !stalled, code: stalled ? 502 : plan.state === "executing" ? 202 : 409,
    plan_id:id,research_request_id:id,processing_state:plan.state,provider_completed:false,
    coverage: { providerCallsStarted:0,polling:{ action:stalled ? "reconcile" : plan.state === "executing" && started ? "poll_same_request" : "stop",retryAfterSeconds:!stalled && plan.state === "executing" && started ? 15 : null } },
    products:[],brands:[],properties:[],evidence:[],metrics:{},
    message:plan.state === "executing" ? "数据请求已进入执行流程，等待审批或调用准备，请查询同一编号。" : "数据计划尚未执行或已取消。" };
}
