import test from 'node:test';import assert from 'node:assert/strict';import {splitCatalog,validateIndex,terms,hash} from '../skills/hot-pick/scripts/catalog-index.mjs';
import {Catalog} from '../skills/hot-pick/scripts/catalog.mjs';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const repo='example/tools',skill_path='SKILL.md',id=`${repo}:${skill_path}`;
const c={repo,skill_path,id,name:'keyboard',commit:'a'.repeat(40),blob_sha:'b'.repeat(40),license:'MIT',profile:{description:'keyboard focus '.repeat(80),situations:[{line:1,text:'keyboard support'}],outputs:[],headings:[],inputs:[],constraints:[]}};
const snapshot={schema:1,updated_at:null,cards:{[id]:c},trends:{}};
test('index preserves matching terms and full detail is content addressed',()=>{const {index,files}=splitCatalog(snapshot);assert.deepEqual(index.cards[id].search_terms,terms(c));assert.ok(files['/index.json'].length<JSON.stringify(snapshot).length);const h=index.cards[id].detail_hash;assert.equal(hash(files[`/details/${h}.json`]),h);assert.deepEqual(validateIndex(index).cards[id].search_terms,terms(c));assert.throws(()=>validateIndex({...index,cards:{[id]:{...index.cards[id],detail_hash:'bad'}}}));});
test('lazy detail loads only chosen evidence, then works offline and rejects corruption',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'hp-lazy-'));t.after(()=>rm(dir,{recursive:true,force:true}));const {index,files}=splitCatalog(snapshot);let calls=0;
 const catalog=new Catalog({cache:dir,fetch:async(url,init)=>{calls++;assert.equal(init.headers.Authorization,undefined);return new Response(files[new URL(url).pathname]);}});
 const task={operations:[{intent:'keyboard',keywords:['keyboard','focus']}]};
 const r=await catalog.route(task,validateIndex(index),'https://example.org/index.json');assert.equal(calls,0);
 const detail=await catalog.detail(r.trace_id,id);assert.equal(calls,1);assert.equal(detail.candidate.profile.description,c.profile.description);
 catalog.client.offline=true;await catalog.detail(r.trace_id,id);assert.equal(calls,1);
 const bad=new Catalog({cache:await mkdtemp(path.join(dir,'bad-')),fetch:async()=>new Response('{}')});const trace=await bad.route(task,validateIndex(index),'https://example.org/index.json');await assert.rejects(bad.detail(trace.trace_id,id),/checksum/);
});
