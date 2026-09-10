import {describe,it,expect} from 'vitest';
import {assembleResearchRecords} from './research-records.js';
describe('validated record readback',()=>{
 it('reconstructs whole reviews with SKU, append content and explicit null without account fields',()=>{
  const pairs:[string,unknown][]=[['/data/comments/0/content','质量不错'],['/data/comments/0/auction/sku','100双'],['/data/comments/0/appendList/0/content','再买一包'],['/data/comments/0/user/nick','private'],['/data/comments/0/photos',null],['/data/comments/1/content','有毛刺'],['/data/hasNextPage',false],['/data/maxPage',50]];
  const r=assembleResearchRecords(pairs.map(([field_path,normalized_value])=>({field_path,normalized_value})));
  expect(r.records).toHaveLength(2);expect(r.records[0]?.fields).toEqual({content:'质量不错',auction:{sku:'100双'},appendList:[{content:'再买一包'}],photos:null});
  expect(r.pagination).toEqual({hasNextPage:false,maxPage:50});
 });
 it('rejects prototype keys',()=>{assembleResearchRecords([{field_path:'/data/items/0/__proto__/polluted',normalized_value:true}]);expect(({} as any).polluted).toBeUndefined();});
});
