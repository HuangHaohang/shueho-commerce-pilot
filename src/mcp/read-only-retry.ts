const reads=new Set(['get_research_task','list_research_tasks','get_research_records','get_research_result','search_business_data','search_data_capabilities','get_data_capability','list_marketplace_research_platforms','get_marketplace_options']);
/** Read retries never enqueue or execute research, even if a server labels a mutating tool idempotent. */
export async function retryResearchRead<T>(name:string,call:()=>Promise<T>,wait:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<T>{
 for(let n=0;;n++){
  try{return await call();}catch(error){
   const message=error instanceof Error?error.message:'';
   if(!reads.has(name)||n>=2||!/fetch failed|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket|connection.*closed/i.test(message))throw error;
   await wait(250*2**n);
  }
 }
}
