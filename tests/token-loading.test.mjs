import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {describe} from '../skills/hot-pick/scripts/catalog.mjs';

const cli = fileURLToPath(new URL('../skills/hot-pick/scripts/hot-pick.mjs', import.meta.url));
const run = promisify(execFile);
const sha256 = value => createHash('sha256').update(value).digest('hex');
function gitFile(file, contents) {
  const size = Buffer.byteLength(contents);
  const sha = createHash('sha1').update(`blob ${size}\0`).update(contents).digest('hex');
  return {path:file, size, sha, type:'blob', mode:'100644'};
}

test('CLI uses a compact route, then reads only the pinned file requested at each step', async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-token-loading-'));
  t.after(()=>fs.rm(cache,{recursive:true,force:true}));
  const repo = 'example/cli', commit = 'a'.repeat(40);
  const instructions = '---\nname: parse\ndescription: Parse CSV rows\n---\n' +
    'Use this only with UTF-8 CSV. See [delimiters](references/delimiters.md).\n' +
    '\n'.repeat(48000) + 'End of full instructions.\n';
  const support = '# Delimiters\nUse a comma by default.\n';
  const entry = gitFile('skills/parse/SKILL.md', instructions);
  const reference = gitFile('skills/parse/references/delimiters.md', support);
  const id = `${repo}:${entry.path}`;
  const candidate = {
    id, repo, name:'parse', commit, skill_path:entry.path, blob_sha:entry.sha,
    license:'MIT', source:`https://github.com/${repo}/blob/${commit}/${entry.path}`, profile:describe(instructions)
  };
  const alternate = {
    ...candidate, id:`${repo}:alternate/SKILL.md`, name:'alternate',
    skill_path:'alternate/SKILL.md', profile:describe('description: Parse CSV with spreadsheets')
  };
  for (const dir of ['task-catalog','http','blobs']) await fs.mkdir(path.join(cache,dir));
  await fs.writeFile(path.join(cache,'task-catalog/routing.json'),
    JSON.stringify({cards:{[id]:candidate,[alternate.id]:alternate},trends:{}}));
  const tree = JSON.stringify({tree:[entry,reference]});
  const treeURL = `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`;
  await fs.writeFile(path.join(cache,'http',sha256(treeURL)+'.json'),
    JSON.stringify({body:tree,digest:sha256(tree),at:Date.now()}));
  const taskFile = path.join(cache,'task.json');
  await fs.writeFile(taskFile,JSON.stringify({operations:[{
    intent:'CSV 파싱', keywords:['parse','csv'], constraints:['UTF-8']
  }]}));
  const networkGuard = path.join(cache,'network-guard.mjs');
  await fs.writeFile(networkGuard,'globalThis.fetch = () => { throw Error("Network disabled"); };');
  const command = (...args) => run(process.execPath,['--import',networkGuard,cli,...args,'--cache',cache,'--offline'],{env:{}});

  const route = JSON.parse((await command('catalog-route','--file',taskFile)).stdout);
  assert.equal(route.requests,0);
  assert.equal(route.operations[0].candidates.length,2);
  assert.ok(route.operations[0].candidates.every(c=>!Object.hasOwn(c,'profile')));
  assert.deepEqual(await fs.readdir(path.join(cache,'blobs')),[]);
  const expanded = JSON.parse((await command('catalog-route','--file',taskFile,'--details')).stdout);
  assert.equal(expanded.operations[0].candidates.find(c=>c.id===id).profile.constraints[0].line,5);
  const detail = JSON.parse((await command('catalog-detail','--trace',route.trace_id,id)).stdout).candidate;
  assert.equal(detail.profile.constraints[0].text,'Use this only with UTF-8 CSV. See [delimiters](references/delimiters.md).');
  assert.equal(detail.blob_sha,entry.sha);

  const batchArgs = ['catalog-detail','--trace',route.trace_id];
  const batch = JSON.parse((await command(...batchArgs,alternate.id,id,alternate.id)).stdout);
  assert.equal(batch.profile_format,'indexed_excerpts');
  assert.deepEqual(batch.candidates.map(c=>c.id),[alternate.id,id]);
  const {profile,...metadata} = batch.candidates[1];
  const {profile:singleProfile,...singleMetadata} = detail;
  assert.deepEqual(metadata,singleMetadata);
  assert.equal(profile.situations[0],profile.constraints[0]);
  assert.deepEqual(profile.excerpts[profile.constraints[0]],
    [singleProfile.constraints[0].line,singleProfile.constraints[0].text]);
  await assert.rejects(command(...batchArgs,id,'example/other:SKILL.md'), error => {
    const response = JSON.parse(error.stdout);
    assert.equal(response.ok,false);
    assert.match(response.message,/Candidate not found/);
    assert.equal(response.candidates,undefined);
    return true;
  });

  await fs.writeFile(path.join(cache,'blobs',entry.sha),instructions);
  const read = file => command('read',detail.repo,'--ref',detail.commit,'--file',file,'--text');
  assert.equal((await read(detail.path)).stdout,instructions);
  await assert.rejects(read(reference.path), e=>JSON.parse(e.stdout).error==='offline_miss');
  await fs.writeFile(path.join(cache,'blobs',reference.sha),support);
  assert.equal((await read(reference.path)).stdout,support);
  const preview = JSON.parse((await command('read',detail.repo,'--ref',detail.commit,'--file',detail.path)).stdout);
  assert.equal(preview.truncated,true);
  assert.equal(preview.text,instructions.slice(0,48000));
});
