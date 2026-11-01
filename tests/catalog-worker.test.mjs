import test from 'node:test';
import assert from 'node:assert/strict';
import {runWorker} from '../scripts/catalog-worker.mjs';

test('operator worker stops publication after collection or export failure',()=>{
  for(const statuses of [[1],[0,1],[0,0,1]]) {
    let called=0;
    const result=runWorker('/fixture/config.json',{environment:{HOT_PICK_FIREBASE_PROJECT:'test-project'},getGithubToken:()=> 'fixture',run:()=>({status:statuses[called++]})});
    assert.equal(result,1);assert.equal(called,statuses.length);
  }
});
test('publishing is opt-in and does not inherit the collector GitHub credential',()=>{
  for(const enabled of [false,true]) {
    const calls=[];
    const result=runWorker('/fixture/config.json',{environment:{...(enabled?{HOT_PICK_FIREBASE_PROJECT:'test-project'}:{}),GH_TOKEN:'old-token'},getGithubToken:()=> 'fixture',run:(_command,args,options)=>{calls.push({args,env:options.env});return {status:0};}});
    assert.equal(result,0);assert.equal(calls.length,enabled?3:1);
    assert.equal(calls[0].env.GITHUB_TOKEN,'fixture');
    for(const {env} of calls.slice(1)) {assert.equal(env.GITHUB_TOKEN,undefined);assert.equal(env.GH_TOKEN,undefined);}
  }
});
