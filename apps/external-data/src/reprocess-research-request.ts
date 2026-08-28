import "dotenv/config";

import { Client } from "pg";

import { config } from "./config.js";
import { database } from "./database.js";
import {
  completeMarketplaceWorkflowExecution,
  completeMarketplaceWorkflowStep,
  resolveMarketplaceWorkflowBindings,
} from "./marketplace-workflow-execution.js";
import { ExternalDataPipeline } from "./pipeline.js";
import type { ExternalDataBusinessIntent, ExternalDataScope, JsonObject } from "./types.js";

const researchRequestId = readArgument("research-request-id");
const forceEnrichment = process.argv.includes("--force-enrichment");
const localizedKeyword = readArgument("localized-keyword");
if (localizedKeyword !== null && (!localizedKeyword.trim() || localizedKeyword.length > 500)) {
  throw new Error("--localized-keyword must contain between 1 and 500 characters.");
}
if (!researchRequestId || !/^[a-f0-9-]{36}$/.test(researchRequestId)) {
  throw new Error("--research-request-id=<uuid> is required.");
}
if (!config.migrationDatabaseUrl) throw new Error("EXTERNAL_DATA_MIGRATION_DATABASE_URL is required.");

const owner = new Client({
  connectionString: config.migrationDatabaseUrl,
  application_name: "external-data-reprocess-reader",
});
await owner.connect();
const stored = await owner.query<{
  tenant_id: string;
  workspace_id: string;
  user_id: string;
  source: ExternalDataScope["source"];
  source_call_id: string;
  root_thread_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  request_text: string;
  structured_intent: JsonObject;
  top_n: number;
  endpoint_id: string;
  requested_params: JsonObject;
  workflow_execution_id: string | null;
  workflow_step_id: string | null;
  workflow_step_instance_id: string | null;
  workflow_target_id: string | null;
  workflow_step_role: ExternalDataBusinessIntent["workflowStepRole"];
  workflow_step_state: string | null;
  workflow_plan_key: string | null;
}>(`
  SELECT request.tenant_id,request.workspace_id,request.user_id,request.source,
         request.source_call_id,request.root_thread_id,request.thread_id,request.turn_id,
         request.request_text,request.structured_intent,request.top_n,
         query.endpoint_id,query.requested_params,
         step.workflow_execution_id,step.step_id AS workflow_step_id,
         step.id AS workflow_step_instance_id,step.target_id AS workflow_target_id,
         step.role AS workflow_step_role,step.state AS workflow_step_state,
         execution.plan_key AS workflow_plan_key
  FROM research_request request
  JOIN external_query query ON query.research_request_id=request.id
  LEFT JOIN research_workflow_step_execution step ON step.research_request_id=request.id
  LEFT JOIN research_workflow_execution execution ON execution.id=step.workflow_execution_id
  WHERE request.id=$1
  LIMIT 1
`, [researchRequestId]);
await owner.end();

const row = stored.rows[0];
if (!row) throw new Error("Stored research request was not found.");
const scope: ExternalDataScope = {
  tenantId: row.tenant_id,
  workspaceId: row.workspace_id,
  userId: row.user_id,
  source: row.source,
  sourceCallId: row.source_call_id,
  rootThreadId: row.root_thread_id,
  threadId: row.thread_id,
  turnId: row.turn_id,
  requestText: row.request_text,
  topN: row.top_n,
  businessIntent: toBusinessIntent(row.structured_intent, row),
  workflowExecutionId: row.workflow_execution_id,
  workflowStepId: row.workflow_step_id,
  workflowStepInstanceId: row.workflow_step_instance_id,
  workflowTargetId: row.workflow_target_id,
  enrichmentQueryTerms: localizedKeyword ? [localizedKeyword.normalize("NFKC").trim()] : [],
};

try {
  const pipeline = new ExternalDataPipeline();
  const result = forceEnrichment
    ? await pipeline.reprocessEnrichment(scope, row.endpoint_id, row.requested_params)
    : await pipeline.resumeStored(scope, row.endpoint_id, row.requested_params);
  let workflowResult: Awaited<ReturnType<typeof completeMarketplaceWorkflowExecution>> | null = null;
  if (row.workflow_execution_id && row.workflow_step_id && row.workflow_step_role) {
    if (row.workflow_step_state !== "completed") {
      await completeMarketplaceWorkflowStep(scope, {
        executionId: row.workflow_execution_id,
        stepId: row.workflow_step_id,
        stepInstanceId: row.workflow_step_instance_id,
        endpointId: row.endpoint_id,
        researchRequestId: result.research_request_id,
        providerCompleted: result.provider_completed,
        processingState: result.processing_state,
        success: result.success,
        code: result.code,
        message: result.message,
      });
    }
    if (row.workflow_step_role === "discovery" && result.success) {
      await resolveMarketplaceWorkflowBindings(scope, row.workflow_execution_id);
    }
    workflowResult = await completeMarketplaceWorkflowExecution(scope, row.workflow_execution_id);
  }
  console.log(JSON.stringify({
    repaired: result.success,
    repairMode: forceEnrichment ? "enrichment" : "resume",
    localizedKeywordApplied: localizedKeyword !== null,
    providerDispatched: false,
    researchRequestId: result.research_request_id,
    processingState: result.processing_state,
    acceptedProducts: numberValue(result.coverage.acceptedProducts),
    acceptedEvidence: numberValue(result.coverage.acceptedEvidence),
    heldEvidence: numberValue(result.coverage.held),
    rejectedEvidence: numberValue(result.coverage.rejected),
    workflowExecutionId: row.workflow_execution_id,
    workflowState: workflowResult?.processing_state ?? null,
    workflowAcceptedEvidence: numberValue(workflowResult?.coverage.acceptedEvidence),
  }, null, 2));
} finally {
  await database.end();
}

function toBusinessIntent(
  intent: JsonObject,
  workflow: {
    workflow_step_id: string | null;
    workflow_step_role: ExternalDataBusinessIntent["workflowStepRole"];
    workflow_plan_key: string | null;
  },
): ExternalDataBusinessIntent {
  return {
    kind: "stored_research_reprocessing",
    platform: typeof intent.platform === "string" ? intent.platform : "unknown",
    targetProduct: typeof intent.targetProduct === "string" ? intent.targetProduct : null,
    objective: typeof intent.objective === "string" ? intent.objective : null,
    requestedMetrics: stringArray(intent.metrics),
    timeRange: isRecord(intent.timeRange) ? {
      start: String(intent.timeRange.start),
      end: String(intent.timeRange.end),
      startDate: String(intent.timeRange.startDate),
      endDate: String(intent.timeRange.endDate),
      timezone: String(intent.timeRange.timezone),
    } : null,
    windowEnforcement: typeof intent.windowEnforcement === "string" ? intent.windowEnforcement : null,
    requestedTopN: typeof intent.requestedTopN === "number" ? intent.requestedTopN : null,
    workflowPlanKey: workflow.workflow_plan_key,
    workflowStepId: workflow.workflow_step_id,
    workflowStepRole: workflow.workflow_step_role,
    localizedKeyword: typeof intent.localizedKeyword === "string" ? intent.localizedKeyword : null,
    localizedKeywords: stringArray(intent.localizedKeywords),
    marketContext: isRecord(intent.marketContext) ? intent.marketContext : null,
    qualityPolicy: isRecord(intent.qualityPolicy) ? intent.qualityPolicy : null,
  };
}

function readArgument(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
