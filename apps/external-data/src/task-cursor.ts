const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type TaskCursor={v:2;id:string;created_at:string};
export function encodeTaskCursor(id:string,created_at:string){return Buffer.from(JSON.stringify({v:2,id,created_at})).toString('base64url');}
export function decodeTaskCursor(value:unknown):TaskCursor|{v:1;id:string}|null{
 if(value===undefined||value===null)return null;
 if(typeof value!=='string'||value.length>512)throw new Error('INVALID_TASK_CURSOR');
 if(uuid.test(value))return {v:1,id:value};
 try{const c=JSON.parse(Buffer.from(value,'base64url').toString());
  if(c.v!==2||!uuid.test(c.id)||typeof c.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(c.created_at)||!Number.isFinite(Date.parse(c.created_at)))throw new Error();return c;
 }catch{throw new Error('INVALID_TASK_CURSOR');}
}
