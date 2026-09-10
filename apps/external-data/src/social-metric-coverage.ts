import type {JsonObject} from './types.js';
const names=['views','likes','comments','shares','interactions'] as const;
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
/** Only typed counts are comparable; null, display text and unrelated numeric fields are not counts. */
export function normalizeSocialMetricFields(value:JsonObject):JsonObject{
 const note=value.note && typeof value.note==='object'&&!Array.isArray(value.note)?value.note as JsonObject:{};
 const result={...value};
 for(const [canonical,alias] of [['likes','liked_count'],['comments','comments_count'],['shares','share_count']] as const){
  if(result[canonical]===undefined && count(note[alias]))result[canonical]=note[alias];
 }
 return result;
}
export function socialMetricCoverage(evidence:JsonObject[]){
 const perField:JsonObject={};const available:string[]=[];
 for(const name of names){
  const present=evidence.filter(e=>{const m=e.metrics as JsonObject|undefined;return m&&count(m[name]);}).length;
  perField[name]={presentSamples:present,totalSamples:evidence.length,status:evidence.length===0?'no_samples':present===0?'missing':present===evidence.length?'complete':'partial',timeBasis:'provider_observed_count_not_period_increment'};
  if(present>0)available.push(name);
 }
 return {available,perField};
}
