import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {publicSnapshot,catalogURL} from '../skills/hot-pick/scripts/catalog-snapshot.mjs';
import {catalogCommand} from '../skills/hot-pick/scripts/catalog.mjs';
const source=()=>({schema:1,cards:{a:{id:'a',repo:'example/ui',name:'ui',commit:'a'.repeat(40),blob_sha:'b'.repeat(40),skill_path:'SKILL.md',license:'MIT',entrypoint:'/Users/private/SKILL.md',ready:true,instructions:'private local data',profile:{description:'keyboard focus',situations:[],outputs:[],headings:[]}}},trends:{},traces:['private user task']});
test('publication strips local readiness, paths, raw instructions and private traces',()=>{const s=publicSnapshot(source());const text=JSON.stringify(s);assert.ok(!text.includes('/Users/'));assert.ok(!text.includes('private'));assert.ok(!text.includes('entrypoint'));assert.equal(s.cards['example/ui:SKILL.md'].source,`https://github.com/example/ui/blob/${'a'.repeat(40)}/SKILL.md`);});
test('remote pins and URL transport are validated',()=>{const s=source();s.cards.a.commit='main';assert.throws(()=>publicSnapshot(s),/pin/);assert.throws(()=>catalogURL('http://catalog.example/x'));assert.throws(()=>catalogURL('https://user:secret@catalog.example/x'));assert.equal(catalogURL('http://127.0.0.1:7654/v1/catalog'),'http://127.0.0.1:7654/v1/catalog');});
test('remote catalog is fetched once, routes locally, then works offline without sending task content or credentials',async t=>{const cache=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-remote-'));t.after(()=>fs.rm(cache,{recursive:true,force:true}));const file=path.join(cache,'task.json');await fs.writeFile(file,JSON.stringify({operations:[{intent:'private task content',keywords:['keyboard','focus']}]}));let count=0;const opts={cache,file,'catalog-url':'https://api.github.com/catalog',fetch:async(url,init)=>{count++;assert.equal(init.headers.Authorization,undefined);assert.equal(init.body,undefined);assert.ok(!url.includes('private'));return new Response(JSON.stringify(publicSnapshot(source())),{headers:{ETag:'"v1"'}});}};
const a=await catalogCommand('catalog-route',[],opts);assert.equal(a.requests,1);assert.equal(a.operations[0].candidates[0].name,'ui');assert.equal(a.operations[0].candidates[0].entrypoint,undefined);const b=await catalogCommand('catalog-route',[],opts);assert.equal(b.requests,0);await catalogCommand('catalog-route',[],{...opts,offline:true,fetch:()=>{throw Error('network forbidden');}});assert.equal(count,1);});
test('expiry revalidates with ETag and 304 reuses snapshot',async t=>{const cache=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-etag-'));t.after(()=>fs.rm(cache,{recursive:true,force:true}));const file=path.join(cache,'task.json');await fs.writeFile(file,JSON.stringify({operations:[{intent:'focus',keywords:['focus']}]}));let count=0,now=1000;const opts={cache,file,ttl:1,now:()=>now,'catalog-url':'https://catalog.example/v1/catalog',fetch:async(url,init)=>{if(count++===0)return new Response(JSON.stringify(publicSnapshot(source())),{headers:{etag:'"v1"'}});assert.equal(init.headers['If-None-Match'],'"v1"');return new Response(null,{status:304});}};await catalogCommand('catalog-route',[],opts);now+=2000;const r=await catalogCommand('catalog-route',[],opts);assert.equal(r.requests,1);assert.equal(r.operations[0].candidates[0].name,'ui');});
test('connection survives a fresh client instance without environment setup',async t=>{const cache=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-connected-'));t.after(()=>fs.rm(cache,{recursive:true,force:true}));const file=path.join(cache,'task.json');await fs.writeFile(file,JSON.stringify({operations:[{intent:'focus',keywords:['focus']}]}));await catalogCommand('catalog-connect',[],{cache,'catalog-url':'https://catalog.example/catalog.json'});const result=await catalogCommand('catalog-route',[],{cache,file,fetch:async url=>{assert.equal(url,'https://catalog.example/catalog.json');return new Response(JSON.stringify(publicSnapshot(source())));}});assert.equal(result.operations[0].candidates[0].name,'ui');});

test('remote detail needs only the saved trace and exposes no private snapshot fields', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-detail-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  const file = path.join(cache,'task.json');
  await fs.writeFile(file,JSON.stringify({operations:[{intent:'focus',keywords:['focus']}]}));
  const snapshot = source();
  snapshot.cards.a.profile.constraints = [
    {line:5,text:'Do not change keyboard behavior.'},
    {line:6,text:'Use /Users/private/a'},
  ];
  const route = await catalogCommand('catalog-route',[],{
    cache,file,'catalog-url':'https://catalog.example/catalog.json',
    fetch:async()=>new Response(JSON.stringify(snapshot))
  });
  await fs.rm(path.join(cache,'http'),{recursive:true});
  const {candidate} = await catalogCommand('catalog-detail',['example/ui:SKILL.md'],{
    cache,trace:route.trace_id,offline:true,
    fetch:()=>assert.fail('Detail fetched a remote resource')
  });
  assert.deepEqual(candidate.profile.constraints,[{line:5,text:'Do not change keyboard behavior.'}]);
  assert.equal(candidate.blob_sha,snapshot.cards.a.blob_sha);
  assert.equal(candidate.entrypoint,undefined);
  assert.equal(candidate.ready,undefined);
  assert.equal(candidate.instructions,undefined);
});
