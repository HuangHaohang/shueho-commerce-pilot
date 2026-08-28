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
  source_catalog_import_id: string;
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
  profile_id: string;
  profile_revision: string;
  preferred_query_locale: string;
  query_locales: string[];
  accepted_query_languages: string[];
  timezone: string;
  currency: string;
  keyword_localization_policy: "none" | "agent_generated_validated";
  script_policy: JsonObject;
  quality_policy: JsonObject;
};

export async function listMarketplaceBusinessWorkflows(): Promise<ProviderBusinessWorkflow[]> {
  const workflowResult = await database.query<WorkflowRow>(`
    SELECT workflow.workflow_id,workflow.business_tool,workflow.platform_id,
           workflow.display_name,workflow.capability,workflow.workflow_version,
           workflow.input_schema,workflow.maximum_provider_calls,workflow.definition_sha256,
           receipt.source_catalog_import_id
    FROM provider_business_workflow workflow
    JOIN provider_business_workflow_import_receipt receipt
      ON receipt.id=workflow.source_workflow_import_id
    WHERE workflow.provider = 'justoneapi' AND workflow.business_tool = 'research_marketplace_products'
      AND workflow.status = 'active'
    ORDER BY workflow.platform_id,workflow.workflow_id
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
    SELECT DISTINCT ON (step.workflow_id,option.market_code)
           step.workflow_id,option.market_code,option.display_name,
           profile.id::text AS profile_id,profile.definition_sha256 AS profile_revision,
           profile.preferred_query_locale,profile.query_locales,
           profile.accepted_query_languages,profile.timezone,profile.currency,
           profile.keyword_localization_policy,profile.script_policy,profile.quality_policy,
           option.sort_order
    FROM provider_business_workflow_step step
    CROSS JOIN LATERAL jsonb_each(step.input_bindings) binding
    JOIN provider_market_option option
      ON option.endpoint_id=step.endpoint_id AND option.parameter_name=binding.key
     AND option.enabled=true AND option.localization_ready=true
    JOIN provider_market_profile profile
      ON profile.id=option.market_profile_id AND profile.enabled=true
    WHERE step.workflow_id=ANY($1::text[])
      AND binding.value->>'source'='business_input'
      AND binding.value->>'key'='market'
    ORDER BY step.workflow_id,option.market_code,option.sort_order
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
      sourceCatalogImportId: workflow.source_catalog_import_id,
      marketOptions: marketOptionResult.rows
        .filter((option) => option.workflow_id === workflow.workflow_id)
        .map((option) => ({
          code: option.market_code,
          displayName: option.display_name,
          profileId: option.profile_id,
          profileRevision: option.profile_revision,
          preferredQueryLocale: option.preferred_query_locale,
          queryLocales: option.query_locales,
          acceptedQueryLanguages: option.accepted_query_languages,
          timezone: option.timezone,
          currency: option.currency,
          keywordLocalizationPolicy: option.keyword_localization_policy,
          expectedScripts: stringArray(option.script_policy.expectedScripts),
          qualityPolicy: option.quality_policy,
        })),
      steps,
    };
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
