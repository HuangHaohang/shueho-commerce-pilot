import { createHash } from "node:crypto";

import { sha256Json } from "./canonical.js";
import { withScope } from "./database.js";
import { settleMarketplaceResearchPlan } from "./marketplace-research-plan-store.js";
import type { MarketplaceResearchPlan } from "./marketplace-research-planner.js";
import type {
  CompactResearchResult,
  ExternalDataScope,
  JsonObject,
} from "./types.js";
import { loadCompactResearchResult } from "./warehouse.js";

type WorkflowScope = Pick<ExternalDataScope, "tenantId" | "workspaceId">;

type ExecutionRow = {
  id: string;
  user_id: string;
  source: ExternalDataScope["source"];
  source_call_id: string;
  workflow_id: string;
  workflow_version: string;
  workflow_definition_sha256: string;
  plan_key: string;
  request_text: string;
  business_input: JsonObject;
  business_intent: JsonObject;
  plan_coverage: JsonObject;
  status: string;
  compact_result: JsonObject | null;
  research_plan_id: string | null;
  market_profile_id: string | null;
  created_at: Date;
};

type StepExecutionRow = {
  id: string;
  target_id: string | null;
  target_ordinal: number | null;
  step_instance_key: string;
  instance_order: number;
  is_template: boolean;
  step_id: string;
  step_order: number;
  role: "discovery" | "detail" | "price" | "reviews" | "sku";
  endpoint_id: string;
  research_request_id: string | null;
  state: string;
  provider_completed: boolean | null;
  processing_state: string | null;
  failure_code: string | null;
  failure_message: string | null;
};

type BindingCandidate = {
  sourceRecordType: "generic_source_record" | "taobao_search_item";
  sourceRecordId: string;
  sourceJsonPointer: string;
  rawData: unknown;
  relevanceScore: number;
  title: string;
  providerEntityId: string | null;
};

export type MarketplaceWorkflowStepInstance = {
  stepInstanceId: string;
  stepInstanceKey: string;
  targetId: string | null;
  targetOrdinal: number | null;
  stepId: string;
  stepOrder: number;
  instanceOrder: number;
  role: StepExecutionRow["role"];
  endpointId: string;
  bindings: Record<string, string | number>;
};

export async function beginMarketplaceWorkflowExecution(
  scope: ExternalDataScope,
  plan: MarketplaceResearchPlan,
  options: { researchPlanId?: string | null } = {},
): Promise<{ workflow_execution_id: string; status: string; step_instances: MarketplaceWorkflowStepInstance[] }> {
  if (scope.source === "archive_import") {
    throw new WorkflowExecutionError("Archive imports cannot start a paid business workflow.", "WORKFLOW_SOURCE_INVALID");
  }
  return withScope(scope, async (client) => {
    const inserted = await client.query<{ id: string; status: string }>(`
      INSERT INTO research_workflow_execution (
        tenant_id, workspace_id, user_id, source, source_call_id,
        root_thread_id, thread_id, turn_id, workflow_id, workflow_version,
        workflow_definition_sha256,plan_key,request_text,business_input,business_intent,plan_coverage,status
        ,research_plan_id,market_profile_id
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,'planned',$17,$18
      )
      ON CONFLICT (tenant_id, source, source_call_id) DO NOTHING
      RETURNING id, status
    `, [
      scope.tenantId, scope.workspaceId, scope.userId, scope.source, scope.sourceCallId,
      scope.rootThreadId ?? null, scope.threadId ?? null, scope.turnId ?? null,
      plan.workflow.workflowId, plan.workflow.workflowVersion, plan.workflow.definitionSha256,
      plan.planKey, scope.requestText,
      JSON.stringify(plan.businessInput), JSON.stringify(plan.businessIntent), JSON.stringify(plan.coverage),
      options.researchPlanId ?? null,plan.marketContext?.profileId ?? null,
    ]);
    let executionId = inserted.rows[0]?.id;
    let status = inserted.rows[0]?.status;
    if (!executionId) {
      const existing = await client.query<ExecutionRow>(`
        SELECT id,user_id,source,source_call_id,workflow_id,workflow_version,
               workflow_definition_sha256,plan_key,
               request_text,business_input,business_intent,plan_coverage,status,compact_result,
               research_plan_id,market_profile_id,created_at
        FROM research_workflow_execution
        WHERE tenant_id=$1 AND source=$2 AND source_call_id=$3 LIMIT 1
      `, [scope.tenantId, scope.source, scope.sourceCallId]);
      const row = existing.rows[0];
      if (
        !row || row.user_id !== scope.userId || row.workflow_id !== plan.workflow.workflowId ||
        row.workflow_version !== plan.workflow.workflowVersion ||
        row.workflow_definition_sha256 !== plan.workflow.definitionSha256 || row.plan_key !== plan.planKey ||
        row.request_text !== scope.requestText || row.research_plan_id !== (options.researchPlanId ?? null) ||
        row.market_profile_id !== (plan.marketContext?.profileId ?? null)
      ) {
        throw new WorkflowExecutionError(
          "Marketplace workflow source_call_id is already bound to another plan.",
          "WORKFLOW_IDEMPOTENCY_CONFLICT",
        );
      }
      executionId = row.id;
      status = row.status;
    }
    for (const step of plan.steps) {
      const definitionStep = plan.workflow.steps.find((candidate) => candidate.stepId === step.stepId);
      if (!definitionStep) throw new WorkflowExecutionError("Workflow step definition is missing.", "WORKFLOW_STEP_CATALOG_INVALID");
      await client.query(`
        INSERT INTO research_workflow_step_execution (
          tenant_id,workspace_id,workflow_execution_id,step_id,step_order,role,endpoint_id,
        input_bindings,output_bindings,state,step_instance_key,instance_order,is_template
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'planned',$10,$11,$12)
        ON CONFLICT (workflow_execution_id,step_instance_key) DO NOTHING
      `, [
        scope.tenantId,scope.workspaceId,executionId,step.stepId,step.stepOrder,step.role,
        step.endpoint.endpointId,JSON.stringify(definitionStep.inputBindings),JSON.stringify(step.outputBindings),
        options.researchPlanId && Object.keys(step.dynamicParameterBindings).length ? `template_${step.stepId}` : step.stepId,
        step.stepOrder,Boolean(options.researchPlanId && Object.keys(step.dynamicParameterBindings).length > 0),
      ]);
    }
    if (options.researchPlanId) {
      const linked = await client.query<{ id: string }>(`
        UPDATE marketplace_research_plan
        SET state='executing',workflow_execution_id=$2,updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND (
          state='ready' OR (state='executing' AND workflow_execution_id=$2)
        )
        RETURNING id
      `, [options.researchPlanId,executionId]);
      if (!linked.rows[0]) {
        throw new WorkflowExecutionError("Marketplace research plan is no longer executable.", "PLAN_NOT_READY");
      }
    }
    const stepInstances = await readExecutableStepInstances(client, executionId);
    return { workflow_execution_id: executionId, status: status ?? "planned", step_instances: stepInstances };
  });
}

export async function startMarketplaceWorkflowStep(
  scope: WorkflowScope,
  input: { executionId: string; stepId: string; stepInstanceId?: string | null; endpointId: string; params: JsonObject },
): Promise<void> {
  await withScope(scope, async (client) => {
    const result = await client.query<{ id: string }>(`
      UPDATE research_workflow_step_execution step
      SET state='running',parameter_sha256=$5,started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      FROM research_workflow_execution execution
      WHERE step.workflow_execution_id=execution.id
        AND execution.id=$1 AND step.endpoint_id=$3
        AND step.tenant_id=$4 AND step.workspace_id=$6
        AND (($7::uuid IS NOT NULL AND step.id=$7) OR ($7::uuid IS NULL AND step.step_id=$2 AND step.is_template=false))
        AND step.state IN ('planned','running')
      RETURNING step.id
    `, [input.executionId,input.stepId,input.endpointId,scope.tenantId,sha256Json(input.params),scope.workspaceId,input.stepInstanceId ?? null]);
    if (!result.rows[0]) throw new WorkflowExecutionError("Workflow step is unavailable or already terminal.", "WORKFLOW_STEP_STALE");
    await client.query(`
      UPDATE research_workflow_execution
      SET status='running',updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND status IN ('planned','running')
    `, [input.executionId]);
  });
}

export async function completeMarketplaceWorkflowStep(
  scope: WorkflowScope,
  input: {
    executionId: string;
    stepId: string;
    stepInstanceId?: string | null;
    endpointId: string;
    researchRequestId: string;
    providerCompleted: boolean;
    processingState: string;
    success: boolean;
    code: string | number | null;
    message: string | null;
  },
): Promise<void> {
  const state = input.success && input.processingState === "completed"
    ? "completed"
    : input.providerCompleted
      ? "processing_failed"
      : "business_failed";
  await withScope(scope, async (client) => {
    const result = await client.query<{ id: string }>(`
      UPDATE research_workflow_step_execution
      SET research_request_id=$5,state=$6,provider_completed=$7,processing_state=$8,
          failure_code=$9,failure_message=$10,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE workflow_execution_id=$1 AND endpoint_id=$3
        AND tenant_id=$4 AND workspace_id=$11 AND state IN ('running','processing_failed')
        AND (($12::uuid IS NOT NULL AND id=$12) OR ($12::uuid IS NULL AND step_id=$2 AND is_template=false))
      RETURNING id
    `, [
      input.executionId, input.stepId, input.endpointId, scope.tenantId,
      input.researchRequestId, state, input.providerCompleted, input.processingState,
      input.success ? null : String(input.code ?? "WORKFLOW_STEP_FAILED"),
      input.success ? null : input.message?.slice(0, 500) ?? "Workflow step failed.",
      scope.workspaceId,input.stepInstanceId ?? null,
    ]);
    if (!result.rows[0]) throw new WorkflowExecutionError("Workflow step completion is stale.", "WORKFLOW_STEP_STALE");
    if (input.providerCompleted) {
      await client.query(`
        INSERT INTO research_workflow_business_evidence (
          tenant_id,workspace_id,workflow_execution_id,workflow_step_execution_id,
          research_request_id,source_record_id,source_raw_call_id,role,evidence_kind,
          provider_entity_id,title,summary,canonical_url,metrics,quality_basis,
          relevance_score,confidence,source_json_pointer,observed_at
        )
        SELECT
          source.tenant_id,source.workspace_id,$1,step.id,$2,source.id,snapshot.raw_call_id,
          step.role,COALESCE(promoted.evidence_kind,source.record_kind),
          COALESCE(promoted.provider_entity_id,source.provider_entity_id),
          promoted.title,promoted.summary,promoted.canonical_url,source.metrics,
          CASE WHEN promoted.id IS NOT NULL THEN 'ai_promoted_text'
               ELSE 'deterministic_structured_metric' END,
          promoted.relevance_score,promoted.confidence,source.json_pointer,snapshot.observed_at
        FROM research_workflow_step_execution step
        JOIN generic_source_snapshot snapshot ON snapshot.research_request_id=$2
        JOIN generic_source_record source ON source.snapshot_id=snapshot.id
        LEFT JOIN business_evidence_observation promoted
          ON promoted.research_request_id=$2 AND promoted.source_record_id=source.id
        WHERE step.workflow_execution_id=$1 AND step.id=$5
          AND source.tenant_id=$3 AND source.workspace_id=$4
          AND (
            promoted.id IS NOT NULL
            OR (
              source.content_text IS NULL
              AND source.quality_status IN ('valid','suspicious')
              AND source.quality_reasons <@ ARRAY['INVALID_TEXT_TYPE','EMPTY_VALUE']::text[]
              AND source.metrics <> '{}'::jsonb
            )
          )
        ON CONFLICT (workflow_execution_id,workflow_step_execution_id,source_record_id,quality_basis)
        DO NOTHING
      `, [input.executionId,input.researchRequestId,scope.tenantId,scope.workspaceId,result.rows[0].id]);
    }
  });
}

export async function markMarketplaceWorkflowStepUnknown(
  scope: WorkflowScope,
  input: { executionId: string; stepId: string; stepInstanceId?: string | null; endpointId: string; message: string },
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE research_workflow_step_execution
      SET state='unknown',provider_completed=NULL,processing_state='unknown',
          failure_code='UPSTREAM_RESULT_UNKNOWN',failure_message=$5,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE workflow_execution_id=$1 AND endpoint_id=$3
        AND tenant_id=$4 AND workspace_id=$6 AND state='running'
        AND (($7::uuid IS NOT NULL AND id=$7) OR ($7::uuid IS NULL AND step_id=$2 AND is_template=false))
    `, [input.executionId,input.stepId,input.endpointId,scope.tenantId,input.message.slice(0,500),scope.workspaceId,input.stepInstanceId ?? null]);
    await client.query(`
      UPDATE research_workflow_execution
      SET status='unknown',failure_code='UPSTREAM_RESULT_UNKNOWN',failure_message=$2,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `, [input.executionId, input.message.slice(0, 500)]);
  });
}

export async function failMarketplaceWorkflowStep(
  scope: WorkflowScope,
  input: { executionId: string; stepId: string; stepInstanceId?: string | null; endpointId: string; code: string; message: string },
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE research_workflow_step_execution
      SET state='processing_failed',provider_completed=false,processing_state='failed',
          failure_code=$5,failure_message=$6,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE workflow_execution_id=$1 AND endpoint_id=$3
        AND tenant_id=$4 AND workspace_id=$7 AND state='running'
        AND (($8::uuid IS NOT NULL AND id=$8) OR ($8::uuid IS NULL AND step_id=$2 AND is_template=false))
    `, [
      input.executionId, input.stepId, input.endpointId, scope.tenantId,
      input.code.slice(0,100),input.message.slice(0,500),scope.workspaceId,input.stepInstanceId ?? null,
    ]);
  });
}

export async function resolveMarketplaceWorkflowBindings(
  scope: WorkflowScope,
  executionId: string,
): Promise<{
  bindings: Record<string, string | number>;
  targets: Array<{ target_id: string; target_ordinal: number; title: string; bindings: Record<string, string | number> }>;
  step_instances: MarketplaceWorkflowStepInstance[];
  source_research_request_id: string;
}> {
  return withScope(scope, async (client) => {
    const discovery = await client.query<{
      step_id: string;
      research_request_id: string;
      output_bindings: Array<{ name: string; aliases: string[]; value_type: "string" | "integer" }>;
    }>(`
      SELECT step.step_id,step.research_request_id,step.output_bindings
      FROM research_workflow_step_execution step
      JOIN research_workflow_execution execution ON execution.id=step.workflow_execution_id
      WHERE execution.id=$1 AND step.tenant_id=$2 AND step.workspace_id=$3
        AND step.role='discovery' AND step.state='completed' AND step.research_request_id IS NOT NULL
      LIMIT 1
    `, [executionId, scope.tenantId, scope.workspaceId]);
    const source = discovery.rows[0];
    if (!source?.output_bindings.length) {
      throw new WorkflowExecutionError(
        "商品搜索没有产生可验证的下游标识，详情调用未发送。",
        "WORKFLOW_BINDING_UNAVAILABLE",
      );
    }
    const existingTargets = await readWorkflowTargets(client, executionId);
    if (existingTargets.length) {
      return {
        bindings: existingTargets[0]?.bindings ?? {},
        targets: existingTargets,
        step_instances: await readExecutableStepInstances(client, executionId),
        source_research_request_id: source.research_request_id,
      };
    }
    const sampleSizeResult = await client.query<{ detail_sample_size: number; research_plan_id: string | null }>(`
      SELECT execution.research_plan_id,
             COALESCE(plan.detail_sample_size,(execution.business_input->>'detail_sample_size')::integer,1) AS detail_sample_size
      FROM research_workflow_execution execution
      LEFT JOIN marketplace_research_plan plan ON plan.id=execution.research_plan_id
      WHERE execution.id=$1 LIMIT 1
    `, [executionId]);
    const sampleSize = Math.max(1, Math.min(10, sampleSizeResult.rows[0]?.detail_sample_size ?? 1));
    const candidates = (await loadBindingCandidates(client, source.research_request_id))
      .map((candidate) => ({ candidate, values: extractBindings(candidate.rawData, source.output_bindings) }))
      .filter((entry): entry is { candidate: BindingCandidate; values: Record<string, string | number> } => entry.values !== null);
    if (sampleSizeResult.rows[0]?.research_plan_id === null) {
      const resolved = candidates[0];
      if (!resolved) {
        throw new WorkflowExecutionError(
          "质量通过的搜索结果中没有找到接口所需的商品标识，详情调用未发送。",
          "WORKFLOW_BINDING_UNAVAILABLE",
        );
      }
      for (const binding of source.output_bindings) {
        const resolvedValue = resolved.values[binding.name];
        const sourceField = findField(resolved.candidate.rawData, binding.aliases);
        if (resolvedValue === undefined || !sourceField) continue;
        const valueText = String(resolvedValue);
        const valueSha256 = createHash("sha256").update(valueText, "utf8").digest("hex");
        await client.query(`
          INSERT INTO research_workflow_binding_evidence (
            tenant_id,workspace_id,workflow_execution_id,source_step_id,
            source_research_request_id,source_record_type,source_record_id,
            source_json_pointer,source_field_name,binding_name,binding_value,binding_value_sha256,target_id
          )
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL
          WHERE NOT EXISTS (
            SELECT 1 FROM research_workflow_binding_evidence
            WHERE workflow_execution_id=$3 AND target_id IS NULL AND binding_name=$10
          )
        `, [
          scope.tenantId,scope.workspaceId,executionId,source.step_id,source.research_request_id,
          resolved.candidate.sourceRecordType,resolved.candidate.sourceRecordId,
          resolved.candidate.sourceJsonPointer,sourceField.key,binding.name,valueText,valueSha256,
        ]);
      }
      return {
        bindings: resolved.values,
        targets: [],
        step_instances: [],
        source_research_request_id: source.research_request_id,
      };
    }
    const resolvedTargets = selectDiversifiedBindingTargets(candidates, sampleSize);
    if (!resolvedTargets.length) {
      await client.query(`
        UPDATE research_workflow_step_execution
        SET state='cancelled',failure_code='WORKFLOW_BINDING_UNAVAILABLE',
            failure_message='没有质量通过且标识完整的代表商品。',completed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE workflow_execution_id=$1 AND is_template=true AND state='planned'
      `, [executionId]);
      throw new WorkflowExecutionError(
        "质量通过的搜索结果中没有找到接口所需的商品标识，详情调用未发送。",
        "WORKFLOW_BINDING_UNAVAILABLE",
      );
    }
    for (const [targetOrdinal, resolved] of resolvedTargets.entries()) {
      const titleFingerprint = createHash("sha256")
        .update(normalizeTitle(resolved.candidate.title), "utf8")
        .digest("hex");
      const targetInsert = await client.query<{ id: string }>(`
        INSERT INTO research_workflow_target (
          tenant_id,workspace_id,workflow_execution_id,target_ordinal,source_step_id,
          source_research_request_id,source_record_type,source_record_id,source_json_pointer,
          provider_entity_id,title,title_fingerprint,relevance_score,selection_score,
          selection_reason,binding_values
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
        RETURNING id
      `, [
        scope.tenantId,scope.workspaceId,executionId,targetOrdinal,source.step_id,
        source.research_request_id,resolved.candidate.sourceRecordType,resolved.candidate.sourceRecordId,
        resolved.candidate.sourceJsonPointer,resolved.candidate.providerEntityId,
        resolved.candidate.title.slice(0,1000),titleFingerprint,resolved.candidate.relevanceScore,
        resolved.selectionScore,resolved.selectionReason,JSON.stringify(resolved.values),
      ]);
      const targetId = targetInsert.rows[0]?.id;
      if (!targetId) throw new WorkflowExecutionError("Workflow target could not be recorded.", "WORKFLOW_TARGET_INSERT_FAILED");
      for (const binding of source.output_bindings) {
        const resolvedValue = resolved.values[binding.name];
        if (resolvedValue === undefined) continue;
        const sourceField = findField(resolved.candidate.rawData, binding.aliases);
        if (!sourceField) continue;
        const valueText = String(resolvedValue);
        const valueSha256 = createHash("sha256").update(valueText, "utf8").digest("hex");
        await client.query(`
        INSERT INTO research_workflow_binding_evidence (
          tenant_id,workspace_id,workflow_execution_id,source_step_id,
          source_research_request_id,source_record_type,source_record_id,
          source_json_pointer,source_field_name,binding_name,binding_value,binding_value_sha256,target_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (workflow_execution_id,target_id,binding_name) WHERE target_id IS NOT NULL DO NOTHING
      `, [
          scope.tenantId,scope.workspaceId,executionId,source.step_id,source.research_request_id,
          resolved.candidate.sourceRecordType,resolved.candidate.sourceRecordId,
          resolved.candidate.sourceJsonPointer,sourceField.key,binding.name,valueText,valueSha256,targetId,
        ]);
      }
      const templates = await client.query<{
        step_id: string; step_order: number; role: StepExecutionRow["role"]; endpoint_id: string;
        input_bindings: JsonObject; output_bindings: JsonObject[];
      }>(`
        SELECT step_id,step_order,role,endpoint_id,input_bindings,output_bindings
        FROM research_workflow_step_execution
        WHERE workflow_execution_id=$1 AND is_template=true
        ORDER BY step_order
      `, [executionId]);
      for (const [templateIndex, template] of templates.rows.entries()) {
        await client.query(`
          INSERT INTO research_workflow_step_execution (
            tenant_id,workspace_id,workflow_execution_id,step_id,step_order,role,endpoint_id,
            input_bindings,output_bindings,state,target_id,step_instance_key,instance_order,is_template
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,'planned',$10,$11,$12,false)
          ON CONFLICT (workflow_execution_id,step_instance_key) DO NOTHING
        `, [
          scope.tenantId,scope.workspaceId,executionId,template.step_id,template.step_order,
          template.role,template.endpoint_id,JSON.stringify(template.input_bindings),
          JSON.stringify(template.output_bindings),targetId,`${template.step_id}_${targetOrdinal}`,
          1 + targetOrdinal * templates.rows.length + templateIndex,
        ]);
      }
    }
    await client.query(`
      UPDATE research_workflow_step_execution
      SET state='skipped',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE workflow_execution_id=$1 AND is_template=true AND state='planned'
    `, [executionId]);
    const targets = await readWorkflowTargets(client, executionId);
    const executableInstances = await readExecutableStepInstances(client,executionId);
    await client.query(`
      UPDATE research_workflow_execution
      SET plan_coverage=plan_coverage || jsonb_build_object(
            'detailed_products_selected',$2::integer,
            'provider_calls_materialized',$3::integer
          ),updated_at=CURRENT_TIMESTAMP
      WHERE id=$1
    `,[executionId,targets.length,1 + executableInstances.length]);
    return {
      bindings: targets[0]?.bindings ?? {},
      targets,
      step_instances: executableInstances,
      source_research_request_id: source.research_request_id,
    };
  });
}

export async function cancelMarketplaceWorkflowExecution(
  scope: WorkflowScope,
  executionId: string,
  reason: string,
): Promise<void> {
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE research_workflow_step_execution
      SET state='cancelled',failure_code='WORKFLOW_CANCELLED',failure_message=$4,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE workflow_execution_id=$1 AND tenant_id=$2 AND workspace_id=$3 AND state='planned'
    `, [executionId, scope.tenantId, scope.workspaceId, reason.slice(0, 500)]);
    await client.query(`
      UPDATE research_workflow_execution
      SET status='cancelled',failure_code='WORKFLOW_CANCELLED',failure_message=$4,
          completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 AND status NOT IN ('completed','unknown')
    `, [executionId, scope.tenantId, scope.workspaceId, reason.slice(0, 500)]);
    await client.query(`
      UPDATE marketplace_research_plan plan
      SET state='cancelled',updated_at=CURRENT_TIMESTAMP
      FROM research_workflow_execution execution
      WHERE execution.id=$1 AND plan.id=execution.research_plan_id AND plan.state='executing'
    `, [executionId]);
  });
}

export async function completeMarketplaceWorkflowExecution(
  scope: WorkflowScope,
  executionId: string,
): Promise<CompactResearchResult & { workflow: JsonObject; research_request_ids: string[] }> {
  const execution = await readExecution(scope, executionId);
  const stepRows = await readSteps(scope, executionId);
  const executableStepRows = stepRows.filter((step) => !step.is_template);
  const unresolvedTemplateRows = stepRows.filter((step) =>
    step.is_template && step.state !== "skipped");
  const childResults: Array<{ step: StepExecutionRow; result: CompactResearchResult }> = [];
  for (const step of stepRows) {
    if (!step.research_request_id) continue;
    childResults.push({
      step,
      result: await loadCompactResearchResult(scope, step.research_request_id),
    });
  }
  const structuredEvidence = await readWorkflowBusinessEvidence(scope, executionId);
  const startedSteps = executableStepRows.filter((step) =>
    step.research_request_id !== null || !["planned", "cancelled"].includes(step.state));
  const failedSteps = executableStepRows.filter((step) => ["business_failed", "processing_failed", "unknown"].includes(step.state));
  const unexecutedSteps = executableStepRows.filter((step) => ["planned", "running", "cancelled"].includes(step.state));
  const incompleteSteps = executableStepRows.filter((step) => !["completed", "skipped"].includes(step.state));
  const completedSteps = executableStepRows.filter((step) => step.state === "completed");
  const status = execution.status === "cancelled" || execution.status === "unknown"
    ? execution.status
    : executableStepRows.length > 0 && completedSteps.length === executableStepRows.length && unresolvedTemplateRows.length === 0
      ? "completed"
      : completedSteps.length > 0
        ? "partial"
        : "failed";
  const evidence = dedupeRows([
    ...childResults.flatMap(({ step, result }) =>
      result.evidence.map((row) => ({
        ...row,workflow_role: step.role,workflow_target_ordinal: step.target_ordinal,
      }))),
    ...structuredEvidence,
  ]);
  const products = dedupeRows(childResults.flatMap(({ step, result }) =>
    result.products.map((row) => ({
      ...row,workflow_role: step.role,workflow_target_ordinal: step.target_ordinal,
    }))));
  const brands = dedupeRows(childResults.flatMap(({ result }) => result.brands));
  const properties = dedupeRows(childResults.flatMap(({ result }) => result.properties));
  const requestedMetrics = stringValues(execution.business_intent.requested_metrics);
  const availableMetrics = [...new Set(childResults.flatMap(({ result: child }) => [
    ...Object.keys(child.metrics),
    ...stringValues(child.coverage.availableMetrics),
  ]))].sort();
  const missingRequestedMetrics = requestedMetrics.filter((metric) => !availableMetrics.includes(metric));
  const observedAt = childResults.map(({ result }) => result.observed_at).sort().at(-1) ?? execution.created_at.toISOString();
  const result: CompactResearchResult & { workflow: JsonObject; research_request_ids: string[] } = {
    success: status === "completed",
    provider_completed: childResults.length > 0 && childResults.every(({ result: child }) => child.provider_completed),
    processing_state: status,
    code: status === "completed" ? 0 : status === "cancelled" ? 409 : status === "unknown" ? 502 : 422,
    message: status === "completed"
      ? "SHUEHO 已完成关键词发现、商品标识解析和下游详情工作流。"
      : status === "partial"
        ? "关键词商品研究仅部分完成；已保留成功步骤的数据，未自动重试失败或未执行的付费调用。"
        : status === "cancelled"
          ? "关键词商品研究已取消；未审批的后续调用没有发送。"
          : status === "unknown"
            ? "关键词商品研究存在结果不确定的上游调用，必须先完成对账。"
            : "关键词商品研究没有形成可用的完整结果。",
    research_request_id: execution.id,
    raw_archive_id: childResults[0]?.result.raw_archive_id ?? execution.id,
    endpoint_id: execution.workflow_id,
    query_key: execution.plan_key,
    observed_at: observedAt,
    coverage: {
      ...execution.plan_coverage,
      provider_calls_planned: executableStepRows.length,
      provider_calls_started: startedSteps.length,
      provider_calls_completed: completedSteps.length,
      failed_steps: failedSteps.map((step) => ({
        role: step.role,target_ordinal: step.target_ordinal,state: step.state,code: step.failure_code,
      })),
      unexecuted_steps: unexecutedSteps.map((step) => ({
        role: step.role,target_ordinal: step.target_ordinal,state: step.state,
      })),
      unresolved_step_templates: unresolvedTemplateRows.map((step) => ({
        role: step.role,state: step.state,code: step.failure_code,
      })),
      acceptedProducts: products.length,
      acceptedBrands: brands.length,
      acceptedProperties: properties.length,
      acceptedEvidence: evidence.length,
      requestedMetrics,
      availableMetrics,
      missingRequestedMetrics,
    },
    metrics: groupWorkflowChildValues(childResults,"metrics"),
    products,
    brands,
    properties,
    evidence,
    exclusions: groupWorkflowChildValues(childResults,"exclusions"),
    limitations: [...new Set([
      ...childResults.flatMap(({ result: child }) => child.limitations),
      ...incompleteSteps.map((step) => `${step.role}${step.target_ordinal === null ? "" : `（代表商品 ${step.target_ordinal + 1}）`}步骤状态为 ${step.state}${step.failure_message ? `：${step.failure_message}` : ""}。`),
      ...unresolvedTemplateRows.map((step) => `${step.role} 模板未物化，状态为 ${step.state}${step.failure_message ? `：${step.failure_message}` : ""}。`),
      "工作流只使用质量通过的搜索结果解析下游商品标识。",
    ])],
    workflow: {
      workflow_id: execution.workflow_id,
      workflow_version: execution.workflow_version,
      plan_key: execution.plan_key,
      status,
      steps: executableStepRows.map((step) => ({
        step_id: step.step_id,step_instance_key: step.step_instance_key,
        target_ordinal: step.target_ordinal,role: step.role,state: step.state,
      })),
    },
    research_request_ids: childResults.map(({ result: child }) => child.research_request_id),
  };
  await withScope(scope, async (client) => {
    await client.query(`
      UPDATE research_workflow_execution
      SET status=$4,compact_result=$5::jsonb,
          completed_at=CASE WHEN $4 IN ('completed','partial','failed','cancelled','unknown') THEN CURRENT_TIMESTAMP ELSE completed_at END,
          updated_at=CURRENT_TIMESTAMP
      WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3
    `, [executionId, scope.tenantId, scope.workspaceId, status, JSON.stringify(result)]);
  });
  await settleMarketplaceResearchPlan(
    scope,
    execution.research_plan_id,
    status === "unknown" ? "failed" : status,
  );
  return result;
}

export async function loadWorkflowOrResearchResult(
  scope: WorkflowScope,
  id: string,
): Promise<CompactResearchResult | (CompactResearchResult & { workflow: JsonObject; research_request_ids: string[] })> {
  const workflow = await withScope(scope, async (client) => client.query<{ compact_result: JsonObject | null }>(`
    SELECT compact_result FROM research_workflow_execution
    WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 LIMIT 1
  `, [id, scope.tenantId, scope.workspaceId]));
  if (workflow.rows[0]?.compact_result) {
    return workflow.rows[0].compact_result as CompactResearchResult & { workflow: JsonObject; research_request_ids: string[] };
  }
  if (workflow.rows[0]) return completeMarketplaceWorkflowExecution(scope, id);
  return loadCompactResearchResult(scope, id);
}

export class WorkflowExecutionError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "WorkflowExecutionError";
  }
}

async function readExecution(scope: WorkflowScope, id: string): Promise<ExecutionRow> {
  return withScope(scope, async (client) => {
    const result = await client.query<ExecutionRow>(`
      SELECT id,user_id,source,source_call_id,workflow_id,workflow_version,
             workflow_definition_sha256,plan_key,
             request_text,business_input,business_intent,plan_coverage,status,compact_result,
             research_plan_id,market_profile_id,created_at
      FROM research_workflow_execution
      WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 LIMIT 1
    `, [id, scope.tenantId, scope.workspaceId]);
    const row = result.rows[0];
    if (!row) throw new WorkflowExecutionError("Marketplace workflow execution was not found.", "WORKFLOW_EXECUTION_NOT_FOUND");
    return row;
  });
}

async function readSteps(scope: WorkflowScope, executionId: string): Promise<StepExecutionRow[]> {
  return withScope(scope, async (client) => {
    const result = await client.query<StepExecutionRow>(`
      SELECT step.id,step.target_id,target.target_ordinal,step.step_instance_key,
             step.instance_order,step.is_template,step.step_id,step.step_order,step.role,
             step.endpoint_id,step.research_request_id,step.state,step.provider_completed,
             step.processing_state,step.failure_code,step.failure_message
      FROM research_workflow_step_execution step
      LEFT JOIN research_workflow_target target ON target.id=step.target_id
      WHERE step.workflow_execution_id=$1 AND step.tenant_id=$2 AND step.workspace_id=$3
      ORDER BY step.instance_order,step.step_instance_key
    `, [executionId, scope.tenantId, scope.workspaceId]);
    return result.rows;
  });
}

async function readWorkflowBusinessEvidence(scope: WorkflowScope, executionId: string): Promise<JsonObject[]> {
  return withScope(scope, async (client) => {
    const result = await client.query<JsonObject>(`
      SELECT evidence.role AS workflow_role,target.target_ordinal AS workflow_target_ordinal,
             evidence.evidence_kind,evidence.provider_entity_id,evidence.title,evidence.summary,
             evidence.canonical_url,evidence.metrics,evidence.quality_basis,
             evidence.relevance_score,evidence.confidence,evidence.source_json_pointer,evidence.observed_at
      FROM research_workflow_business_evidence evidence
      JOIN research_workflow_step_execution step ON step.id=evidence.workflow_step_execution_id
      LEFT JOIN research_workflow_target target ON target.id=step.target_id
      WHERE evidence.workflow_execution_id=$1 AND evidence.tenant_id=$2 AND evidence.workspace_id=$3
        AND evidence.quality_basis='deterministic_structured_metric'
      ORDER BY evidence.role,target.target_ordinal,evidence.quality_basis,
               evidence.relevance_score DESC NULLS LAST,evidence.source_json_pointer
      LIMIT 200
    `, [executionId, scope.tenantId, scope.workspaceId]);
    return result.rows;
  });
}

async function loadBindingCandidates(
  client: { query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  researchRequestId: string,
): Promise<BindingCandidate[]> {
  const generic = await client.query<{
    source_record_id: string;
    source_json_pointer: string;
    raw_data: unknown;
    relevance_score: number;
    title: string;
    provider_entity_id: string | null;
  }>(`
    SELECT evidence.source_record_id,evidence.source_json_pointer,source.raw_data,evidence.relevance_score,
           COALESCE(evidence.title,source.title_raw,source.content_text,'') AS title,
           COALESCE(evidence.provider_entity_id,source.provider_entity_id) AS provider_entity_id
    FROM business_evidence_observation evidence
    JOIN generic_source_record source ON source.id=evidence.source_record_id
    JOIN ai_enrichment_result enrichment ON enrichment.id=evidence.enrichment_result_id
    WHERE evidence.research_request_id=$1 AND evidence.evidence_kind='product'
      AND enrichment.job_id=(
        SELECT id FROM ai_enrichment_job
        WHERE research_request_id=$1 AND state='completed'
        ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1
      )
    ORDER BY evidence.relevance_score DESC,source.ordinal NULLS LAST,source.json_pointer
    LIMIT 100
  `, [researchRequestId]);
  const taobao = await client.query<{
    source_record_id: string;
    source_json_pointer: string;
    raw_data: unknown;
    relevance_score: number;
    title: string;
    provider_entity_id: string | null;
  }>(`
    SELECT observation.source_item_id AS source_record_id,observation.source_json_pointer,
           item.raw_data,observation.relevance_score,COALESCE(item.item_name_raw,'') AS title,
           item.item_id AS provider_entity_id
    FROM business_product_observation observation
    JOIN taobao_search_item item ON item.id=observation.source_item_id
    JOIN ai_enrichment_result enrichment ON enrichment.id=observation.enrichment_result_id
    WHERE observation.research_request_id=$1
      AND enrichment.job_id=(
        SELECT id FROM ai_enrichment_job
        WHERE research_request_id=$1 AND state='completed'
        ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1
      )
    ORDER BY observation.relevance_score DESC,item.ordinal
    LIMIT 100
  `, [researchRequestId]);
  return [
    ...generic.rows.map((row) => ({
      sourceRecordType: "generic_source_record" as const,
      sourceRecordId: row.source_record_id,
      sourceJsonPointer: row.source_json_pointer,
      rawData: row.raw_data,
      relevanceScore: Number(row.relevance_score),
      title: row.title,
      providerEntityId: row.provider_entity_id,
    })),
    ...taobao.rows.map((row) => ({
      sourceRecordType: "taobao_search_item" as const,
      sourceRecordId: row.source_record_id,
      sourceJsonPointer: row.source_json_pointer,
      rawData: row.raw_data,
      relevanceScore: Number(row.relevance_score),
      title: row.title,
      providerEntityId: row.provider_entity_id,
    })),
  ].sort((left, right) => right.relevanceScore - left.relevanceScore);
}

async function readWorkflowTargets(
  client: { query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  executionId: string,
): Promise<Array<{ target_id: string; target_ordinal: number; title: string; bindings: Record<string, string | number> }>> {
  const result = await client.query<{
    id: string; target_ordinal: number; title: string | null; binding_values: Record<string, string | number>;
  }>(`
    SELECT id,target_ordinal,title,binding_values
    FROM research_workflow_target
    WHERE workflow_execution_id=$1
    ORDER BY target_ordinal
  `, [executionId]);
  return result.rows.map((row) => ({
    target_id: row.id,
    target_ordinal: row.target_ordinal,
    title: row.title ?? "",
    bindings: row.binding_values,
  }));
}

async function readExecutableStepInstances(
  client: { query: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  executionId: string,
): Promise<MarketplaceWorkflowStepInstance[]> {
  const result = await client.query<{
    id: string; step_instance_key: string; target_id: string | null; target_ordinal: number | null;
    step_id: string; step_order: number; instance_order: number; role: StepExecutionRow["role"];
    endpoint_id: string; binding_values: Record<string, string | number> | null;
  }>(`
    SELECT step.id,step.step_instance_key,step.target_id,target.target_ordinal,
           step.step_id,step.step_order,step.instance_order,step.role,step.endpoint_id,
           target.binding_values
    FROM research_workflow_step_execution step
    LEFT JOIN research_workflow_target target ON target.id=step.target_id
    WHERE step.workflow_execution_id=$1 AND step.is_template=false AND step.state='planned'
    ORDER BY step.instance_order,step.step_instance_key
  `, [executionId]);
  return result.rows.map((row) => ({
    stepInstanceId: row.id,
    stepInstanceKey: row.step_instance_key,
    targetId: row.target_id,
    targetOrdinal: row.target_ordinal,
    stepId: row.step_id,
    stepOrder: row.step_order,
    instanceOrder: row.instance_order,
    role: row.role,
    endpointId: row.endpoint_id,
    bindings: row.binding_values ?? {},
  }));
}

function selectDiversifiedBindingTargets(
  entries: Array<{ candidate: BindingCandidate; values: Record<string, string | number> }>,
  limit: number,
): Array<{
  candidate: BindingCandidate;
  values: Record<string, string | number>;
  selectionScore: number;
  selectionReason: string;
}> {
  const unique = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    const key = sha256Json(entry.values);
    if (!unique.has(key)) unique.set(key, entry);
  }
  const remaining = [...unique.values()];
  const selected: Array<{
    candidate: BindingCandidate;
    values: Record<string, string | number>;
    selectionScore: number;
    selectionReason: string;
  }> = [];
  while (remaining.length && selected.length < limit) {
    const scored = remaining.map((entry) => {
      const similarity = selected.length
        ? Math.max(...selected.map((chosen) => titleSimilarity(entry.candidate.title, chosen.candidate.title)))
        : 0;
      const sameShop = selected.some((chosen) =>
        entry.values.shop_id !== undefined && entry.values.shop_id === chosen.values.shop_id);
      const diversity = Math.max(0, 1 - similarity - (sameShop ? 0.2 : 0));
      const selectionScore = Math.min(1, Math.max(0, entry.candidate.relevanceScore * 0.8 + diversity * 0.2));
      return {
        entry,
        selectionScore,
        selectionReason: selected.length === 0
          ? "highest_relevance"
          : sameShop ? "relevance_with_shop_diversity_penalty" : "relevance_title_diversity",
      };
    }).sort((left, right) =>
      right.selectionScore - left.selectionScore ||
      right.entry.candidate.relevanceScore - left.entry.candidate.relevanceScore ||
      left.entry.candidate.sourceJsonPointer.localeCompare(right.entry.candidate.sourceJsonPointer));
    const winner = scored[0];
    if (!winner) break;
    selected.push({ candidate: winner.entry.candidate, values: winner.entry.values,
      selectionScore: winner.selectionScore, selectionReason: winner.selectionReason });
    remaining.splice(remaining.indexOf(winner.entry), 1);
  }
  return selected;
}

function titleSimilarity(left: string, right: string): number {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

function titleTokens(value: string): Set<string> {
  const normalized = normalizeTitle(value);
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const characters = [...normalized.replace(/[^\p{L}\p{N}]+/gu, "")];
  for (let index = 0; index < characters.length - 1; index += 1) {
    tokens.add(`${characters[index]}${characters[index + 1]}`);
  }
  return tokens;
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/g, " ").trim();
}

export function extractBindings(
  rawData: unknown,
  bindings: Array<{ name: string; aliases: string[]; value_type: "string" | "integer" }>,
): Record<string, string | number> | null {
  const output: Record<string, string | number> = {};
  for (const binding of bindings) {
    const field = findField(rawData, binding.aliases);
    if (!field) return null;
    const normalized = normalizeBindingValue(field.value, binding.value_type);
    if (normalized === null) return null;
    output[binding.name] = normalized;
  }
  return output;
}

function findField(value: unknown, aliases: string[], depth = 0): { key: string; value: unknown } | null {
  if (!isRecord(value) || depth > 5) return null;
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const [key, child] of Object.entries(value)) {
    if (normalizedAliases.has(key.toLowerCase()) && child !== null && child !== undefined && child !== "") {
      return { key, value: child };
    }
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) continue;
    const nested = findField(child, aliases, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function normalizeBindingValue(value: unknown, valueType: "string" | "integer"): string | number | null {
  if (valueType === "integer") {
    const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return normalized && normalized.length <= 500 && /^[A-Za-z0-9._:-]+$/.test(normalized) ? normalized : null;
}

function dedupeRows(rows: JsonObject[]): JsonObject[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = sha256Json(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function groupWorkflowChildValues(
  rows: Array<{ step: StepExecutionRow; result: CompactResearchResult }>,
  key: "metrics" | "exclusions",
): JsonObject {
  const grouped: Record<string, JsonObject[]> = {};
  for (const { step,result } of rows) {
    const values = grouped[step.role] ?? [];
    values.push({
      targetOrdinal: step.target_ordinal,
      stepInstanceKey: step.step_instance_key,
      value: result[key],
    });
    grouped[step.role] = values;
  }
  return grouped;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
