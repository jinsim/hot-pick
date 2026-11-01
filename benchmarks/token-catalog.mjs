import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const [snapshotPath, baselinePath, python = 'python3'] = process.argv.slice(2);
if (!snapshotPath || !baselinePath) {
  throw Error('Usage: node benchmarks/token-catalog.mjs SNAPSHOT_JSON BASELINE_CLI [PYTHON_WITH_TIKTOKEN]');
}
const cli = fileURLToPath(new URL('../skills/hot-pick/scripts/hot-pick.mjs', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const op = (intent, keywords, constraints) => ({intent,keywords,constraints:[constraints]});
const cases = [
  ['keyboard-focus','ko',[op('버튼의 키보드 포커스 수정',['accessibility','keyboard','focus'],'현재 CSS 구조 유지')]],
  ['react-performance','en',[op('Reduce React rerenders',['react','performance','rerender'],'Preserve component API')]],
  ['postgres-migration','ko',[op('PostgreSQL 스키마 마이그레이션 검토',['postgres','database','migration'],'데이터를 유지하고 롤백 가능해야 함')]],
  ['spreadsheet','en',[op('Audit spreadsheet formulas',['spreadsheet','xlsx','formulas'],'Keep existing workbook layout')]],
  ['python-lint','ko',[op('Python 저장소의 lint 설정 검토',['python','ruff','linting'],'의존성을 추가하지 않음')]],
  ['kubernetes','en',[op('Check Kubernetes deployment manifests',['kubernetes','deployment','manifest'],'Keep rollout semantics')]],
  ['incident-response','en',[op('Draft an incident response runbook',['incident','runbook','response'],'Include operator steps')]],
  ['cloudflare-security','ko',[op('Cloudflare Workers 보안 점검',['cloudflare','workers','security'],'읽기 전용 감사')]],
  ['pdf-tables','ko',[op('PDF 표를 CSV로 추출',['pdf','extract','tables','csv'],'원본 파일 변경 금지')]],
  ['two-operations','en',[
    op('Set up GitHub Actions for unit tests',['github','actions','workflow','test'],'Local checks first'),
    op('Review API design for a REST endpoint',['api','rest','design'],'Keep existing public contracts'),
  ]],
  ['native-korean','ko',[op('키보드 포커스 접근성',['키보드','포커스'],'기존 버튼 스타일 유지')]],
  ['out-of-catalog','en',[op('Restore a 17th-century astrolabe',['astrolabe','verdigris','engraving'],'Preserve the patina')]],
];

const work = await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-token-bench-'));
try {
  const snapshot = await fs.readFile(snapshotPath,'utf8');
  const state = JSON.parse(snapshot);
  const catalogURL = 'https://catalog.example/v1/catalog';
  const cache = path.join(work,'cache');
  const guard = path.join(work,'no-fetch.mjs');
  const task = path.join(work,'task.json');
  await fs.mkdir(path.join(cache,'http'),{recursive:true});
  await fs.writeFile(path.join(cache,'http',sha256(catalogURL)+'.json'),
    JSON.stringify({body:snapshot,digest:sha256(snapshot),at:Date.now()}));
  await fs.writeFile(guard,'globalThis.fetch = () => { process.stderr.write("Unexpected fetch\\n"); process.exit(95); };');
  function run(script, ...args) {
    return execFileSync(process.execPath,['--import',guard,path.resolve(script),...args,'--cache',cache,'--offline'],
      {encoding:'utf8',maxBuffer:32*1024*1024,env:{}});
  }
  const measurements = [];
  const outputs = [];
  for (const [id, language, operations] of cases) {
    await fs.writeFile(task,JSON.stringify({operations}));
    const routeArgs = ['catalog-route','--catalog-url',catalogURL,'--file',task];
    const before = run(baselinePath,...routeArgs);
    const compact = run(cli,...routeArgs);
    const old = JSON.parse(before), current = JSON.parse(compact);
    assert.equal(old.requests,0);
    assert.equal(current.requests,0);
    const retrieve = route => route.operations.map(o=>({
      intent:o.intent, constraints:o.constraints,
      candidates:o.candidates.map(({id,name,commit,matched_terms,retrieval_score})=>({id,name,commit,matched_terms,retrieval_score}))
    }));
    assert.deepEqual(retrieve(current),retrieve(old));
    const oldCandidates = new Map(old.operations.flatMap(o=>o.candidates.map(c=>[c.id,c])));
    const trace = JSON.parse(await fs.readFile(path.join(cache,'task-catalog','traces',current.trace_id+'.json')));
    assert.deepEqual(Object.keys(trace.evidence),[...oldCandidates.keys()]);
    const details = new Map();
    for (const [id, legacy] of oldCandidates) {
      const stdout = run(cli,'catalog-detail','--trace',current.trace_id,id);
      const {candidate} = JSON.parse(stdout);
      const {matched_terms,retrieval_score,...legacyEvidence} = legacy;
      for (const [key,value] of Object.entries(legacyEvidence)) assert.deepEqual(candidate[key],value);
      assert.equal(candidate.blob_sha,state.cards[id].blob_sha);
      assert.equal(candidate.license,state.cards[id].license);
      details.set(id,stdout);
    }
    for (const candidate of current.operations.flatMap(o=>o.candidates)) {
      assert.equal(candidate.license,state.cards[candidate.id].license);
      for (const field of ['profile','entrypoint','instructions','stars']) assert.ok(!Object.hasOwn(candidate,field));
      const observed = oldCandidates.get(candidate.id).trending;
      if (!observed.length) assert.equal(candidate.trending,undefined);
      else {
        const latest = observed.reduce((a,b)=>(b.checked_at || '') > (a.checked_at || '') ? b : a);
        const {since,rank,language_filter} = latest;
        assert.deepEqual(candidate.trending,{since,rank,...(language_filter && {language_filter})});
      }
    }
    const firstIDs = [...new Set(current.operations.flatMap(o=>o.candidates.slice(0,1).map(c=>c.id)))];
    function batchDetails(ids) {
      if (ids.length <= 1) return ids.map(id=>details.get(id));
      const stdout = run(cli,'catalog-detail','--trace',current.trace_id,...ids);
      const batch = JSON.parse(stdout);
      assert.equal(batch.trace_id,current.trace_id);
      assert.equal(batch.profile_format,'indexed_excerpts');
      assert.deepEqual(batch.candidates.map(c=>c.id),ids);
      for (const candidate of batch.candidates) {
        const {excerpts,...profile} = candidate.profile;
        for (const group of ['situations','inputs','outputs','constraints','headings']) {
          if (!Object.hasOwn(profile,group)) continue;
          profile[group] = profile[group].map(index => {
            const [line,text] = excerpts[index];
            return {line,text};
          });
        }
        assert.deepEqual({...candidate,profile},trace.evidence[candidate.id]);
      }
      return [stdout];
    }
    const allDetails = batchDetails([...details.keys()]);
    const stages = {
      before:[before], compact:[compact],
      with_first_detail:[compact,...batchDetails(firstIDs)],
      with_all_details:[compact,...details.values()],
      with_all_batched_details:[compact,...allDetails]
    };
    outputs.push(stages);
    measurements.push({
      id, language, operations, status:current.status, unique_candidate_count:details.size,
      candidate_ids:current.operations.map(o=>o.candidates.map(c=>c.id)),
      first_detail_ids:firstIDs,
      all_detail_calls:{separate:details.size, batched:allDetails.length},
      verified:{rank_and_matches:true, task_constraints:true, all_legacy_evidence_retrievable:true, batch_round_trip:true, pins_and_licenses:true, trending_observations:true, http_requests:0},
      bytes:Object.fromEntries(Object.entries(stages).map(([key,parts])=>
        [key,parts.reduce((size,part)=>size+Buffer.byteLength(part),0)]))
    });
  }
  const entrypoints = {
    before:[await fs.readFile(path.join(path.dirname(baselinePath),'../SKILL.md'),'utf8')],
    compact:[await fs.readFile(new URL('../skills/hot-pick/SKILL.md',import.meta.url),'utf8')]
  };
  const count = execFileSync(python,['-c',`
import json, sys, tiktoken
encodings = [tiktoken.get_encoding(name) for name in ("cl100k_base", "o200k_base")]
rows = [{enc.name: {stage: sum(len(enc.encode_ordinary(part)) for part in parts)
                    for stage, parts in row.items()}
         for enc in encodings}
        for row in json.load(sys.stdin)]
json.dump({"version": tiktoken.__version__, "rows": rows}, sys.stdout)
`],{input:JSON.stringify([...outputs,entrypoints]),encoding:'utf8'});
  const counts = JSON.parse(count);
  const entrypointTokens = counts.rows.pop();
  for (let i=0;i<measurements.length;i++) measurements[i].tokens = counts.rows[i];
  const total = Object.fromEntries(Object.entries(counts.rows[0]).map(([encoding,stages])=>
    [encoding,Object.fromEntries(Object.keys(stages).map(stage=>
      [stage,counts.rows.reduce((sum,row)=>sum+row[encoding][stage],0)]))]));
  const report = {
    method:'Exact CLI stdout with trailing newline, counted per response. Staged counts sum each response independently.',
    tokenizer:{name:'tiktoken',version:counts.version,source:'https://github.com/openai/tiktoken'},
    scope:'Counts are exact for these public encodings and sampled stdout. Model-specific billing, tool wrappers, calling context, reasoning and selected file contents are outside the route comparison.',
    baseline:{cli_sha256:sha256(await fs.readFile(baselinePath)),catalog_module_sha256:sha256(await fs.readFile(path.join(path.dirname(baselinePath),'catalog.mjs')))},
    snapshot:{sha256:sha256(snapshot),updated_at:state.updated_at,cards:Object.keys(state.cards).length,repositories:new Set(Object.values(state.cards).map(c=>c.repo)).size},
    skill_entrypoint_tokens:entrypointTokens,
    total, cases:measurements
  };
  console.log(JSON.stringify(report,null,2));
} finally {
  await fs.rm(work,{recursive:true,force:true});
}
