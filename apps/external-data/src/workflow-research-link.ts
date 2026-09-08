import type { PoolClient } from "pg";
import { sha256Json } from "./canonical.js";
import type { ExternalDataScope, JsonObject } from "./types.js";

/** Bind before provider admission so plan polling can see queued/retrying calls. */
export async function linkWorkflowResearch(
  client: Pick<PoolClient, "query">,
  scope: ExternalDataScope,
  researchRequestId: string,
  endpointId: string,
  params: JsonObject,
): Promise<void> {
  if (!scope.workflowExecutionId) return;
  if (!scope.workflowStepId) throw new Error("Workflow research requires an exact step identity.");
  const linked = await client.query(`
    UPDATE research_workflow_step_execution SET research_request_id=$1,updated_at=CURRENT_TIMESTAMP
    WHERE workflow_execution_id=$2 AND endpoint_id=$3 AND tenant_id=$4 AND workspace_id=$5
      AND state='running' AND parameter_sha256=$6
      AND (($7::uuid IS NOT NULL AND id=$7) OR ($7::uuid IS NULL AND step_id=$8 AND is_template=false))
      AND (research_request_id IS NULL OR research_request_id=$1)
    RETURNING id`, [researchRequestId,scope.workflowExecutionId,endpointId,scope.tenantId,scope.workspaceId,
    sha256Json(params),scope.workflowStepInstanceId ?? null,scope.workflowStepId]);
  if (linked.rowCount !== 1) throw new Error("Workflow step is already bound or does not match the prepared research request.");
}
