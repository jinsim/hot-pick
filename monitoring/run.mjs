import {execFileSync} from 'node:child_process';
import {promises as fs} from 'node:fs';
import {health,usage,credentialWarning} from './metrics.mjs';
const repository='jinsim/hot-pick';
function api(endpoint,method='GET',data){return JSON.parse(execFileSync('gh',['api',endpoint,'--method',method,...(data?['--input','-']:[])],{input:data?JSON.stringify(data):undefined,encoding:'utf8',maxBuffer:8*1024*1024}));}
async function pages(endpoint,key){let all=[];for(let page=1;page<=20;page++){const r=api(endpoint+(endpoint.includes('?')?'&':'?')+`per_page=100&page=${page}`);const list=key?r[key]:r;all.push(...list);if(list.length<100)return all;}throw Error('Pagination bound exceeded; refusing incomplete metrics');}
const issues=await pages(`repos/${repository}/issues?state=all`);
const runs=api(`repos/${repository}/actions/workflows/catalog.yml/runs?per_page=10`).workflow_runs;
let index,availability_error;
try{const r=await fetch('https://jinsim-hot-pick.web.app/index.json',{signal:AbortSignal.timeout(20000),cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);index=await r.json();}catch(e){availability_error=e.message;}
const report={checked_at:new Date().toISOString(),health:health(index,runs),usage:usage(issues)};
report.external_scheduler=JSON.parse(await fs.readFile(new URL('./scheduler.json',import.meta.url),'utf8'));
const expiryWarning=credentialWarning(report.external_scheduler.credential_expires_on);
if(expiryWarning)report.health.problems.push(expiryWarning);
if(availability_error)report.health.problems.push('Public index unavailable: '+availability_error);
report.health.healthy=!report.health.problems.length;
// workflow_run can catch a just-failed run even when another run has already succeeded.
if(process.env.FAILED_RUN_URL){report.health.healthy=false;report.health.problems.push('Collector failed: '+process.env.FAILED_RUN_URL);}
if(process.env.EXTERNAL_SCHEDULER_FAILURE==='true'){report.health.healthy=false;report.health.problems.push('External scheduler could not dispatch the collector; inspect Cloudflare invocation logs');}
if(process.env.MONITOR_DRILL==='true'){report.simulation=true;report.health.healthy=process.env.MONITOR_DRILL_RECOVERY==='true';report.health.problems=report.health.healthy?[]:['TEST ONLY: simulated scheduler/publication failure and stale catalog'];}
for(const kind of ['views','clones']){try{report[kind]=api(`repos/${repository}/traffic/${kind}`);}catch{report[kind]={available:false,reason:'GitHub token lacks traffic permission; not zero usage'};}}
const drill=process.env.MONITOR_DRILL==='true';const title=drill?'[Monitor test] alert delivery drill':'[Monitor] catalog unhealthy';
const trusted=i=>['jinsim','github-actions[bot]'].includes(i.user?.login)&&!i.pull_request;
const existing=issues.find(i=>i.title===title&&trusted(i));
const details='<!-- hot-pick-monitor -->\n'+(drill?'**SIMULATION — excluded from usage metrics.**\n':'')+'@jinsim\n\n'+report.health.problems.map(p=>'- '+p).join('\n')+'\n\n```json\n'+JSON.stringify(report,null,2)+'\n```';
let alert;
if(!report.health.healthy){if(existing){alert=api(`repos/${repository}/issues/${existing.number}`,'PATCH',{body:details,state:'open'});if(existing.state==='closed')api(`repos/${repository}/issues/${existing.number}/comments`,'POST',{body:'@jinsim Alert reopened: '+report.health.problems.join('; ')});}else alert=api(`repos/${repository}/issues`,'POST',{title,body:details,assignees:['jinsim']});}
else if(existing?.state==='open'){api(`repos/${repository}/issues/${existing.number}/comments`,'POST',{body:'Recovered at '+report.checked_at+'. Live index and latest completed publication are healthy.'});api(`repos/${repository}/issues/${existing.number}`,'PATCH',{state:'closed',state_reason:'completed'});}
const dashboardTitle='[Monitor] operational and usage dashboard';const dashboard=issues.find(i=>i.title===dashboardTitle&&trusted(i));
const dashboardBody='<!-- hot-pick-dashboard -->\nAutomated best-effort monitor. No LLM or paid service.\n\n'+
 'Usage counts exclude owner/bot/test/duplicate reports. GitHub traffic includes CI/bots and is **not** a user count. Reporting accounts are opt-in, not verified people. Task usefulness is self-reported; no causal quality claim.\n\n```json\n'+JSON.stringify(report,null,2)+'\n```';
let saved;
if(!drill){saved=dashboard?api(`repos/${repository}/issues/${dashboard.number}`,'PATCH',{body:dashboardBody}):api(`repos/${repository}/issues`,'POST',{title:dashboardTitle,body:dashboardBody});
// One snapshot per UTC day remains in issue comments after Actions artifact expiry.
const comments=await pages(`repos/${repository}/issues/${saved.number}/comments`);
const marker='<!-- daily '+report.checked_at.slice(0,10)+' -->';if(!comments.some(c=>c.body?.startsWith(marker)))api(`repos/${repository}/issues/${saved.number}/comments`,'POST',{body:marker+'\n```json\n'+JSON.stringify(report,null,2)+'\n```'});
}
await fs.mkdir('.hot-pick/monitor',{recursive:true});await fs.writeFile('.hot-pick/monitor/latest.json',JSON.stringify({...report,alert_url:alert?.html_url,dashboard_url:saved?.html_url},null,2));
if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,'\n```json\n'+JSON.stringify(report,null,2)+'\n```\n');
console.log(JSON.stringify({healthy:report.health.healthy,alert_url:alert?.html_url,dashboard_url:saved?.html_url,usage:report.usage}));
