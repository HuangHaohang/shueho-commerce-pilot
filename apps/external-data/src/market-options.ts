import type { PoolClient } from "pg";

import { database } from "./database.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

type EndpointLike = Pick<ProviderEndpoint, "endpointId" | "platformId" | "schemaVersion" | "requestSchema" | "enabled">;

export type ProviderMarketOption = {
  endpointId: string;
  platformId: string;
  parameterName: string;
  marketCode: string;
  displayName: string;
  schemaVersion: string;
  sortOrder: number;
};

export type MarketplaceOptionCatalog = {
  platform: string;
  available: boolean;
  canonicalPlatform: string | null;
  platformLabel: string | null;
  requiresSelection: boolean;
  localizedKeywordRequired: boolean;
  options: Array<{ code: string; label: string }>;
  supportedPlatforms?: MarketplaceResearchPlatform[];
  suggestedPlatforms?: MarketplaceResearchPlatform[];
};

export type MarketplaceResearchPlatform = {
  platform: string;
  label: string;
  workflowId: string;
  capability: string;
  providerCalls: number;
  requiresSelection: boolean;
  localizedKeywordRequired: boolean;
};

export type MarketplaceResearchPlatformCatalog = {
  platforms: MarketplaceResearchPlatform[];
};

const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });

export function buildProviderMarketOptions(endpoints: EndpointLike[]): ProviderMarketOption[] {
  const options: ProviderMarketOption[] = [];
  for (const endpoint of endpoints) {
    if (!endpoint.enabled) continue;
    const properties = isRecord(endpoint.requestSchema.properties) ? endpoint.requestSchema.properties : {};
    for (const [parameterName, rawSchema] of Object.entries(properties)) {
      if (!/^(?:site|country|region|market)$/i.test(parameterName) || !isRecord(rawSchema) || !Array.isArray(rawSchema.enum)) continue;
      const codes = rawSchema.enum
        .filter((value): value is string => typeof value === "string" && /^[A-Z0-9_-]{2,32}$/.test(value))
        .map((value) => value.toUpperCase());
      if (codes.length < 2 || codes.length > 100) continue;
      for (const [sortOrder, marketCode] of [...new Set(codes)].entries()) {
        options.push({
          endpointId: endpoint.endpointId,
          platformId: endpoint.platformId,
          parameterName,
          marketCode,
          displayName: marketDisplayName(marketCode),
          schemaVersion: endpoint.schemaVersion,
          sortOrder,
        });
      }
    }
  }
  return options.sort((left, right) =>
    left.endpointId.localeCompare(right.endpointId) ||
    left.parameterName.localeCompare(right.parameterName) || left.sortOrder - right.sortOrder);
}

export async function syncProviderMarketOptions(
  client: Pick<PoolClient, "query">,
  sourceCatalogImportId: string,
  endpoints: EndpointLike[],
): Promise<{ optionCount: number; platformCount: number }> {
  const options = buildProviderMarketOptions(endpoints);
  if (options.length) {
    await client.query(`
      INSERT INTO provider_market_option (
        provider,endpoint_id,platform_id,parameter_name,market_code,
        display_name,locale,schema_version,sort_order,source_catalog_import_id,enabled
      )
      SELECT 'justoneapi',item.endpoint_id,item.platform_id,item.parameter_name,
             item.market_code,item.display_name,'zh-CN',item.schema_version,item.sort_order,$2,true
      FROM jsonb_to_recordset($1::jsonb) AS item(
        endpoint_id text,platform_id text,parameter_name text,market_code text,
        display_name text,schema_version text,sort_order integer
      )
      ON CONFLICT (endpoint_id,parameter_name,market_code) DO UPDATE SET
        platform_id=EXCLUDED.platform_id,display_name=EXCLUDED.display_name,
        schema_version=EXCLUDED.schema_version,sort_order=EXCLUDED.sort_order,
        source_catalog_import_id=EXCLUDED.source_catalog_import_id,
        enabled=true,updated_at=CURRENT_TIMESTAMP
    `, [JSON.stringify(options.map((option) => ({
      endpoint_id: option.endpointId,
      platform_id: option.platformId,
      parameter_name: option.parameterName,
      market_code: option.marketCode,
      display_name: option.displayName,
      schema_version: option.schemaVersion,
      sort_order: option.sortOrder,
    }))), sourceCatalogImportId]);
  }
  await client.query(`
    UPDATE provider_market_option SET enabled=false,updated_at=CURRENT_TIMESTAMP
    WHERE provider='justoneapi' AND source_catalog_import_id IS DISTINCT FROM $1
  `, [sourceCatalogImportId]);
  return {
    optionCount: options.length,
    platformCount: new Set(options.map((option) => option.platformId)).size,
  };
}

export async function readMarketplaceOptions(platform: string): Promise<MarketplaceOptionCatalog> {
  const platformId = platform.normalize("NFKC").trim().toLowerCase();
  const catalog = await readMarketplaceResearchPlatforms();
  const platformEntry = catalog.platforms.find((entry) => entry.platform === platformId);
  if (!platformEntry) {
    const suggestedPlatforms = catalog.platforms.filter((entry) =>
      entry.platform.startsWith(`${platformId}_`) || platformId.startsWith(`${entry.platform}_`));
    return {
      platform: platformId,
      available: false,
      canonicalPlatform: null,
      platformLabel: null,
      requiresSelection: false,
      localizedKeywordRequired: false,
      options: [],
      supportedPlatforms: catalog.platforms,
      suggestedPlatforms,
    };
  }
  const options = await database.query<{ market_code: string; display_name: string; sort_order: number }>(`
    SELECT option.market_code,max(option.display_name) AS display_name,
           min(option.sort_order) AS sort_order
    FROM provider_business_workflow_step step
    CROSS JOIN LATERAL jsonb_each(step.input_bindings) binding
    JOIN provider_market_option option
      ON option.endpoint_id=step.endpoint_id AND option.parameter_name=binding.key
     AND option.enabled=true
    JOIN provider_business_workflow workflow ON workflow.workflow_id=step.workflow_id
    WHERE workflow.platform_id=$1 AND workflow.status='active'
      AND binding.value->>'source'='business_input'
      AND binding.value->>'key'='market'
    GROUP BY option.market_code
    ORDER BY min(option.sort_order),option.market_code
  `, [platformId]);
  return {
    platform: platformId,
    available: true,
    canonicalPlatform: platformEntry.platform,
    platformLabel: platformEntry.label,
    requiresSelection: options.rows.length > 0,
    localizedKeywordRequired: options.rows.length > 0,
    options: options.rows.map((option) => ({ code: option.market_code, label: option.display_name })),
  };
}

export async function readMarketplaceResearchPlatforms(): Promise<MarketplaceResearchPlatformCatalog> {
  const workflows = await database.query<{
    workflow_id: string;
    platform_id: string;
    platform_name: string;
    capability: string;
    maximum_provider_calls: number;
    requires_selection: boolean;
  }>(`
    SELECT workflow.workflow_id,workflow.platform_id,
           COALESCE(
             (
               SELECT endpoint.platform_name
               FROM provider_business_workflow_step first_step
               JOIN provider_endpoint endpoint ON endpoint.endpoint_id=first_step.endpoint_id
               WHERE first_step.workflow_id=workflow.workflow_id
               ORDER BY first_step.step_order
               LIMIT 1
             ),
             workflow.display_name
           ) AS platform_name,
           workflow.capability,workflow.maximum_provider_calls,
           EXISTS (
             SELECT 1
             FROM provider_business_workflow_step step
             CROSS JOIN LATERAL jsonb_each(step.input_bindings) binding
             JOIN provider_market_option option
               ON option.endpoint_id=step.endpoint_id AND option.parameter_name=binding.key
              AND option.enabled=true
             WHERE step.workflow_id=workflow.workflow_id
               AND binding.value->>'source'='business_input'
               AND binding.value->>'key'='market'
           ) AS requires_selection
    FROM provider_business_workflow workflow
    WHERE workflow.provider='justoneapi'
      AND workflow.business_tool='research_marketplace_products'
      AND workflow.status='active'
    ORDER BY workflow.platform_id,workflow.workflow_id
  `);
  return {
    platforms: workflows.rows.map((workflow) => ({
      platform: workflow.platform_id,
      label: workflow.platform_name,
      workflowId: workflow.workflow_id,
      capability: workflow.capability,
      providerCalls: workflow.maximum_provider_calls,
      requiresSelection: workflow.requires_selection,
      localizedKeywordRequired: workflow.requires_selection,
    })),
  };
}

function marketDisplayName(code: string): string {
  let region: string | undefined;
  try {
    region = /^[A-Z]{2}$/.test(code) ? regionNames.of(code) : undefined;
  } catch {
    region = undefined;
  }
  return `${region && region !== code ? region : code}站`;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
