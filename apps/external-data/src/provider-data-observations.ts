import type { PoolClient } from "pg";
import { isProtectedField } from "./data-capabilities.js";
import { withScope } from "./database.js";
import { assessTextQuality } from "./quality.js";
import type { ExternalDataScope, JsonObject } from "./types.js";

type Observation = { field_path: string; field_name: string; value_type: string; normalized_value: unknown;
  quality_status: "valid" | "held" | "rejected"; reason_codes: string[] };

/** This is a validated field projection, not a raw archive read or a business-metric assertion. */
export function normalizeProviderFields(payload: JsonObject): { observations: Observation[]; truncated: boolean } {
  const observations: Observation[] = [];
  let truncated = false;
  const add = (path: string, name: string, value: unknown, status: Observation["quality_status"], reasons: string[]) => {
    observations.push({ field_path: path,field_name: name,value_type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
      normalized_value: status === "valid" ? value : null,quality_status: status,reason_codes: reasons });
  };
  const visit = (value: unknown, path: string, name: string, depth: number): void => {
    if (observations.length >= 10_000) { truncated = true; return; }
    if (depth > 25) { truncated = true; add(path,name,null,"held",["PROJECTION_DEPTH_LIMIT"]); return; }
    if (isProtectedField(name)) { add(path,name,null,"held",["PROTECTED_SOURCE_FIELD"]); return; }
    if (value === null || typeof value === "boolean") { add(path,name,value,"valid",[]); return; }
    if (typeof value === "number") {
      const safe = Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
      add(path,name,value,safe ? "valid" : "held",safe ? [] : ["UNSAFE_NUMERIC_PRECISION"]); return;
    }
    if (typeof value === "string") {
      const quality = assessTextQuality(value,{ maxLength: 20_000,allowEmpty: true,field: name });
      const credential = /\bBearer\s+[A-Za-z0-9_.-]{16,}|[?&](?:token|api_key|access_token|password)=/i.test(value);
      add(path,name,quality.normalizedValue ?? "",credential ? "held" : quality.status === "rejected" ? "rejected" : "valid",
        credential ? ["PROTECTED_SOURCE_VALUE"] : quality.reasons); return;
    }
    if (Array.isArray(value)) {
      if (!value.length) add(path,name,[],"valid",[]);
      for (let index=0;index<value.length;index+=1) {
        if (observations.length>=10_000) { truncated=true;break; }
        visit(value[index],`${path}/${index}`,String(index),depth+1);
      }
      return;
    }
    if (value && typeof value === "object") {
      if (!Object.keys(value).length) add(path,name,{},"valid",[]);
      for (const [key, child] of Object.entries(value)) {
        if (observations.length>=10_000) { truncated=true;break; }
        visit(child,`${path}/${key.replaceAll("~","~0").replaceAll("/","~1")}`,key,depth+1);
      }
    }
  };
  const data = Object.hasOwn(payload,"data") ? payload.data : payload;
  visit(data,"/data","data",0);
  return { observations,truncated };
}

export async function persistProviderDataObservations(scope: ExternalDataScope, researchRequestId: string, payload: JsonObject): Promise<void> {
  const normalized = normalizeProviderFields(payload);
  await withScope(scope, async (client) => {
    await client.query("SELECT id FROM research_request WHERE id=$1 FOR UPDATE",[researchRequestId]);
    await client.query(`INSERT INTO provider_data_observation(tenant_id,workspace_id,research_request_id,ordinal,
      field_path,field_name,value_type,normalized_value,quality_status,reason_codes)
      SELECT $1,$2,$3,item.ordinal,item.field_path,item.field_name,item.value_type,item.normalized_value,item.quality_status,item.reason_codes
      FROM jsonb_to_recordset($4::jsonb) AS item(ordinal integer,field_path text,field_name text,value_type text,
        normalized_value jsonb,quality_status text,reason_codes text[]) ON CONFLICT(research_request_id,ordinal) DO NOTHING`,
    [scope.tenantId,scope.workspaceId,researchRequestId,JSON.stringify(normalized.observations.map((row,ordinal) => ({ ...row,ordinal })))]);
    await client.query(`UPDATE research_request SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=$1`,[researchRequestId]);
  });
}

export async function loadProviderDataFields(client: Pick<PoolClient,"query">, researchRequestId: string, offset = 0, limit = 50) {
  const rows = await client.query<JsonObject>(`SELECT id AS evidence_id,field_path AS source_json_pointer,field_name,
    value_type,normalized_value AS value,'validated_source_field'::text AS quality_basis,
    'provider_output'::text AS claim_level,NULL::double precision AS confidence
    FROM provider_data_observation WHERE research_request_id=$1 AND quality_status='valid'
    ORDER BY ordinal LIMIT $2 OFFSET $3`,[researchRequestId,limit,offset]);
  const count = await client.query<{ valid: number; excluded: number; total: number; depth_limited: boolean }>(`SELECT
    count(*) FILTER(WHERE quality_status='valid')::int AS valid,count(*) FILTER(WHERE quality_status<>'valid')::int AS excluded,
    count(*)::int AS total,bool_or('PROJECTION_DEPTH_LIMIT'=ANY(reason_codes)) AS depth_limited FROM provider_data_observation WHERE research_request_id=$1`,[researchRequestId]);
  return { evidence: rows.rows,coverage: { acceptedEvidence: count.rows[0]!.valid,excludedFields: count.rows[0]!.excluded,
    fieldOffset: offset,returnedFields: rows.rows.length,nextFieldOffset: offset+rows.rows.length<count.rows[0]!.valid ? offset+rows.rows.length : null,
    projectionMayBeTruncated: count.rows[0]!.total>=10_000 || count.rows[0]!.depth_limited,semantics: "provider_output_not_independently_verified_business_metrics" } };
}
