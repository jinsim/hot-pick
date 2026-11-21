// Minimal documented Workers API fallback when cf's installed build delegate is unavailable.
// No credential file is read here. Supply an account-scoped API token through the environment.
import {promises as fs} from 'node:fs';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const dispatchToken=process.env.HOT_PICK_DISPATCH_TOKEN;
if(!dispatchToken)throw Error('Set HOT_PICK_DISPATCH_TOKEN to a hot-pick-only Actions:write token before enabling cron');
if(!/^[a-f0-9]{32}$/.test(account||'')||!token)throw Error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');
if(process.env.HOT_PICK_FREE_PLAN_VERIFIED!=='true')throw Error('Verify Workers Free in the account dashboard first. Do not enable a paid plan.');
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
async function call(url,method,body){const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(typeof body==='string'?{'Content-Type':'application/json'}:{})},body});const d=await r.json();if(!r.ok||!d.success)throw Error(JSON.stringify({status:r.status,errors:d.errors}));return d.result;}
const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'worker.mjs',compatibility_date:'2026-11-21',usage_model:'bundled'})],{type:'application/json'}));form.set('scheduler.mjs',new Blob([await fs.readFile(new URL('./scheduler.mjs',import.meta.url))],{type:'application/javascript+module'}),'scheduler.mjs');form.set('worker.mjs',new Blob([await fs.readFile(new URL('./worker.mjs',import.meta.url))],{type:'application/javascript+module'}),'worker.mjs');
const result=await call(base+'/scripts/hot-pick-health','PUT',form);
await call(base+'/scripts/hot-pick-health/subdomain','POST',JSON.stringify({enabled:true,previews_enabled:false}));
await call(base+'/scripts/hot-pick-health/secrets','PUT',JSON.stringify({name:'HOT_PICK_DISPATCH_TOKEN',type:'secret_text',text:dispatchToken}));
await call(base+'/scripts/hot-pick-health/schedules','PUT',JSON.stringify([{cron:'0,30 * * * *'}]));
console.log(JSON.stringify({worker:'hot-pick-health',deployed:true,cron:'0,30 * * * *',usage_model:result.usage_model}));
