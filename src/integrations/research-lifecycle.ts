/** Persisted warehouse states, plus transport acknowledgements. Checked against the SQL contract. */
export const WAREHOUSE_RESEARCH_STATES=['created','collecting','normalizing','enriching','completed','failed','unknown'] as const;
const pending=new Set<string>(['created','collecting','normalizing','enriching','executing','running','queued','processing']);
export function researchResultPending(payload:Record<string,unknown>):boolean{return typeof payload.processing_state==='string'&&pending.has(payload.processing_state);}
export function researchResultTerminal(payload:Record<string,unknown>):boolean{return ['completed','failed','unknown','cancelled'].includes(String(payload.processing_state));}
export function transientControlFailure(error:unknown):boolean{const e=error as {code?:string;status?:number};return e.code==='CONTROL_UNAVAILABLE'||(e.status??0)>=500;}
