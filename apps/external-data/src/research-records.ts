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
async function ensureRecordIndex(c:import('pg').PoolClient,requestId:string){
 await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['record-index:'+requestId]);
 if((await c.query('SELECT 1 FROM research_record_manifest WHERE research_request_id=$1',[requestId])).rowCount)return;
 const request=(await c.query('SELECT status FROM research_request WHERE id=$1',[requestId])).rows[0];
 if(request?.status!=='completed')return;
 const fields=await c.query("SELECT id,field_path,normalized_value FROM provider_data_observation WHERE research_request_id=$1 AND quality_status='valid' ORDER BY ordinal",[requestId]);
 const assembled=assembleResearchRecords(fields.rows);
 const rows=assembled.records.map((r,ordinal)=>({ordinal,collection:r.collection,source_index:r.source_index,record:r,
  identity_key:sha256Json(r.fields.rateId!==undefined||r.fields.id!==undefined||r.fields.itemId!==undefined?{collection:r.collection,id:r.fields.rateId??r.fields.id??r.fields.itemId}:{requestId,collection:r.collection,index:r.source_index})}));
 await c.query(`INSERT INTO research_record_index(research_request_id,ordinal,collection,source_index,identity_key,record)
 SELECT $1,r.ordinal,r.collection,r.source_index,r.identity_key,r.record FROM jsonb_to_recordset($2::jsonb) AS r(ordinal int,collection text,source_index int,identity_key text,record jsonb)`,[requestId,JSON.stringify(rows)]);
 await c.query(`INSERT INTO research_record_manifest(research_request_id,pagination,record_count,truncated) VALUES($1,$2::jsonb,$3,$4)`,[requestId,JSON.stringify(assembled.pagination),rows.length,fields.rowCount===10000]);
}
export async function readResearchRecords(scope:Scope,requestId:string,offset=0,limit=50){
 return withScope(scope,async c=>{
  const exists=await c.query('SELECT 1 FROM research_request WHERE id=$1 AND user_id=$2 AND ($3::text IS NULL OR root_thread_id=$3)',[requestId,scope.userId,scope.rootThreadId??null]);
  if(!exists.rowCount)throw new Error('RESEARCH_NOT_FOUND');
  await ensureRecordIndex(c,requestId);
  const manifest=(await c.query('SELECT * FROM research_record_manifest WHERE research_request_id=$1',[requestId])).rows[0];
  const records=(await c.query('SELECT record FROM research_record_index WHERE research_request_id=$1 ORDER BY ordinal OFFSET $2 LIMIT $3',[requestId,offset,limit])).rows.map(r=>r.record);
  return {success:true,research_request_id:requestId,records,pagination:manifest?.pagination??{},total_records:manifest?.record_count??0,
   next_offset:manifest&&offset+records.length<manifest.record_count?offset+records.length:null,projection_may_be_truncated:manifest?.truncated??false,records_ready:!!manifest,
   semantics:'validated_provider_records_not_verified_sales'};
 });
}
export async function readTaskRecords(scope:Scope,taskId:string,offset=0,limit=50,snapshotId?:string){
 if(offset>0&&!snapshotId)throw new Error('RECORD_SNAPSHOT_REQUIRED');
 return withScope(scope,async c=>{
  if(!(await c.query("SELECT 1 FROM research_task WHERE id=$1 AND user_id=$2 AND ($3::text IS NULL OR principal->>'rootThreadId'=$3)",[taskId,scope.userId,scope.rootThreadId??null])).rowCount)throw new Error('TASK_NOT_FOUND');
  let snapshot;
  if(snapshotId){snapshot=(await c.query('SELECT * FROM research_record_snapshot WHERE id=$1 AND task_id=$2',[snapshotId,taskId])).rows[0];if(!snapshot)throw new Error('RECORD_SNAPSHOT_NOT_FOUND');}
  else{
   const ids=(await c.query(`SELECT DISTINCT r.id,r.created_at FROM research_task_operation op JOIN research_request r ON r.id::text=op.result#>>'{payload,research_request_id}'
    WHERE op.task_id=$1 AND op.state='completed' AND r.status='completed' ORDER BY r.created_at,r.id`,[taskId])).rows.map(r=>r.id as string);
   for(const id of ids)await ensureRecordIndex(c,id);
   const revision=sha256Json(ids);
   await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['record-snapshot:'+taskId+':'+revision]);
   snapshot=(await c.query('SELECT * FROM research_record_snapshot WHERE task_id=$1 AND revision=$2',[taskId,revision])).rows[0];
   if(!snapshot){
    const counts=(await c.query(`SELECT count(*)::int AS total,count(DISTINCT identity_key)::int AS unique_count FROM research_record_index WHERE research_request_id=ANY($1::uuid[])`,[ids])).rows[0];
    const pages=(await c.query(`SELECT research_request_id,pagination,truncated FROM research_record_manifest WHERE research_request_id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],research_request_id)`,[ids])).rows;
    snapshot=(await c.query(`INSERT INTO research_record_snapshot(task_id,revision,record_count,duplicates,source_pages,truncated) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
     [taskId,revision,counts.unique_count,counts.total-counts.unique_count,JSON.stringify(pages.map(p=>({research_request_id:p.research_request_id,...p.pagination}))),pages.some(p=>p.truncated)])).rows[0];
    await c.query(`INSERT INTO research_record_snapshot_item(snapshot_id,ordinal,research_request_id,record_ordinal)
     SELECT $1,(row_number() OVER(ORDER BY page_order,ordinal)-1)::int,research_request_id,ordinal FROM (
      SELECT DISTINCT ON(identity_key) research_request_id,ordinal,array_position($2::uuid[],research_request_id) AS page_order
      FROM research_record_index WHERE research_request_id=ANY($2::uuid[]) ORDER BY identity_key,page_order,ordinal
     ) d`,[snapshot.id,ids]);
   }
  }
  const records=(await c.query(`SELECT i.record,s.research_request_id FROM research_record_snapshot_item s JOIN research_record_index i
   ON i.research_request_id=s.research_request_id AND i.ordinal=s.record_ordinal WHERE s.snapshot_id=$1 ORDER BY s.ordinal OFFSET $2 LIMIT $3`,[snapshot.id,offset,limit])).rows.map(r=>({...r.record,research_request_id:r.research_request_id}));
  return {success:true,task_id:taskId,snapshot_id:snapshot.id,records,total_records:snapshot.record_count,duplicates_removed:snapshot.duplicates,
   next_offset:offset+records.length<snapshot.record_count?offset+records.length:null,source_pages:snapshot.source_pages,projection_may_be_truncated:snapshot.truncated,
   semantics:'validated_provider_records_not_verified_sales'};
 });
}
