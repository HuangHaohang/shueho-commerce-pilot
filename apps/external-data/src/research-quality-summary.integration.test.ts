import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { database } from "./database.js";
import { ExternalDataPipeline } from "./pipeline.js";
import type { LocalModelClient } from "./local-model-client.js";
const runtimeUrl = process.env.JUSTONEAPI_TEST_DATABASE_URL;
const ownerUrl = process.env.JUSTONEAPI_TEST_MIGRATION_DATABASE_URL;
const owner = new Pool({ connectionString: ownerUrl });
describe.skipIf(!runtimeUrl || !ownerUrl)("source/quality readback on isolated PostgreSQL", () => {
  beforeAll(() => { expect(config.databaseUrl).toBe(runtimeUrl); });
  afterAll(async () => { await owner.end(); await database.end(); });
  it("reads source metrics and actual exclusion reasons without promoting held records", async () => {
    const endpointId = `fixture_relevance.search_${randomUUID().replaceAll("-", "")}`;
    await owner.query(`INSERT INTO provider_endpoint(endpoint_id,platform_id,platform_name,display_name,capability,api_path,http_method,
      schema_version,request_schema,response_family,enabled,catalog_status,pricing_status,permission_status,normalizer_version)
      VALUES($1,'fixture_relevance','Fixture','Fixture','Fixture',$2,'GET','v1',
      '{"type":"object","properties":{"keyword":{"type":"string"}},"additionalProperties":false}',
      'content',true,'active','priced','allowed','generic-json-v1')`,[endpointId,`/api/fixture/${randomUUID()}`]);
    const models = {
      health: async () => ({}),
      embed: async (texts: string[]) => texts.map(() => [1,...new Array(1023).fill(0)]),
      rerank: async (_query: string, documents: string[]) => documents.map(() => 0.01),
    } as unknown as LocalModelClient;
    const result = await new ExternalDataPipeline(undefined,models).ingestArchived({
      tenantId:randomUUID(),workspaceId:randomUUID(),userId:"fixture",source:"archive_import",
      sourceCallId:`fixture_${randomUUID()}`,requestText:"研究便携水杯互动TOP3",topN:3,
      businessIntent:{kind:"social_content_research",platform:"fixture_relevance",targetProduct:"便携水杯",objective:"interaction_ranked",
        requestedMetrics:["views","likes","comments","shares"],requestedTopN:3,windowEnforcement:"warehouse_post_filter",
        timeRange:{start:"2026-08-01T00:00:00.000Z",end:"2026-08-31T23:59:59.999Z",startDate:"2026-08-01",endDate:"2026-08-31",timezone:"UTC"}},
    },endpointId,{keyword:"便携水杯"},{code:0,data:{pagination:{has_more:true,page:1,limit:3,total_count:90},
      content_list:[1,2,3].map((n)=>({id:"fixture-"+n,title:"便携水杯使用分享",
        published_at:n===1?"2026-08-15T00:00:00.000Z":n===2?"2026-07-15T00:00:00.000Z":null,
        views:100,likes:10,comments:2,shares:0}))}});
    expect(result.success).toBe(true);
    expect(result.evidence).toHaveLength(0);
    expect(result.coverage).toMatchObject({sourceRecords:3,sourceRecordsWithPublishTime:2,
      sourceMetricCoverageByField:{views:{status:"complete",presentSamples:3},shares:{status:"complete"}},
      metricCoverageByField:{views:{status:"no_samples"}},
      exclusionReasons:{SCOPE_UNCONFIRMED:1,OUTSIDE_REQUESTED_WINDOW:1,PUBLISHED_AT_MISSING:1},
      sourcePagination:{hasMore:true,providerReportedTotal:90},collectionComplete:false,
      sampleStatus:"no_qualified_samples",requestedCount:3});
  });
});
