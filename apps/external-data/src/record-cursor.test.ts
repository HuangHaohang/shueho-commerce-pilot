import {describe,it,expect} from 'vitest';import {randomUUID} from 'node:crypto';import {encodeRecordCursor,decodeRecordCursor} from './record-cursor.js';
describe('record delivery cursor',()=>{
 it('supports offsets beyond 10000 with snapshot and owner target bound into the cursor',()=>{const id=randomUUID(),snapshot_id=randomUUID();const value={version:1 as const,kind:'task' as const,id,snapshot_id,offset:10050};const encoded=encodeRecordCursor(value);expect(decodeRecordCursor(encoded,'task',id)).toEqual(value);expect(()=>decodeRecordCursor(encoded,'task',randomUUID())).toThrow('INVALID_RECORD_CURSOR');});
 it('rejects malformed or negative offsets',()=>{const id=randomUUID();expect(()=>decodeRecordCursor('garbage','research',id)).toThrow();expect(()=>decodeRecordCursor(encodeRecordCursor({version:1,kind:'research',id,offset:-1}),'research',id)).toThrow();});
});
