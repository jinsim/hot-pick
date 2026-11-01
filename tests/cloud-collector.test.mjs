import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Catalog,describe} from '../skills/hot-pick/scripts/catalog.mjs';
import {bootstrap,prune} from '../service/cloud-state.mjs';

async function fixture(t) {
  const cache=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-cloud-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  const c=new Catalog({cache});
  let commit='a'.repeat(40),blobs=0,trees=0;
  const entries=Array.from({length:3},(_,i)=>({type:'blob',mode:'100644',path:`s${i}/SKILL.md`,sha:String(i+1).repeat(40)}));
  Object.assign(c.client,{resolve:async()=>({commit,license:'MIT',stars:12}),tree:async()=>{trees++;return entries;},blob:async()=>{blobs++;return Buffer.from('description: keyboard focus');}});
  const cfg={interval_seconds:1800,repositories:['a/b'],trending:[],prewarm:false};
  return {cache,c,entries,cfg,counters:()=>({blobs,trees}),changeCommit:()=>{commit='b'.repeat(40);}};
}
test('complete unchanged commits skip inventory; new commits reuse unchanged source blobs',async t=>{
  const {c,cfg,counters,changeCommit}=await fixture(t);
  await c.sync(cfg);const first=counters();
  const warm=await c.sync(cfg);
  assert.deepEqual(counters(),first);assert.equal(warm.unchanged_repositories,1);assert.equal(warm.processed,0);
  changeCommit();await c.sync(cfg);
  assert.equal(counters().trees,first.trees+1);assert.equal(counters().blobs,first.blobs);
});
test('bounded inventories resume until complete instead of skipping an unfinished commit',async t=>{
  const {c,cfg,counters}=await fixture(t);
  const bounded={...cfg,max_skills_per_repository:2};
  const first=await c.sync(bounded);
  assert.equal(first.deferred[0].reason,'skill_batch_limit');assert.equal(Object.keys((await c.state()).cards).length,2);
  await c.sync(bounded);
  assert.equal(Object.keys((await c.state()).cards).length,3);
  assert.equal((await c.state()).repositories['a/b'].inventory_complete,true);
  const before=counters();await c.sync(bounded);assert.deepEqual(counters(),before);
});
test('a metadata-only seed hydrates instructions and retains version-matched review data',async t=>{
  const {c,cfg,entries}=await fixture(t);
  const id='a/b:s0/SKILL.md',profile=describe('description: keyboard focus');
  profile.semantic_review={blob_sha:entries[0].sha,evidence:['keyboard'],situations:['키보드'],inputs:[],outputs:[],constraints:[]};
  await c.publish({schema:1,cards:{[id]:{id,repo:'a/b',name:'s0',commit:'a'.repeat(40),blob_sha:entries[0].sha,profile}},repositories:{},trends:{}});
  await c.sync(cfg);
  const card=(await c.state()).cards[id];
  assert.equal(card.instructions,'description: keyboard focus');assert.deepEqual(card.profile,profile);
});
test('bootstrap preserves published coverage, refuses private fields, and does not fetch for a warm index',async t=>{
  const {cache,c,cfg}=await fixture(t);await c.sync(cfg);
  const {publicSnapshot}=await import('../skills/hot-pick/scripts/catalog-snapshot.mjs');
  const state=publicSnapshot(await c.state());
  const server=createServer((_req,res)=>res.end(JSON.stringify(state)));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
  const url=`http://127.0.0.1:${server.address().port}`,fresh=path.join(cache,'fresh');
  assert.equal((await bootstrap(fresh,url)).cards,3);
  assert.deepEqual(await bootstrap(fresh,'https://should-not-fetch.invalid'),{seeded:false});
  state.private_token='forbidden';
  await assert.rejects(bootstrap(path.join(cache,'invalid'),url),/Invalid public snapshot/);
});
test('cache pruning keeps the index and bounds only re-downloadable public files',async t=>{
  const {cache,c,cfg}=await fixture(t);await c.sync(cfg);
  await fs.mkdir(path.join(cache,'blobs'),{recursive:true});
  await fs.writeFile(path.join(cache,'blobs','a'.repeat(40)),Buffer.alloc(300));
  const size=(await fs.stat(path.join(c.root,'index.json'))).size;
  const result=await prune(cache,size+100);
  assert.equal(result.removed,1);assert.equal(result.bytes,size);assert.ok(await c.state());
});
