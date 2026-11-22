// Documented Workers API fallback when cf's installed build delegate is unavailable.
// Credentials come only from the operator's environment and are never printed.
import {promises as fs} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export async function configureWorker({account,token,dispatchToken,freePlanVerified,fetchImpl=fetch}={}) {
 if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
 if(freePlanVerified!==true)throw Error('Verify Workers Free first; do not enable a paid plan');
 const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/hot-pick-health`;
 async function call(url,method,body,allowMissing=false){
  const r=await fetchImpl(url,{method,headers:{Authorization:'Bearer '+token,...(typeof body==='string'?{'Content-Type':'application/json'}:{})},body});
  if(allowMissing&&r.status===404)return null;
  const d=await r.json();if(!r.ok||!d.success)throw Error(`Cloudflare ${method} request failed (HTTP ${r.status}; codes ${(d.errors||[]).map(e=>e.code).join(',')})`);
  return d.result;
 }
 const existing=await call(base+'/secrets','GET',undefined,true);
 if(!dispatchToken&&!existing?.some(b=>b.name==='HOT_PICK_DISPATCH_TOKEN'&&b.type==='secret_text'))throw Error('A new Worker requires HOT_PICK_DISPATCH_TOKEN; existing encrypted credentials can be reused');
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-11-21',keep_bindings:['secret_text'],observability:{enabled:true,head_sampling_rate:1,logs:{enabled:true,invocation_logs:true}}})],{type:'application/json'}));
 for(const name of ['worker.mjs','scheduler.mjs'])form.set(name,new Blob([await fs.readFile(new URL('./'+name,import.meta.url))],{type:'application/javascript+module'}),name);
 const result=await call(base,'PUT',form);
 if(dispatchToken)await call(base+'/secrets','PUT',JSON.stringify({name:'HOT_PICK_DISPATCH_TOKEN',type:'secret_text',text:dispatchToken}));
 const secrets=await call(base+'/secrets','GET');
 if(!secrets?.some(b=>b.name==='HOT_PICK_DISPATCH_TOKEN'&&b.type==='secret_text'))throw Error('Secret is missing after upload; cron was not enabled');
 await call(base+'/subdomain','POST',JSON.stringify({enabled:true,previews_enabled:false}));
 await call(base+'/schedules','PUT',JSON.stringify([{cron:'0,30 * * * *'}]));
 return {worker:'hot-pick-health',deployed:true,cron:'0,30 * * * *',credential_reused:!dispatchToken,usage_model:result.usage_model};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await configureWorker({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,dispatchToken:process.env.HOT_PICK_DISPATCH_TOKEN,freePlanVerified:process.env.HOT_PICK_FREE_PLAN_VERIFIED==='true'})));}
 catch(e){console.error(e.message);process.exitCode=1;}
}
