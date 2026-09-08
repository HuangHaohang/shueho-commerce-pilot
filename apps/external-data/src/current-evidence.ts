import { withScope } from "./database.js";
import type { JsonObject } from "./types.js";

/** Elasticsearch and previous observations cannot override the latest SQL decision. */
export async function currentPromotedEvidenceKeys(
  scope: { tenantId: string; workspaceId: string },
  rows: JsonObject[],
): Promise<Set<string>> {
  const ids = [...new Set(rows.map((row) => row.id).filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)))];
  if (!ids.length) return new Set();
  return withScope(scope, async (client) => {
    const result = await client.query<{ result_key: string }>(`
      WITH observations AS (
        SELECT 'product:' || id::text AS result_key,enrichment_result_id,research_request_id FROM business_product_observation WHERE id=ANY($1::uuid[])
        UNION ALL SELECT 'content:' || id::text,enrichment_result_id,research_request_id FROM business_content_observation WHERE id=ANY($1::uuid[])
        UNION ALL SELECT 'brand:' || id::text,enrichment_result_id,research_request_id FROM business_brand_observation WHERE id=ANY($1::uuid[])
        UNION ALL SELECT 'property:' || id::text,enrichment_result_id,research_request_id FROM business_property_observation WHERE id=ANY($1::uuid[])
        UNION ALL SELECT 'evidence:' || id::text,enrichment_result_id,research_request_id FROM business_evidence_observation WHERE id=ANY($1::uuid[])
      )
      SELECT observation.result_key FROM observations observation
      JOIN ai_enrichment_result decision ON decision.id=observation.enrichment_result_id AND decision.decision='promote'
      WHERE decision.job_id=(SELECT job.id FROM ai_enrichment_job job
        WHERE job.research_request_id=observation.research_request_id AND job.state='completed'
        ORDER BY job.completed_at DESC NULLS LAST,job.created_at DESC LIMIT 1)
    `, [ids]);
    return new Set(result.rows.map((row) => row.result_key));
  });
}
