import { database } from "./database.js";
import { listEnabledEndpoints } from "./endpoint-registry.js";
import type {
  ProviderBusinessWorkflow,
  ProviderBusinessWorkflowStep,
  WorkflowInputBinding,
  WorkflowOutputBinding,
} from "./business-workflows.js";
import type { JsonObject } from "./types.js";

type WorkflowRow = {
  workflow_id: string;
  business_tool: ProviderBusinessWorkflow["businessTool"];
  platform_id: string;
  display_name: string;
  sort_order: number;
  capability: string;
  workflow_version: string;
  input_schema: JsonObject;
  maximum_provider_calls: number;
  definition_sha256: string;
};

type StepRow = {
  workflow_id: string;
  step_id: string;
  step_order: number;
  role: ProviderBusinessWorkflowStep["role"];
  endpoint_id: string;
  input_bindings: Record<string, WorkflowInputBinding>;
  output_bindings: WorkflowOutputBinding[];
  required: boolean;
};

type MarketOptionRow = {
  workflow_id: string;
  market_code: string;
  display_name: string;
};

export async function listMarketplaceBusinessWorkflows(): Promise<ProviderBusinessWorkflow[]> {
  const workflowResult = await database.query<WorkflowRow>(`
    SELECT workflow_id, business_tool, platform_id, display_name, capability,
           workflow_version, input_schema, maximum_provider_calls, definition_sha256
    FROM provider_business_workflow
    WHERE provider = 'justoneapi' AND business_tool = 'research_marketplace_products'
      AND status = 'active'
    ORDER BY platform_id, workflow_id
  `);
  if (!workflowResult.rows.length) return [];
  const stepResult = await database.query<StepRow>(`
    SELECT workflow_id, step_id, step_order, role, endpoint_id,
           input_bindings, output_bindings, required
    FROM provider_business_workflow_step
    WHERE workflow_id = ANY($1::text[])
    ORDER BY workflow_id, step_order
  `, [workflowResult.rows.map((row) => row.workflow_id)]);
  const marketOptionResult = await database.query<MarketOptionRow>(`
    SELECT step.workflow_id,option.market_code,max(option.display_name) AS display_name,
           min(option.sort_order) AS sort_order
    FROM provider_business_workflow_step step
    CROSS JOIN LATERAL jsonb_each(step.input_bindings) binding
    JOIN provider_market_option option
      ON option.endpoint_id=step.endpoint_id AND option.parameter_name=binding.key
     AND option.enabled=true
    WHERE step.workflow_id=ANY($1::text[])
      AND binding.value->>'source'='business_input'
      AND binding.value->>'key'='market'
    GROUP BY step.workflow_id,option.market_code
    ORDER BY step.workflow_id,min(option.sort_order),option.market_code
  `, [workflowResult.rows.map((row) => row.workflow_id)]);
  const endpoints = new Map((await listEnabledEndpoints()).map((endpoint) => [endpoint.endpointId, endpoint]));
  return workflowResult.rows.map((workflow) => {
    const steps = stepResult.rows
      .filter((step) => step.workflow_id === workflow.workflow_id)
      .map((step) => {
        const endpoint = endpoints.get(step.endpoint_id);
        if (!endpoint) throw new WorkflowRegistryError(
          `Workflow ${workflow.workflow_id} references disabled endpoint ${step.endpoint_id}.`,
          "WORKFLOW_ENDPOINT_UNAVAILABLE",
        );
        return {
          stepId: step.step_id,
          stepOrder: step.step_order,
          role: step.role,
          endpoint,
          inputBindings: step.input_bindings,
          outputBindings: step.output_bindings,
          required: step.required,
        };
      });
    if (!steps.length || steps.length !== workflow.maximum_provider_calls) {
      throw new WorkflowRegistryError(
        `Workflow ${workflow.workflow_id} has an incomplete step catalog.`,
        "WORKFLOW_STEP_CATALOG_INVALID",
      );
    }
    return {
      workflowId: workflow.workflow_id,
      businessTool: workflow.business_tool,
      platformId: workflow.platform_id,
      displayName: workflow.display_name,
      capability: workflow.capability,
      workflowVersion: workflow.workflow_version,
      inputSchema: workflow.input_schema,
      maximumProviderCalls: workflow.maximum_provider_calls,
      definitionSha256: workflow.definition_sha256,
      marketOptions: marketOptionResult.rows
        .filter((option) => option.workflow_id === workflow.workflow_id)
        .map((option) => ({ code: option.market_code, displayName: option.display_name })),
      steps,
    };
  });
}

export async function getMarketplaceBusinessWorkflow(workflowId: string): Promise<ProviderBusinessWorkflow> {
  const workflow = (await listMarketplaceBusinessWorkflows()).find((candidate) => candidate.workflowId === workflowId);
  if (!workflow) throw new WorkflowRegistryError(`Unknown or disabled workflow ${workflowId}.`, "WORKFLOW_NOT_FOUND");
  return workflow;
}

export class WorkflowRegistryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "WorkflowRegistryError";
  }
}
