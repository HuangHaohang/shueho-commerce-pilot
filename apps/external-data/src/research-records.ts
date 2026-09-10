import {withScope} from './database.js';
import type {JsonObject} from './types.js';
import {sha256Json} from './canonical.js';

type Scope={tenantId:string;workspaceId:string;userId:string;rootThreadId?:string|null};
function assign(target:JsonObject,path:string[],value:unknown){
 let node:any=target;
 for(let i=0;i<path.length;i++){
  const key=path[i]!;
  if(['__proto__','prototype','constructor'].includes(key))return;
  if(i===path.length-1)node[key]=value;
  else node=node[key]??=(/^\d+$/.test(path[i+1]!)?[]:{});
 }
}
/** Reconstruct validated source observations into records; never read raw archives. */
export function assembleResearchRecords(fields:Array<{field_path:string;normalized_value:unknown;id?:string}>){
 const records=new Map<string,{collection:string;source_index:number;fields:JsonObject;evidence_ids:string[]}>();
 const page:JsonObject={};
 for(const field of fields){
  const parts=field.field_path.split('/').slice(1).map(p=>p.replaceAll('~1','/').replaceAll('~0','~'));
  const index=parts.findIndex(p=>/^\d+$/.test(p));
  if(index<0){
   const key=parts.at(-1)!;
   if(['total','totalFuzzy','maxPage','currentPageNum','hasNextPage','hasMore','page','pageSize','totalPage'].includes(key))page[key]=field.normalized_value;
   continue;
  }
  const collection='/'+parts.slice(0,index).join('/');
  // Operational response metadata and user identities are not business records.
  if(/extraMap|debug|trace|token|cookie|password|user\/|buyer\//i.test(collection))continue;
  const id=parts.slice(0,index+1).join('/');
  const row=records.get(id)??{collection,source_index:Number(parts[index]),fields:{},evidence_ids:[]};
  const rest=parts.slice(index+1);
  if(rest.some(k=>/^(user|buyer|nick|avatar|userId|userNick|userName|headPic|phone|address)$/i.test(k)))continue;
  assign(row.fields,rest.length?rest:['value'],field.normalized_value);
  if(field.id)row.evidence_ids.push(field.id);
  records.set(id,row);
 }
 return {records:[...records.values()],pagination:page};
}
export async function readResearchRecords(scope:Scope,requestId:string,offset=0,limit=50){
 return withScope(scope,async c=>{
  const exists=await c.query('SELECT 1 FROM research_request WHERE id=$1 AND user_id=$2 AND ($3::text IS NULL OR root_thread_id=$3)',[requestId,scope.userId,scope.rootThreadId??null]);
  if(!exists.rowCount)throw new Error('RESEARCH_NOT_FOUND');
  const fields=await c.query('SELECT id,field_path,normalized_value FROM provider_data_observation WHERE research_request_id=$1 AND quality_status=\'valid\' ORDER BY ordinal',[requestId]);
  const assembled=assembleResearchRecords(fields.rows);
  return {success:true,research_request_id:requestId,records:assembled.records.slice(offset,offset+limit),pagination:assembled.pagination,
   total_records:assembled.records.length,next_offset:offset+limit<assembled.records.length?offset+limit:null,
   semantics:'validated_provider_records_not_verified_sales',projection_may_be_truncated:fields.rowCount===10000};
 });
}

export async function readTaskRecords(scope:Scope,taskId:string,offset=0,limit=50){
 const ids=await withScope(scope,async c=>{
  if(!(await c.query("SELECT 1 FROM research_task WHERE id=$1 AND user_id=$2 AND ($3::text IS NULL OR principal->>'rootThreadId'=$3)",[taskId,scope.userId,scope.rootThreadId??null])).rowCount)throw new Error('TASK_NOT_FOUND');
  return (await c.query(`SELECT DISTINCT result#>>'{payload,research_request_id}' AS id FROM research_task_operation
    WHERE task_id=$1 AND state='completed' AND result#>>'{payload,research_request_id}' IS NOT NULL ORDER BY id`,[taskId])).rows.map(r=>r.id as string);
 });
 const seen=new Set<string>();const rows:JsonObject[]=[];let duplicates=0,truncated=false;const pages:JsonObject[]=[];
 for(const id of ids){
  let next:number|null=0;
  do{
   const page=await readResearchRecords(scope,id,next,100);truncated ||= page.projection_may_be_truncated;
   if(next===0)pages.push({research_request_id:id,...page.pagination});
   for(const record of page.records){
    const identity=record.fields.rateId??record.fields.id??record.fields.itemId;
    // Without a provider record identity, retain records rather than invent a duplicate match.
    const key=identity!==undefined?sha256Json({collection:record.collection,id:identity}):`${id}:${record.collection}:${record.source_index}`;
    if(seen.has(key)){duplicates++;continue;}seen.add(key);rows.push({...record,research_request_id:id});
   }
   next=page.next_offset;
  }while(next!==null && rows.length<10000);
  if(rows.length>=10000){truncated=true;break;}
 }
 return {success:true,task_id:taskId,records:rows.slice(offset,offset+limit),total_records:rows.length,duplicates_removed:duplicates,
  next_offset:offset+limit<rows.length?offset+limit:null,source_pages:pages,projection_may_be_truncated:truncated,
  semantics:'validated_provider_records_not_verified_sales'};
}
