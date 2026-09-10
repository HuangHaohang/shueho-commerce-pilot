import {withScope} from "./database.js";
import {researchPolicySchema} from "./research-policy.js";
import {sourcePagination} from "./research-quality-summary.js";
import type {JsonObject} from "./types.js";
import {createHash} from "node:crypto";
export async function researchContinuation(scope:{tenantId:string;workspaceId:string;userId:string},requestId:string,policyId:string,platform:string,objective:string){
 return withScope(scope,async c=>{
  const r=(await c.query("SELECT raw.endpoint_id,raw.request_params,raw.response_payload FROM external_api_call_raw raw JOIN research_request r ON r.id=raw.research_request_id WHERE r.id=$1 AND r.user_id=$2 AND r.status='completed' AND raw.state='succeeded'",[requestId,scope.userId])).rows[0];
  if(!r)throw new Error("COMPLETED_OWNED_RESEARCH_REQUIRED");
  const receipt=(await c.query("SELECT source_document FROM research_policy_import_receipt WHERE id=$1",[policyId])).rows[0];
  if(!receipt)throw new Error("RESEARCH_POLICY_NOT_FOUND");
  const profile=researchPolicySchema.parse(receipt.source_document).social.find(p=>p.platform===platform&&p.objective===objective&&p.endpointId===r.endpoint_id);
  if(!profile)throw new Error("RESEARCH_POLICY_ENDPOINT_MISMATCH");
  const rows=(await c.query(`SELECT COALESCE(g.provider_entity_id,g.raw_sha256) AS identity FROM generic_source_record g
   JOIN generic_source_snapshot s ON s.id=g.snapshot_id WHERE s.research_request_id=$1 AND g.provider_entity_id IS NOT NULL
   UNION ALL SELECT COALESCE(i.canonical_url,i.raw_sha256) FROM social_search_item i JOIN social_search_snapshot s ON s.id=i.snapshot_id WHERE s.research_request_id=$1`,[requestId])).rows;
  const signature=rows.length?createHash("sha256").update(JSON.stringify(rows.map(x=>x.identity).sort())).digest("hex"):null;
  const paging=profile.pagination;
  if(!paging)return {success:true,next_params:null,reason:"pagination_unsupported",signature};
  let hasMore=sourcePagination(r.response_payload??{}).hasMore;
  let next:unknown;
  if(paging.kind==="cursor"){
   next=(paging.responseCursorPath??[]).reduce<any>((value,key)=>value?.[key],r.response_payload);
   if(typeof next==="string"&&next.trim())hasMore=true;else if(next===null||next==="")hasMore=false;
  }else if(hasMore===true){
   const page=r.request_params[paging.parameter];if(Number.isSafeInteger(page))next=page+1;
  }
  return {success:true,next_params:hasMore===true&&next!==undefined?{...r.request_params,[paging.parameter]:next}:null,
   reason:hasMore===false?"source_end":next===undefined?"pagination_unconfirmed":"continue",signature};
 });
}
