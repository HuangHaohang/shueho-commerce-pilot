import {z} from "zod";
import {database} from "./database.js";
import type {JsonObject} from "./types.js";
export const researchPolicySchema=z.object({
 version:z.literal(1),
 sampling:z.object({relevanceWeight:z.number().min(0).max(1),sameShopPenalty:z.number().min(0).max(1)}).strict(),
 retrieval:z.object({candidateLimit:z.number().int().positive(),rerankLimit:z.number().int().positive(),rrfK:z.number().positive(),efSearch:z.number().int().positive()}).strict(),
 social:z.array(z.object({
  platform:z.string(),objective:z.enum(["latest_content","interaction_ranked"]),endpointId:z.string(),timezone:z.string(),
  keywordParameter:z.string(),fixedParameters:z.record(z.unknown()),dateParameters:z.object({start:z.string(),end:z.string()}).nullable(),
  pagination:z.object({parameter:z.string(),kind:z.enum(["page","cursor"]),responseCursorPath:z.array(z.string()).optional()}).nullable(),
  rankingBasis:z.string().nullable(),documentationUrl:z.string().url(),
 }).strict()),
 providerTimezones:z.record(z.string()),
}).strict();
export type ResearchPolicy=z.infer<typeof researchPolicySchema> & {receiptId?:string};
export async function loadResearchPolicy(legacy=false):Promise<ResearchPolicy>{
 const r=await database.query<{id:string;source_document:JsonObject}>(legacy?"SELECT id,source_document FROM research_policy_import_receipt ORDER BY created_at ASC,id ASC LIMIT 1":"SELECT id,source_document FROM research_policy_import_receipt ORDER BY created_at DESC,id DESC LIMIT 1");
 if(!r.rows[0])throw new Error("RESEARCH_POLICY_NOT_IMPORTED");
 return {...researchPolicySchema.parse(r.rows[0].source_document),receiptId:r.rows[0].id};
}
export function localDateBoundary(date:string,timezone:string,end=false):string{
 // Convert the specified IANA local calendar boundary; never infer an offset from a country name.
 const desired=Date.parse(date+"T00:00:00.000Z")+(end?86400000:0);
 let instant=desired;
 const formatter=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
 for(let i=0;i<4;i++){
  const p=Object.fromEntries(formatter.formatToParts(instant).map(x=>[x.type,x.value]));
  const represented=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  const correction=desired-represented;if(!correction)return new Date(instant-(end?1:0)).toISOString();instant+=correction;
 }
 throw new Error("LOCAL_DATE_BOUNDARY_UNRESOLVED");
}
