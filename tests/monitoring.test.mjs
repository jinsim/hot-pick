import test from 'node:test';import assert from 'node:assert/strict';
import {health,usage} from '../monitoring/metrics.mjs';import {feedback} from '../skills/hot-pick/scripts/feedback.mjs';
import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
const good={updated_at:'2026-11-21T01:00:00Z',cards:{one:{}}};const now=Date.parse('2026-11-21T01:10:00Z');
test('health detects stale/missing/failed/empty and recovers',()=>{
 assert.equal(health(good,[{status:'completed',conclusion:'success'}],now).healthy,true);
 assert.equal(health(good,[],now+3*3600000).healthy,false);
 assert.equal(health(null,[],now).healthy,false);
 assert.equal(health({...good,cards:{}},[],now).healthy,false);
 assert.equal(health(good,[{id:1,status:'completed',conclusion:'failure'}],now).healthy,false);
});
test('only voluntary external real-task reports count; deduplicate author/task, not CI clones',async()=>{
 const f=await feedback({helpfulness:'improved',outcome:'completed'});
 const issue={title:'[Usage] task outcome',body:f.body,user:{login:'external',type:'User'},labels:[]};
 const result=usage([issue,issue,{...issue,user:{login:'jinsim',type:'User'}},{...issue,user:{login:'robot[bot]',type:'Bot'}},{...issue,labels:[{name:'internal-test'}]},{...issue,body:'malformed'}, {...issue,body:(await feedback({helpfulness:'worse',outcome:'failed',test:true})).body}]);
 assert.equal(result.external_reporting_accounts,1);assert.equal(result.reports,1);assert.equal(result.improved,1);assert.equal(result.excluded,6);
});
test('feedback is local, opt-in and excludes private receipt fields; equivalent tasks deduplicate',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hp-feedback-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'receipt.json');
 await fs.writeFile(file,JSON.stringify({schema:1,status:'checks_passed',plan_sha256:'a'.repeat(64),task:'private task',checks:[{name:'private path',exit_code:0,stdout:'SECRET'}],artifacts:[{path:'/Users/private'}]}));
 const a=await feedback({file,helpfulness:'same',outcome:'completed'});const b=await feedback({file,helpfulness:'same',outcome:'completed'});
 assert.equal(a.packet.task_id,b.packet.task_id);assert.equal(a.packet.checks_passed,1);assert.equal(a.submitted,false);assert.doesNotMatch(a.body,/SECRET|private task|private path|\/Users/);
 await assert.rejects(feedback({helpfulness:'yes',outcome:'completed'}));
});

import worker,{check} from '../monitoring/health/worker.mjs';
test('independent endpoint returns stale/unavailable failure and explicit drill status',async()=>{
 const fresh=()=>Promise.resolve(Response.json(good));
 assert.equal((await check(fresh,now)).healthy,true);
 assert.equal((await check(fresh,now+3*3600000)).healthy,false);
 assert.equal((await check(async()=>{throw Error('offline');},now)).healthy,false);
 assert.equal((await worker.fetch(new Request('https://health.example/test-failure'))).status,503);
 assert.equal((await worker.fetch(new Request('https://health.example/unknown'))).status,404);
});
