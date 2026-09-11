import {readFileSync,writeFileSync} from 'node:fs';
const base=process.env.LOADTEST_BASE_URL ?? 'http://127.0.0.1:3100';
if (!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname)) throw new Error('This driver is restricted to a local test environment.');
if (!process.env.LOADTEST_USERS_FILE || !process.env.LOADTEST_OUTPUT_DIR) throw new Error('Set LOADTEST_USERS_FILE and LOADTEST_OUTPUT_DIR; keep authentication fixtures out of git.');
const users=JSON.parse(readFileSync(process.env.LOADTEST_USERS_FILE));
const counts=(process.env.LOADTEST_COUNTS ?? "20,30").split(",").map(Number);
if (counts.some(n=>!Number.isInteger(n)||n<1||n>users.length) || users.some(u=>!u.cookie||!u.threadId) || new Set(users.map(u=>u.cookie)).size!==users.length) throw new Error('Provide enough distinct authenticated users and native threads for every requested concurrency.');
const label=process.argv[2]??'before',duration=Number(process.argv[3]??60000),output=[];
const pct=(xs,p)=>xs.sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]??0;
for(const count of counts){
 const rows=[],start=Date.now(),stop=new AbortController();let streamCount=0,streamErrors=0;
 const streams=users.slice(0,count).map(async(u)=>{try{const r=await fetch(base+'/api/agent/events?threadId='+u.threadId,{headers:{cookie:u.cookie},signal:stop.signal});if(r.status!==200){streamErrors++;return;}streamCount++;for await(const _ of r.body){}}catch(e){if(!stop.signal.aborted)streamErrors++;}});
 await Promise.all(users.slice(0,count).map(async(u,index)=>{let n=0;while(Date.now()-start<duration){const path=n%4===0?'/api/agent/threads':n%4===1?`/api/agent/threads/${u.threadId}/status`:n%4===2?`/api/agent/threads/${u.threadId}/canvas`:`/api/agent/threads/${u.threadId}/image-sessions`;const t=performance.now();try{const r=await fetch(base+path,{headers:{cookie:u.cookie},signal:AbortSignal.timeout(35000)});const body=await r.text();rows.push({kind:n%4,status:r.status,ms:performance.now()-t,bytes:body.length});}catch(e){rows.push({kind:n%4,status:0,ms:performance.now()-t,error:e.name});}n++;await new Promise(r=>setTimeout(r,1000));}}));
 stop.abort();await Promise.all(streams);const elapsed=Date.now()-start;
 const summary={label,users:count,elapsedMs:elapsed,requests:rows.length,rps:rows.length/(elapsed/1000),errors:rows.filter(r=>r.status!==200).length,statuses:rows.reduce((a,r)=>(a[r.status]=(a[r.status]??0)+1,a),{}),p50:pct(rows.map(r=>r.ms),.5),p95:pct(rows.map(r=>r.ms),.95),p99:pct(rows.map(r=>r.ms),.99),streamCount,streamErrors,byEndpoint:[0,1,2,3].map(kind=>{const rs=rows.filter(r=>r.kind===kind);return {kind,count:rs.length,errors:rs.filter(r=>r.status!==200).length,p95:pct(rs.map(r=>r.ms),.95)}})};
 output.push({summary,rows});writeFileSync(`${process.env.LOADTEST_OUTPUT_DIR}/http-${label}.json`,JSON.stringify(output,null,2));console.log(JSON.stringify(summary));
}
