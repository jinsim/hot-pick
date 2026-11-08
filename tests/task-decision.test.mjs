import test from 'node:test';import assert from 'node:assert/strict';import {directDecision} from '../skills/hot-pick/scripts/task-decision.mjs';
test('direct work requires an explicit caller decision and verification plan',()=>{assert.equal(directDecision({}),null);assert.equal(directDecision({external_help:{needed:true}}),null);const d=directDecision({external_help:{needed:false,reason:'Existing code and tests suffice',checks:['Boundary inputs']}});assert.equal(d.external_project_used,false);assert.equal(d.trust,'caller_assessment');assert.deepEqual(d.planned_checks,['Boundary inputs']);for(const external_help of [false,{needed:'false'},{needed:false,reason:'',checks:['x']},{needed:false,reason:'x',checks:[]}])assert.throws(()=>directDecision({external_help}));});
import {catalogCommand} from '../skills/hot-pick/scripts/catalog.mjs';
import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';
test('direct route records intent without reading catalog or making any HTTP request',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hp-direct-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'task.json');
 await fs.writeFile(file,JSON.stringify({operations:[{intent:'Fix boundary math'}],external_help:{needed:false,reason:'Known local function and explicit boundary checks',checks:['empty, last page, invalid inputs']}}));
 const r=await catalogCommand('catalog-route',[],{file,cache:dir,'catalog-url':'https://invalid.example/index.json',fetch:()=>assert.fail('direct work must not fetch')});
 assert.equal(r.status,'direct_work');assert.equal(r.requests,0);assert.equal(r.decision.external_project_used,false);
 const saved=JSON.parse(await fs.readFile(path.join(dir,'task-catalog/traces',r.trace_id+'.json')));assert.equal(saved.decision.trust,'caller_assessment');assert.deepEqual(saved.evidence,{});
});
