import type { PoolClient } from "pg";

import { catalogSha256 } from "./catalog-import.js";
import type { JsonObject, ProviderEndpoint } from "./types.js";

export type WorkflowInputBinding =
  | { source: "business_input"; key: string; omit_if_null?: boolean }
  | { source: "resolved_binding"; key: string }
  | { source: "literal"; value: unknown };

export type WorkflowOutputBinding = {
  name: string;
  aliases: string[];
  value_type: "string" | "integer";
};

export type ProviderBusinessWorkflowStep = {
  stepId: string;
  stepOrder: number;
  role: "discovery" | "detail" | "price" | "reviews" | "sku";
  endpoint: ProviderEndpoint;
  inputBindings: Record<string, WorkflowInputBinding>;
  outputBindings: WorkflowOutputBinding[];
  required: boolean;
};

export type ProviderBusinessWorkflow = {
  workflowId: string;
  businessTool: "research_marketplace_products";
  platformId: string;
  displayName: string;
  capability: string;
  workflowVersion: string;
  inputSchema: JsonObject;
  maximumProviderCalls: number;
  definitionSha256: string;
  sourceCatalogImportId: string;
  marketOptions: ProviderWorkflowMarketOption[];
  steps: ProviderBusinessWorkflowStep[];
};

export type ProviderWorkflowMarketOption = {
  code: string;
  displayName: string;
  profileId: string;
  profileRevision: string;
  preferredQueryLocale: string;
  queryLocales: string[];
  acceptedQueryLanguages: string[];
  timezone: string;
  currency: string;
  keywordLocalizationPolicy: "none" | "agent_generated_validated";
  expectedScripts: string[];
  qualityPolicy: JsonObject;
};

type EndpointLike = Pick<ProviderEndpoint, "endpointId" | "platformId" | "enabled" | "requestSchema">;

type WorkflowSpec = {
  workflowId: string;
  platformId: string;
  displayName: string;
  capability: string;
  steps: Array<{
    stepId: string;
    role: ProviderBusinessWorkflowStep["role"];
    endpointId: string;
    inputBindings: Record<string, WorkflowInputBinding>;
    outputBindings?: WorkflowOutputBinding[];
  }>;
};

const itemIdAliases = ["itemId", "item_id", "productId", "product_id", "skuId", "sku_id"];

const workflowSpecs: WorkflowSpec[] = [
  {
    workflowId: "jd.products_by_keyword_v1",
    platformId: "jd",
    displayName: "京东关键词商品详情",
    capability: "按关键词发现京东商品，再对质量通过且去重后的代表性商品读取详情与实时价格。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "jd.search_item_list_v2",
        inputBindings: { keyword: business("effective_keyword") },
        outputBindings: [output("item_id", [...itemIdAliases, "wareId", "ware_id"], "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "jd.get_item_detail_v3",
        inputBindings: { itemId: resolved("item_id") },
      },
      {
        stepId: "price",
        role: "price",
        endpointId: "jd.get_item_price_v1",
        inputBindings: { itemId: resolved("item_id") },
      },
    ],
  },
  {
    workflowId: "taobao.products_by_keyword_v1",
    platformId: "taobao",
    displayName: "淘宝天猫关键词商品详情",
    capability: "按关键词和业务筛选发现淘宝或天猫商品，再对质量通过且去重后的代表性商品读取详情与评价。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "taobao.search_item_list_v1",
        inputBindings: {
          keyword: business("effective_keyword"),
          tmall: business("tmall_only"),
          startPrice: business("min_price_yuan", true),
          endPrice: business("max_price_yuan", true),
        },
        outputBindings: [output("item_id", itemIdAliases, "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "taobao.get_item_detail_v9",
        inputBindings: { itemId: resolved("item_id") },
      },
      {
        stepId: "reviews",
        role: "reviews",
        endpointId: "taobao.get_item_comment_v3",
        inputBindings: { itemId: resolved("item_id") },
      },
    ],
  },
  {
    workflowId: "1688.products_by_keyword_v1",
    platformId: "1688",
    displayName: "1688关键词商品详情",
    capability: "按关键词发现 1688 商品，再对质量通过且去重后的代表性商品读取详情。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "1688.search_item_list_v1",
        inputBindings: { keyword: business("effective_keyword") },
        outputBindings: [output("item_id", itemIdAliases, "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "1688.get_item_detail_v1",
        inputBindings: { itemId: resolved("item_id") },
      },
    ],
  },
  {
    workflowId: "amazon.products_by_keyword_v1",
    platformId: "amazon",
    displayName: "亚马逊关键词商品详情",
    capability: "按关键词和市场站点发现亚马逊商品，再对质量通过且去重后的代表性商品读取详情与热门评价。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "amazon.search_products_v1",
        inputBindings: { keyword: business("effective_keyword"), country: business("market", true) },
        outputBindings: [output("item_id", ["asin", "ASIN"], "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "amazon.get_product_detail_v1",
        inputBindings: { asin: resolved("item_id"), country: business("market", true) },
      },
      {
        stepId: "reviews",
        role: "reviews",
        endpointId: "amazon.get_product_top_reviews_v1",
        inputBindings: { asin: resolved("item_id"), country: business("market", true) },
      },
    ],
  },
  {
    workflowId: "douyin_ec.products_by_keyword_v1",
    platformId: "douyin_ec",
    displayName: "抖音电商关键词商品详情",
    capability: "按关键词发现抖音电商商品，再对质量通过且去重后的代表性商品读取详情与 SKU。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "douyin_ec.search_item_list_v1",
        inputBindings: { keyword: business("effective_keyword") },
        outputBindings: [output("item_id", itemIdAliases, "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "douyin_ec.get_item_detail_v2",
        inputBindings: { itemId: resolved("item_id") },
      },
      {
        stepId: "sku",
        role: "sku",
        endpointId: "douyin_ec.get_item_sku_info_v2",
        inputBindings: { itemId: resolved("item_id") },
      },
    ],
  },
  {
    workflowId: "tiktok_shop.products_by_keyword_v1",
    platformId: "tiktok_shop",
    displayName: "TikTok Shop关键词商品详情",
    capability: "按关键词和市场站点发现 TikTok Shop 商品，再对质量通过且去重后的代表性商品读取详情。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "tiktok_shop.search_products_v1",
        inputBindings: { keyword: business("effective_keyword"), region: business("market", true) },
        outputBindings: [output("item_id", ["productId", "product_id", "itemId", "item_id"], "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "tiktok_shop.get_product_detail_v1",
        inputBindings: { productId: resolved("item_id"), region: business("market", true) },
      },
    ],
  },
  {
    workflowId: "shopee.products_by_keyword_v1",
    platformId: "shopee",
    displayName: "Shopee关键词商品详情",
    capability: "按关键词和市场站点发现 Shopee 商品，再对质量通过且去重后的代表性商品读取详情与评价。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "shopee.search_item_list_v1",
        inputBindings: { keyword: business("effective_keyword"), site: business("market") },
        outputBindings: [
          output("item_id", ["itemId", "item_id", "itemid"], "integer"),
          output("shop_id", ["shopId", "shop_id", "shopid"], "integer"),
        ],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "shopee.get_item_detail_v2",
        inputBindings: {
          itemId: resolved("item_id"),
          shopId: resolved("shop_id"),
          site: business("market"),
        },
      },
      {
        stepId: "reviews",
        role: "reviews",
        endpointId: "shopee.get_item_reviews_v1",
        inputBindings: {
          itemId: resolved("item_id"),
          shopId: resolved("shop_id"),
          site: business("market"),
        },
      },
    ],
  },
  {
    workflowId: "xianyu.products_by_keyword_v1",
    platformId: "xianyu",
    displayName: "闲鱼关键词商品详情",
    capability: "按关键词发现闲鱼商品，再对质量通过且去重后的代表性商品读取详情。",
    steps: [
      {
        stepId: "discover",
        role: "discovery",
        endpointId: "xianyu.search_item_list_v1",
        inputBindings: { keyword: business("effective_keyword") },
        outputBindings: [output("item_id", itemIdAliases, "string")],
      },
      {
        stepId: "detail",
        role: "detail",
        endpointId: "xianyu.get_item_detail_v1",
        inputBindings: { itemId: resolved("item_id") },
      },
    ],
  },
];

const workflowInputSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["platform", "keyword", "localized_keyword", "localized_keywords", "tmall_only", "min_price_yuan", "max_price_yuan", "requested_metrics", "max_results", "detail_sample_size"],
  properties: {
    platform: { type: "string" },
    keyword: { type: "string", minLength: 1, maxLength: 500 },
    localized_keyword: { type: ["string", "null"], maxLength: 500 },
    localized_keywords: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 8 },
    market: { type: ["string", "null"] },
    tmall_only: { type: "boolean" },
    min_price_yuan: { type: ["number", "null"], minimum: 0 },
    max_price_yuan: { type: ["number", "null"], minimum: 0 },
    requested_metrics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
    max_results: { type: "integer", minimum: 1, maximum: 100 },
    detail_sample_size: { type: "integer", minimum: 1, maximum: 10 },
  },
};

export function buildCuratedMarketplaceWorkflows<T extends EndpointLike>(endpoints: T[]): Array<{
  workflowId: string;
  businessTool: "research_marketplace_products";
  platformId: string;
  displayName: string;
  capability: string;
  workflowVersion: string;
  inputSchema: JsonObject;
  maximumProviderCalls: number;
  definitionSha256: string;
  steps: Array<{
    stepId: string;
    stepOrder: number;
    role: ProviderBusinessWorkflowStep["role"];
    endpointId: string;
    inputBindings: Record<string, WorkflowInputBinding>;
    outputBindings: WorkflowOutputBinding[];
    required: boolean;
  }>;
}> {
  const endpointMap = new Map(endpoints.map((endpoint) => [endpoint.endpointId, endpoint]));
  return workflowSpecs.flatMap((spec) => {
    const resolved = spec.steps.map((step, stepOrder) => ({ ...step, stepOrder, endpoint: endpointMap.get(step.endpointId) }));
    if (resolved.some((step) => !step.endpoint?.enabled || step.endpoint.platformId !== spec.platformId)) return [];
    for (const step of resolved) {
      const properties = schemaProperties(step.endpoint!.requestSchema);
      for (const parameter of Object.keys(step.inputBindings)) {
        if (!(parameter in properties)) throw new Error(`${spec.workflowId}.${step.stepId} references unknown parameter ${parameter}.`);
      }
      const required = stringArray(step.endpoint!.requestSchema.required);
      for (const parameter of required) {
        if (!(parameter in step.inputBindings)) throw new Error(`${spec.workflowId}.${step.stepId} does not bind required parameter ${parameter}.`);
      }
    }
    const workflowVersion = "2.0.0";
    const steps = resolved.map((step) => ({
      stepId: step.stepId,
      stepOrder: step.stepOrder,
      role: step.role,
      endpointId: step.endpointId,
      inputBindings: step.inputBindings,
      outputBindings: step.outputBindings ?? [],
      required: true,
    }));
    const definitionSha256 = catalogSha256({
      workflowId: spec.workflowId,
      workflowVersion,
      platformId: spec.platformId,
      inputSchema: workflowInputSchema,
      steps,
    });
    return [{
      workflowId: spec.workflowId,
      businessTool: "research_marketplace_products" as const,
      platformId: spec.platformId,
      displayName: spec.displayName,
      capability: spec.capability,
      workflowVersion,
      inputSchema: workflowInputSchema,
      maximumProviderCalls: steps.length,
      definitionSha256,
      steps,
    }];
  });
}

export async function syncProviderBusinessWorkflows(
  client: Pick<PoolClient, "query">,
  sourceCatalogImportId: string,
  endpoints: EndpointLike[],
): Promise<{ receiptId: string; workflowCount: number; stepCount: number; definitionSha256: string }> {
  const workflows = buildCuratedMarketplaceWorkflows(endpoints);
  if (!workflows.length) throw new Error("No callable provider business workflow could be built from the imported catalog.");
  const manifest = workflows.map((workflow) => ({
    workflowId: workflow.workflowId,
    workflowVersion: workflow.workflowVersion,
    platformId: workflow.platformId,
    definitionSha256: workflow.definitionSha256,
    steps: workflow.steps.map((step) => ({ stepId: step.stepId, endpointId: step.endpointId, role: step.role })),
  }));
  const definitionSha256 = catalogSha256(manifest);
  const stepCount = workflows.reduce((total, workflow) => total + workflow.steps.length, 0);
  const insertedReceipt = await client.query<{ id: string }>(`
    INSERT INTO provider_business_workflow_import_receipt (
      provider, source_catalog_import_id, definition_sha256, workflow_count, step_count, manifest
    ) VALUES ('justoneapi', $1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (provider, source_catalog_import_id, definition_sha256)
    DO NOTHING
    RETURNING id
  `, [sourceCatalogImportId, definitionSha256, workflows.length, stepCount, JSON.stringify(manifest)]);
  const existingReceipt = insertedReceipt.rows[0] ? null : await client.query<{ id: string }>(`
    SELECT id FROM provider_business_workflow_import_receipt
    WHERE provider = 'justoneapi' AND source_catalog_import_id = $1 AND definition_sha256 = $2
    LIMIT 1
  `, [sourceCatalogImportId, definitionSha256]);
  const receiptId = insertedReceipt.rows[0]?.id ?? existingReceipt?.rows[0]?.id;
  if (!receiptId) throw new Error("Provider business workflow receipt was not created.");
  for (const workflow of workflows) {
    await client.query(`
      INSERT INTO provider_business_workflow (
        workflow_id, provider, business_tool, platform_id, display_name, capability,
        workflow_version, input_schema, maximum_provider_calls, definition_sha256,
        status, source_workflow_import_id
      ) VALUES ($1, 'justoneapi', $2, $3, $4, $5, $6, $7::jsonb, $8, $9, 'active', $10)
      ON CONFLICT (workflow_id) DO UPDATE SET
        business_tool = EXCLUDED.business_tool,
        platform_id = EXCLUDED.platform_id,
        display_name = EXCLUDED.display_name,
        capability = EXCLUDED.capability,
        workflow_version = EXCLUDED.workflow_version,
        input_schema = EXCLUDED.input_schema,
        maximum_provider_calls = EXCLUDED.maximum_provider_calls,
        definition_sha256 = EXCLUDED.definition_sha256,
        status = EXCLUDED.status,
        source_workflow_import_id = EXCLUDED.source_workflow_import_id,
        updated_at = CURRENT_TIMESTAMP
    `, [
      workflow.workflowId, workflow.businessTool, workflow.platformId, workflow.displayName,
      workflow.capability, workflow.workflowVersion, JSON.stringify(workflow.inputSchema),
      workflow.maximumProviderCalls, workflow.definitionSha256, receiptId,
    ]);
    await client.query("DELETE FROM provider_business_workflow_step WHERE workflow_id = $1", [workflow.workflowId]);
    for (const step of workflow.steps) {
      await client.query(`
        INSERT INTO provider_business_workflow_step (
          workflow_id, step_id, step_order, role, endpoint_id,
          input_bindings, output_bindings, required
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
      `, [
        workflow.workflowId, step.stepId, step.stepOrder, step.role, step.endpointId,
        JSON.stringify(step.inputBindings), JSON.stringify(step.outputBindings), step.required,
      ]);
    }
  }
  await client.query(`
    UPDATE provider_business_workflow
    SET status = 'disabled', updated_at = CURRENT_TIMESTAMP
    WHERE provider = 'justoneapi' AND source_workflow_import_id IS DISTINCT FROM $1
  `, [receiptId]);
  return { receiptId, workflowCount: workflows.length, stepCount, definitionSha256 };
}

function business(key: string, omitIfNull = false): WorkflowInputBinding {
  return { source: "business_input", key, ...(omitIfNull ? { omit_if_null: true } : {}) };
}

function resolved(key: string): WorkflowInputBinding {
  return { source: "resolved_binding", key };
}

function output(name: string, aliases: string[], valueType: WorkflowOutputBinding["value_type"]): WorkflowOutputBinding {
  return { name, aliases: [...new Set(aliases)], value_type: valueType };
}

function schemaProperties(schema: JsonObject): JsonObject {
  return isRecord(schema.properties) ? schema.properties : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
