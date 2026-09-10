import type {JsonObject} from './types.js';
export type RecordCursor={version:1;kind:'task'|'research';id:string;offset:number;snapshot_id?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function encodeRecordCursor(value:RecordCursor){return Buffer.from(JSON.stringify(value)).toString('base64url');}
export function decodeRecordCursor(text:string,kind:RecordCursor['kind'],id:string):RecordCursor{
 try{
  if(text.length>512||!/^[A-Za-z0-9_-]+$/.test(text))throw new Error();
  const v=JSON.parse(Buffer.from(text,'base64url').toString('utf8'));
  if(v.version!==1||v.kind!==kind||v.id!==id||!uuid.test(v.id)||!Number.isInteger(v.offset)||v.offset<0||v.offset>2147483647||
   kind==='task'&&(!v.snapshot_id||!uuid.test(v.snapshot_id)))throw new Error();
  return v;
 }catch{throw new Error('INVALID_RECORD_CURSOR');}
}
