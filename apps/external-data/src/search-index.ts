import { Client } from "@elastic/elasticsearch";

import { recordServiceAudit } from "./audit.js";
import { config } from "./config.js";
import { database, withScope } from "./database.js";
import type { JsonObject } from "./types.js";

const elasticsearch = new Client({ node: config.elasticsearchUrl, requestTimeout: 5_000, maxRetries: 0 });

export async function ensureSearchIndex(): Promise<void> {
  const exists = await elasticsearch.indices.exists({ index: config.elasticsearchIndex });
  if (exists) return;
  await elasticsearch.indices.create({
    index: config.elasticsearchIndex,
    settings: { number_of_replicas: 0 },
    mappings: {
      dynamic: "strict",
      properties: {
        id: { type: "keyword" },
        tenant_id: { type: "keyword" },
        workspace_id: { type: "keyword" },
        research_request_id: { type: "keyword" },
        query_key: { type: "keyword" },
        entity_type: { type: "keyword" },
        title: { type: "text", analyzer: "cjk", fields: { keyword: { type: "keyword", ignore_above: 512 } } },
        summary: { type: "text", analyzer: "cjk" },
        shop_name: { type: "text", analyzer: "cjk", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
        source_name: { type: "keyword" },
        canonical_url: { type: "keyword", index: false },
        price_yuan: { type: "double" },
        sales_display: { type: "keyword" },
        relevance_score: { type: "double" },
        observed_at: { type: "date" },
      },
    },
  });
}

export async function drainIndexOutbox(limit = 100): Promise<{ claimed: number; completed: number; failed: number }> {
  const claimed = await database.query<{
    id: string;
    tenant_id: string;
    workspace_id: string;
    aggregate_type: string;
    aggregate_id: string;
    operation: "index" | "delete";
    payload: JsonObject;
    attempt_count: number;
  }>("SELECT * FROM external_data_claim_index_outbox($1)", [limit]);
  if (!claimed.rows.length) return { claimed: 0, completed: 0, failed: 0 };
  const operations = claimed.rows.flatMap((row) => row.operation === "delete"
    ? [{ delete: { _index: config.elasticsearchIndex, _id: row.aggregate_id } }]
    : [
        { index: { _index: config.elasticsearchIndex, _id: row.aggregate_id } },
        row.payload,
      ]);
  let itemErrors: Array<unknown | null>;
  try {
    const response = await elasticsearch.bulk({ operations, refresh: "wait_for" });
    itemErrors = response.items.map((item) => {
      const result = item.index ?? item.delete;
      return result?.error ?? null;
    });
  } catch (error) {
    itemErrors = claimed.rows.map(() => error);
  }
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < claimed.rows.length; index += 1) {
    const row = claimed.rows[index];
    if (!row) continue;
    const error = itemErrors[index] ?? null;
    if (!error) {
      await withScope({ tenantId: row.tenant_id, workspaceId: row.workspace_id }, async (client) => {
        await client.query(`
          UPDATE index_outbox SET state='completed', completed_at=CURRENT_TIMESTAMP,
            last_error=NULL WHERE id=$1
        `, [row.id]);
        await recordServiceAudit(client, { tenantId: row.tenant_id, workspaceId: row.workspace_id }, {
          action: "search_index.write",
          outcome: "succeeded",
          metadata: { aggregateType: row.aggregate_type, operation: row.operation },
        });
      });
      completed += 1;
    } else {
      await withScope({ tenantId: row.tenant_id, workspaceId: row.workspace_id }, async (client) => {
        await client.query(`
          UPDATE index_outbox SET state='failed', last_error=$2,
            next_attempt_at=CURRENT_TIMESTAMP + make_interval(secs => LEAST(3600, (2 ^ LEAST(attempt_count, 10))::integer))
          WHERE id=$1
        `, [row.id, safeMessage(error)]);
        await recordServiceAudit(client, { tenantId: row.tenant_id, workspaceId: row.workspace_id }, {
          action: "search_index.write",
          outcome: "failed",
          metadata: { aggregateType: row.aggregate_type, operation: row.operation, errorType: error instanceof Error ? error.name : "ElasticBulkError" },
        });
      });
      failed += 1;
    }
  }
  return { claimed: claimed.rowCount ?? 0, completed, failed };
}

export async function searchBusinessIndex(input: {
  tenantId: string;
  workspaceId: string;
  query: string;
  limit: number;
}): Promise<JsonObject[]> {
  const result = await elasticsearch.search<JsonObject>({
    index: config.elasticsearchIndex,
    size: input.limit,
    query: {
      bool: {
        filter: [
          { term: { tenant_id: input.tenantId } },
          { term: { workspace_id: input.workspaceId } },
        ],
        must: [{ multi_match: { query: input.query, fields: ["title^3", "summary", "shop_name"] } }],
      },
    },
  });
  return result.hits.hits.map((hit) => ({
    ...(hit._source ?? {}),
    elastic_score: hit._score ?? null,
  }));
}

export async function searchIndexHealth(): Promise<Record<string, unknown>> {
  const health = await elasticsearch.cluster.health();
  const count = await elasticsearch.count({ index: config.elasticsearchIndex }).catch(() => ({ count: 0 }));
  return { status: health.status, indexedDocuments: count.count };
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
