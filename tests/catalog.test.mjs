import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Catalog,describe} from '../skills/hot-pick/scripts/catalog.mjs';
async function fixture(t) {const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-catalog-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const c=new Catalog({cache:dir,fetch:()=>{throw Error('Routing must never fetch');}});await fs.mkdir(c.root,{recursive:true});return c;}
const card=(id,text)=>({id,name:id,repo:'a/b',commit:'a'.repeat(40),blob_sha:'b'.repeat(40),license:'MIT',instructions:text,profile:describe(text),ready:true});
test('small edit routes locally by operation, without popularity overriding relevance',async t=>{const c=await fixture(t);await fs.writeFile(path.join(c.root,'index.json'),JSON.stringify({cards:{ui:card('ui','description: accessibility contrast keyboard\n# Improve focus'),scrape:card('scrape','description: scraping crawler framework')},trends:{},repositories:{}}));const r=await c.route({operations:[{intent:'버튼 키보드 포커스 수정',keywords:['keyboard','focus'],constraints:['preserve existing stack']}]});assert.equal(r.requests,0);assert.equal(r.operations[0].candidates[0].id,'ui');assert.equal(r.status,'candidates_only');assert.ok(await fs.stat(path.join(c.root,'traces',r.trace_id+'.json')));});
test('unknown task abstains, multiple operations get separate candidates',async t=>{const c=await fixture(t);await fs.writeFile(path.join(c.root,'index.json'),JSON.stringify({cards:{ui:card('ui','description: keyboard'),db:card('db','description: postgres')},trends:{}}));const r=await c.route({operations:[{intent:'a',keywords:['keyboard']},{intent:'b',keywords:['postgres']},{intent:'c',keywords:['nonexistent']}]});assert.deepEqual(r.operations.map(o=>o.candidates.map(c=>c.id)),[['ui'],['db'],[]]);});
test('semantic labels require matching version and literal evidence',async t=>{const c=await fixture(t);await fs.writeFile(path.join(c.root,'index.json'),JSON.stringify({cards:{ui:card('ui','description: keyboard')},trends:{}}));const file=path.join(c.root,'labels.json');const label={id:'ui',blob_sha:'b'.repeat(40),situations:['키보드 조작 수정'],inputs:[],outputs:[],constraints:[],evidence:['imagined capability']};await fs.writeFile(file,JSON.stringify([label]));await assert.rejects(c.label(file),/verbatim/);label.evidence=['keyboard'];await fs.writeFile(file,JSON.stringify([label]));await c.label(file);assert.equal((await c.state()).cards.ui.profile.semantic_review.situations[0],'키보드 조작 수정');});
test('incremental sync reuses unchanged descriptions and removes deleted skills',async t=>{const c=await fixture(t);let files=[{type:'blob',path:'skills/a/SKILL.md',sha:'b'.repeat(40),mode:'100644'}],calls=0;Object.assign(c.client,{resolve:async()=>({commit:'a'.repeat(40),license:'MIT'}),tree:async()=>files,blob:async()=>{calls++;return Buffer.from('---\nname: a\ndescription: keyboard\n---');}});const cfg={interval_seconds:600,repositories:['a/b'],trending:[],prewarm:false};await c.sync(cfg);assert.equal(calls,1);await c.sync(cfg);assert.equal(calls,1);files=[];c.client.resolve=async()=>({commit:'c'.repeat(40),license:'MIT'});await c.sync(cfg);assert.equal(Object.keys((await c.state()).cards).length,0);});
test('success cannot be recorded without artifact and check evidence',async t=>{const c=await fixture(t);await fs.writeFile(path.join(c.root,'index.json'),JSON.stringify({cards:{ui:card('ui','description: keyboard')},trends:{}}));const r=await c.route({operations:[{intent:'fix',keywords:['keyboard']}]});const f=path.join(c.root,'outcome.json');await fs.writeFile(f,JSON.stringify({trace_id:r.trace_id,decisions:[{id:'ui',status:'used',reason:'fit'}]}));await assert.rejects(c.record(f),/artifacts/);});
test('support-file changes invalidate prepared readiness without inventing semantic changes',async t=>{const c=await fixture(t);let sha='c'.repeat(40);Object.assign(c.client,{resolve:async()=>({commit:'a'.repeat(40),license:'MIT'}),tree:async()=>[{type:'blob',mode:'100644',path:'s/SKILL.md',sha:'b'.repeat(40)},{type:'blob',mode:'100644',path:'s/reference.md',sha}],blob:async()=>Buffer.from('---\nname: s\ndescription: focus\n---'),prepare:async()=>({entrypoint:'/prepared/SKILL.md'})});const cfg={interval_seconds:600,repositories:['a/b'],trending:[],prewarm:true};await c.sync(cfg);assert.equal((await c.state()).cards['a/b:s/SKILL.md'].ready,true);sha='d'.repeat(40);c.client.resolve=async()=>({commit:'e'.repeat(40),license:'MIT'});await c.sync({...cfg,prewarm:false});assert.equal((await c.state()).cards['a/b:s/SKILL.md'].ready,false);});
test('duplicate copies do not consume multiple candidate slots',async t=>{const c=await fixture(t);const a=card('a','description: keyboard focus'),b={...a,id:'b'};await c.publish({cards:{a,b},trends:{}});const r=await c.route({operations:[{intent:'focus',keywords:['keyboard','focus']}]});assert.equal(r.operations[0].candidates.length,1);});

test('compact routing saves one pinned evidence record across operations', async t => {
  const c = await fixture(t);
  const a = {
    ...card('a/b:focus/SKILL.md', 'description: keyboard focus ' + '한'.repeat(250) +
      '\nUse only with native buttons.\n# Focus\nFull instructions are private to the cache.'),
    skill_path: 'focus/SKILL.md',
    entrypoint: '/prepared/focus/SKILL.md',
    source: 'https://github.com/a/b/blob/' + 'a'.repeat(40) + '/focus/SKILL.md',
    checked_at: '2026-11-07T00:00:00Z',
    stars: 200,
  };
  a.profile.semantic_review = {
    blob_sha: a.blob_sha, situations: ['키보드 포커스'], inputs: [], outputs: [],
    constraints: ['Native buttons only'], evidence: ['Use only with native buttons.'],
  };
  const trend = 'https://github.com/trending?since=weekly';
  const state = {cards: {[a.id]: a}, trends: {[trend]: {checked_at:a.checked_at, repositories:[
    {repo:a.repo, since:'weekly', rank:1, language_filter:'javascript'}
  ]}}};
  await c.publish(state);
  const task = {operations: [
    {intent:'키보드 포커스', keywords:['키보드','포커스'], constraints:['Keep the existing stack']},
    {intent:'focus', keywords:['keyboard','focus']},
  ]};
  const compact = await c.route(task);
  const candidate = compact.operations[0].candidates[0];
  assert.equal(candidate.id, a.id);
  assert.equal(candidate.commit, a.commit);
  assert.equal(candidate.license, a.license);
  assert.equal(candidate.ready, true);
  assert.equal(candidate.reviewed, true);
  assert.equal(candidate.description_truncated, true);
  assert.equal([...candidate.description].length, 240);
  assert.deepEqual(candidate.matched_terms, ['키보드','포커스']);
  assert.deepEqual(compact.operations[0].constraints, ['Keep the existing stack']);
  assert.deepEqual(candidate.trending,{since:'weekly',rank:1,language_filter:'javascript'});
  for (const field of ['profile','entrypoint','stars','instructions']) assert.ok(!Object.hasOwn(candidate, field));
  const expanded = await c.route(task, null, null, true);
  const tracePath = path.join(c.root,'traces',compact.trace_id+'.json');
  const trace = await fs.readFile(tracePath,'utf8');
  assert.deepEqual(Object.keys(JSON.parse(trace).evidence), [a.id]);
  assert.ok(!trace.includes('Full instructions are private'));

  await c.publish({cards: {}, trends: {}});
  const {candidate: detail} = await c.detail(compact.trace_id, a.id);
  assert.deepEqual(detail.profile, a.profile);
  assert.equal(detail.source, a.source);
  assert.equal(detail.blob_sha, a.blob_sha);
  assert.equal(detail.path, a.skill_path);
  assert.equal(detail.entrypoint, a.entrypoint);
  assert.deepEqual(detail.trending, [
    {repo:a.repo, since:'weekly', rank:1, language_filter:'javascript', source:trend, checked_at:a.checked_at}
  ]);
  const {popularity: expandedPopularity, ...expandedCandidate}=expanded.operations[0].candidates[0];
  assert.equal(expandedPopularity.policy,candidate.popularity.policy);
  assert.ok(Math.abs(expandedPopularity.score-candidate.popularity.score)<0.001);
  assert.deepEqual(expandedCandidate, {
    ...detail, matched_terms:candidate.matched_terms, retrieval_score:candidate.retrieval_score
  });
  await assert.rejects(c.detail(compact.trace_id,'__proto__'),/Candidate not found/);
  await assert.rejects(c.detail('../index.json',a.id),/TRACE_ID/);
  await assert.rejects(c.detail('b'.repeat(36),a.id),/trace not found/);

  const outcome = path.join(c.root,'outcome.json');
  await fs.writeFile(outcome, JSON.stringify({trace_id:compact.trace_id, decisions:[
    {id:a.id, status:'used', reason:'Checked pinned source', artifacts:['index.html'], checks:['Focus test passed']}
  ]}));
  assert.equal((await c.record(outcome)).recorded, true);
  assert.deepEqual((await c.detail(compact.trace_id,a.id)).candidate, detail);
});

test('missing catalog and catalog without matches are distinct', async t => {
  const c = await fixture(t);
  const task = {operations:[{intent:'focus',keywords:['keyboard','focus']}]};
  assert.equal((await c.route(task)).status, 'empty_catalog');
  const a = card('a','description: postgres');
  await c.publish({cards:{a},trends:{}});
  assert.equal((await c.route(task)).status, 'no_matches');
});

test('detail reads legacy inline profiles without inventing pins', async t => {
  const c = await fixture(t);
  const trace = 'b'.repeat(36);
  const candidate = {id:'a/b:SKILL.md',commit:'a'.repeat(40),profile:describe('description: keyboard')};
  const alternate = {id:'a/b:alt/SKILL.md',commit:'c'.repeat(40),profile:describe('Use this only with keyboard input.')};
  const tracePath = path.join(c.root,'traces',trace+'.json');
  await fs.mkdir(path.dirname(tracePath));
  await fs.writeFile(tracePath,JSON.stringify({operations:[{candidates:[candidate,alternate]}]}));
  assert.deepEqual((await c.detail(trace,candidate.id)).candidate, candidate);
  const batch = await c.detail(trace,alternate.id,candidate.id);
  assert.deepEqual(batch.candidates.map(c=>[c.id,c.commit]),[
    [alternate.id,alternate.commit], [candidate.id,candidate.commit],
  ]);
  assert.deepEqual(batch.candidates[0].profile.excerpts,[[1,'Use this only with keyboard input.']]);
  assert.ok(batch.candidates.every(c=>!Object.hasOwn(c,'blob_sha')));
});
test('popularity breaks relevance ties but cannot promote weaker matches',async t=>{
 const c=await fixture(t);const date=new Date().toISOString();
 const make=(id,text,stars)=>({...card(id,text),repo:id+'/repo',stars,checked_at:date});
 const strong=make('strong','description: keyboard focus accessibility',1);
 const hot=make('hot','description: keyboard focus',10000);
 const cold=make('cold','description: keyboard focus',10000);
 await fs.writeFile(path.join(c.root,'index.json'),JSON.stringify({cards:{strong,hot,cold},trends:{weekly:{checked_at:date,repositories:[{repo:hot.repo,since:'weekly',rank:1,period_stars:1000,total_stars:10000}]}}}));
 const r=await c.route({operations:[{intent:'keyboard fix',keywords:['keyboard','focus','accessibility']}]});
 assert.deepEqual(r.operations[0].candidates.map(x=>x.id),['strong','hot','cold']);
});
test('explicit task filters reject domain mismatch and diversify repositories',async t=>{
 const c=await fixture(t);
 const a={...card('a','description: ranking scoring ads'),repo:'ads/one'};
 const b={...card('b','description: ranking scoring statistics'),repo:'stats/one'};
 const d={...card('d','description: ranking scoring statistics'),repo:'stats/one'};
 const e={...card('e','description: ranking scoring statistics'),repo:'stats/two'};
 await fs.writeFile(path.join(c.root,'index.json'),JSON.stringify({cards:{a,b,d,e},trends:{}}));
 const task={operations:[{intent:'rank statistically',keywords:['ranking','scoring','statistics'],required_keywords:['statistics'],min_coverage:1,max_per_repo:1,exclude_repos:['STATS/TWO']}]};
 const r=await c.route(task);assert.equal(r.operations[0].candidates.length,1);assert.equal(r.operations[0].candidates[0].id,'b');assert.equal(r.operations[0].eligible_candidates,2);
 task.operations[0].required_keywords=['nonexistent'];assert.equal((await c.route(task)).status,'no_matches');
});
test('invalid routing controls fail explicitly',async t=>{const c=await fixture(t);for(const bad of [{min_coverage:2},{min_coverage:'1'},{max_per_repo:0},{required_keywords:'python'},{exclude_repos:[null]}])await assert.rejects(c.route({operations:[{intent:'x',keywords:['x'],...bad}]}));});
test('unchanged source refreshes legacy folded descriptions without fetching inventory',async t=>{
 const c=await fixture(t),commit='a'.repeat(40),blob_sha='b'.repeat(40),id='a/b:SKILL.md';
 const instructions='---\nname: test\ndescription: >-\n  Exact decimal CSV\n  validation\n---';
 const review={blob_sha,evidence:['Exact decimal CSV'],situations:['money'],inputs:[],outputs:[],constraints:[]};
 await c.publish({schema:1,updated_at:null,cards:{[id]:{id,repo:'a/b',name:'test',commit,blob_sha,instructions,profile:{...describe(instructions),description:'>-',extractor_version:1,semantic_review:review}}},repositories:{'a/b':{commit,inventory_complete:true}},trends:{}});
 Object.assign(c.client,{resolve:async()=>({commit,license:'MIT',stars:100}),tree:()=>assert.fail('unchanged source should use cached instructions')});
 await c.sync({interval_seconds:600,repositories:['a/b'],trending:[],include_observed:false});
 const profile=(await c.state()).cards[id].profile;assert.equal(profile.description,'Exact decimal CSV validation');assert.equal(profile.extractor_version,2);assert.deepEqual(profile.semantic_review,review);
});

test('missing domain terms explain abstention and fallback searches only explicit public queries',async t=>{
 const c=await fixture(t);await c.publish({cards:{ui:card('ui','description: keyboard focus')},trends:{}});
 const task={operations:[{intent:'private original request',keywords:['phoneme'],required_keywords:['phoneme'],discovery_queries:['phonological features']},{intent:'second need',keywords:['articulatory'],required_keywords:['articulatory'],discovery_queries:['phonological features']},{intent:'covered',keywords:['keyboard'],discovery_queries:['must never search']}]};
 const r=await c.route(task);assert.deepEqual(r.operations[0].diagnostic.missing_required_terms,['phoneme']);assert.deepEqual(r.operations[0].keywords,['phoneme']);
 const calls=[];c.client.discover=async q=>{calls.push(q);return {candidates:[{repo:'dmort27/panphon',license:'MIT',trending:null}],trending_source:'https://github.com/trending?since=weekly'};};
 await c.discoverMissing(r,task);assert.deepEqual(calls,['phonological features']);assert.equal(r.operations[0].candidates.length,0);assert.equal(r.operations[0].discovery.candidates[0].id,'dmort27/panphon');assert.equal(r.operations[0].discovery.catalog_filters_relaxed,false);assert.deepEqual(r.coverage,{catalog_matched:1,discovery_leads:2,unresolved:0});
 const saved=JSON.parse(await fs.readFile(path.join(c.root,'traces',r.trace_id+'.json')));assert.equal(saved.operations[0].discovery.status,'inspection_required');
 const f=path.join(c.root,'outcome.json');const decision={id:'dmort27/panphon',status:'used',reason:'Applied verified data',artifacts:['result.json'],checks:['comparison verified']};await fs.writeFile(f,JSON.stringify({trace_id:r.trace_id,decisions:[decision]}));await assert.rejects(c.record(f),/source.commit/);
 decision.source={repo:'dmort27/panphon',commit:'a'.repeat(40)};await fs.writeFile(f,JSON.stringify({trace_id:r.trace_id,decisions:[decision]}));assert.equal((await c.record(f)).recorded,true);
});
test('fallback without public queries does not transmit intent; failures and exclusions stay explicit',async t=>{
 const c=await fixture(t);await c.publish({cards:{ui:card('ui','description: keyboard')},trends:{}});
 const task={operations:[{intent:'private',keywords:['phoneme']}]};const r=await c.route(task);c.client.discover=()=>{throw Error('must not search');};await c.discoverMissing(r,task);assert.equal(r.operations[0].discovery.status,'needs_public_queries');
 task.operations[0].discovery_queries=['phonetics'];const failing=await c.route(task);await c.discoverMissing(failing,task);assert.equal(failing.operations[0].discovery.searches[0].error,'discovery_failed');assert.equal(failing.status,'no_matches');
 task.operations[0].exclude_repos=['DMORT27/PANPHON'];const filtered=await c.route(task);c.client.discover=async()=>({candidates:[{repo:'dmort27/panphon',license:'MIT'},{repo:'x/y',license:null}]});await c.discoverMissing(filtered,task);assert.equal(filtered.operations[0].discovery.candidates.length,0);
});
test('fallback is bounded before any search and rejects malformed public queries',async t=>{
 const c=await fixture(t);let calls=0;c.client.discover=async()=>{calls++;};
 for(const queries of [['a','b','c'],[null],['x'.repeat(201)]]){const task={operations:[{intent:'x',keywords:['absent'],discovery_queries:queries}]};await assert.rejects(c.discoverMissing(await c.route(task),task),/discovery_queries/);}
 const task={operations:Array.from({length:5},(_,i)=>({intent:'x',keywords:['absent'],discovery_queries:['q'+i]}))};await assert.rejects(c.discoverMissing(await c.route(task),task),/four/);assert.equal(calls,0);
});
