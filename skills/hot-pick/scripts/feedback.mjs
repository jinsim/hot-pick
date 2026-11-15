import {promises as fs} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function feedback(options={}) {
 if(!['improved','same','worse','unknown'].includes(options.helpfulness))throw Error('Set --helpfulness improved|same|worse|unknown');
 if(!['completed','failed','abandoned'].includes(options.outcome))throw Error('Set --outcome completed|failed|abandoned');
 const packet={schema:1,consent_public:true,purpose:options.test?'test':'real_task',task_id:randomUUID(),outcome:options.outcome,helpfulness:options.helpfulness,evidence:'self_report',checks_passed:0,checks_total:0};
 if(options.file){
 const stat=await fs.stat(options.file);if(!stat.isFile()||stat.size>2*1024*1024)throw Error('Receipt must be a regular file under 2 MiB');
 const receipt=JSON.parse(await fs.readFile(options.file,'utf8'));
 if(receipt.schema!==1||!['checks_passed','failed'].includes(receipt.status)||!Array.isArray(receipt.checks)||!receipt.checks.length||!/^\w{64}$/.test(receipt.plan_sha256))throw Error('Expected an apply receipt with completed checks and plan hash');
 packet.task_id=receipt.plan_sha256.slice(0,8)+'-'+receipt.plan_sha256.slice(8,12)+'-'+receipt.plan_sha256.slice(12,16)+'-'+receipt.plan_sha256.slice(16,20)+'-'+receipt.plan_sha256.slice(20,32);
 packet.evidence='local_receipt';packet.checks_total=receipt.checks.length;packet.checks_passed=receipt.checks.filter(c=>c.exit_code===0&&!c.stopped).length;
 }
 const body='Voluntary public task outcome. No prompts, paths, command output, credentials, or artifacts are included.\n\n```json\n'+JSON.stringify(packet,null,2)+'\n```';
 const url=new URL('https://github.com/jinsim/hot-pick/issues/new');url.searchParams.set('title',options.test?'[Usage] internal monitoring test':'[Usage] task outcome');url.searchParams.set('body',body);
 return {packet,body,review_url:url.href,submitted:false,note:'Review the exact public fields. Opening this URL and submitting is optional; this command sends no network request. Bots and owner reports do not count as external use.'};
}
