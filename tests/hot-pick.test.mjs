import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HotPick, safePath, bm25 } from '../skills/hot-pick/scripts/hot-pick.mjs';
import { fixture, A, B } from './fixture.mjs';

test('CLI runs when the skill is registered through a directory symlink', async t => {
  const f = await fixture(t);
  const link = path.join(f.dir, 'registered-skill');
  await fs.symlink(path.resolve(import.meta.dirname, '../skills/hot-pick'), link);
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(link, 'scripts/hot-pick.mjs'), '--version']);
  assert.equal(JSON.parse(stdout).version, '0.2.0');
});

test('repeated search uses disk cache across new instances, with zero network requests', async t => {
  const f = await fixture(t);
  const first = await f.c.search('Editorial Design');
  const next = f.create();
  assert.deepEqual(await next.search(' editorial   design '), first);
  assert.equal(next.stats.requests, 0);
  assert.equal(next.stats.cache_hits, 1);
});
test('expired search uses conditional GET and refreshes timestamp after 304', async t => {
  const f = await fixture(t);
  await f.c.search('design'); f.state.time += 601000;
  const next = f.create(); await next.search('design');
  assert.equal(next.stats.revalidated, 1);
  const third = f.create(); await third.search('design'); assert.equal(third.stats.requests, 0);
});
test('search failure is not reported as an empty result; genuine empty results succeed', async t => {
  const f = await fixture(t); f.state.fail = true;
  await assert.rejects(f.c.search('unknown'), { code: 'http_503' });
  f.state.fail = false; f.state.skills = [];
  assert.deepEqual((await f.c.search('unknown')).candidates, []);
});
test('stale fallback is labeled with failure and age', async t => {
  const f = await fixture(t); await f.c.search('design');
  f.state.time += 700000; f.state.fail = true;
  const c = f.create(); assert.equal((await c.search('design')).candidates.length, 1);
  assert.match(c.warnings[0], /stale_cache:http_503:age_seconds=700/);
});
test('offline cache miss fails without trying the network', async t => {
  const f = await fixture(t); const c = f.create({ offline: true });
  await assert.rejects(c.search('unknown'), { code: 'offline_miss' });
  assert.equal(f.state.calls.length, 0);
});
test('prepare retains relative resources and exact bytes without executing scripts', async t => {
  const f = await fixture(t); const r = await f.c.prepare('example/design@layout');
  assert.equal(r.commit, A); assert.equal(r.executed, false); assert.equal(r.global_install, false);
  assert.equal(await fs.readFile(path.join(r.directory, 'references/type.md'), 'utf8'), f.state.files['skills/layout/references/type.md']);
  assert.equal(await fs.readFile(r.entrypoint, 'utf8'), f.state.files['skills/layout/SKILL.md']);
  assert.equal(r.files, 3);
});
test('warm prepare validates and reuses same bundle offline across processes/instances', async t => {
  const f = await fixture(t); const r = await f.c.prepare('example/design@layout');
  const c = f.create({ offline: true }); const r2 = await c.prepare('example/design@layout');
  assert.equal(r.directory, r2.directory); assert.equal(r2.reused, true); assert.equal(c.stats.requests, 0);
});
test('the inspected commit can be pinned offline without a redundant commit API call', async t => {
  const f = await fixture(t); await f.c.prepare('example/design@layout');
  const c = f.create({ offline: true });
  const r = await c.prepare('example/design@layout', { ref: A });
  assert.equal(r.commit, A); assert.equal(c.stats.requests, 0);
});
test('unrelated new commit reuses identical file blobs and prepared directory', async t => {
  const f = await fixture(t); const old = await f.c.prepare('example/design@layout');
  f.state.commit = B; f.state.time += 601000;
  f.state.files['unrelated.txt'] = 'unrelated change';
  const c = f.create(); const updated = await c.prepare('example/design@layout');
  assert.equal(updated.commit, B); assert.equal(updated.directory, old.directory); assert.equal(updated.reused, true);
  assert.equal(c.stats.requests, 3); // metadata, commit, tree; zero raw file downloads
});
test('one changed support file downloads only that file for a new version', async t => {
  const f = await fixture(t); const old = await f.c.prepare('example/design@layout');
  f.state.commit = B; f.state.time += 601000; f.state.files['skills/layout/references/type.md'] = 'Updated guidance';
  const c = f.create(); const updated = await c.prepare('example/design@layout');
  assert.notEqual(updated.directory, old.directory);
  assert.equal(c.stats.requests, 4); // metadata, commit, tree, one changed blob
  assert.equal(await fs.readFile(path.join(old.directory, 'references/type.md'), 'utf8'), 'Use editorial typography and asymmetric composition.\n');
});
test('batch snapshot fills only blobs matching the pinned commit, with raw fallback', async t => {
  for (const badSnapshot of [false, true]) {
    const f = await fixture(t); f.state.snapshot = true; f.state.badSnapshot = badSnapshot;
    for (let i = 0; i < 8; i++) f.state.files[`skills/layout/references/${i}.md`] = `reference ${i}`;
    const r = await f.c.prepare('example/design@layout');
    assert.equal(await fs.readFile(path.join(r.directory, 'references/7.md'), 'utf8'), 'reference 7');
    assert.equal(f.c.stats.snapshot_files, badSnapshot ? 0 : 10);
    const raw = f.state.calls.filter(u => u.includes('raw.githubusercontent.com'));
    assert.equal(raw.length, badSnapshot ? 12 : 2); // SKILL + README always inspected first
  }
});
test('unchanged refresh avoids fetching tree and content', async t => {
  const f = await fixture(t); await f.c.prepare('example/design@layout'); f.state.time += 601000;
  const c = f.create(); const r = await c.refreshTracked();
  assert.equal(r.results[0].changed, false); assert.equal(c.stats.requests, 2);
});
test('truncated upstream tree cannot produce an apparently complete bundle', async t => {
  const f = await fixture(t); f.state.truncated = true;
  await assert.rejects(f.c.prepare('example/design@layout'), { code: 'incomplete_tree' });
});
test('remote symlinks and mismatched blob hashes are rejected', async t => {
  const f = await fixture(t); f.state.symlink = 'skills/layout/scripts/check.mjs';
  await assert.rejects(f.c.prepare('example/design@layout'), { code: 'unsupported_file' });
  const g = await fixture(t); g.state.corrupt = true;
  await assert.rejects(g.c.prepare('example/design@layout'), { code: 'integrity_error' });
});
test('path traversal, Windows paths, and NUL paths are rejected', () => {
  for (const p of ['../a', 'a/../../x', '/tmp/x', 'C:/x', 'a\\b', 'a\0b', 'a//b']) assert.throws(() => safePath(p), { code: 'unsafe_path' });
  assert.equal(safePath('references/한국어.md'), 'references/한국어.md');
});
test('a changed cached instruction or symlink is never silently applied', async t => {
  const f = await fixture(t); const r = await f.c.prepare('example/design@layout');
  await fs.writeFile(r.entrypoint, 'tampered');
  await assert.rejects(f.create().prepare('example/design@layout'), { code: 'cache_integrity_error' });
  const g = await fixture(t); const b = await g.c.prepare('example/design@layout');
  await fs.rm(path.join(b.directory, 'references'), { recursive: true });
  await fs.symlink('/tmp', path.join(b.directory, 'references'));
  await assert.rejects(g.create().prepare('example/design@layout'), { code: 'cache_integrity_error' });
});
test('requested skill identity and path are not silently substituted', async t => {
  const f = await fixture(t);
  await assert.rejects(f.c.inspect('example/design@wrong'), { code: 'skill_name_mismatch' });
  await assert.rejects(f.c.inspect('example/design@layout', { skillPath: 'not-found/SKILL.md' }), { code: 'ambiguous_skill' });
});
test('local BM25 fallback provides evidence-bearing candidates, not a confidence score', async t => {
  const f = await fixture(t); await f.c.inspect('example/design@layout'); f.state.fail = true;
  const r = await f.create().search('editorial typography');
  assert.equal(r.mode, 'local_bm25'); assert.equal(r.candidates[0].name, 'layout');
  assert.ok(r.candidates[0].retrieval_score > 0);
  assert.equal(bm25('unrelated', [{ text: 'typography' }]).length, 0);
});
test('parallel preparation returns the same complete content', async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.create().prepare('example/design@layout'), f.create().prepare('example/design@layout')]);
  assert.equal(a.directory, b.directory);
  assert.equal(await fs.readFile(a.entrypoint, 'utf8'), f.state.files['skills/layout/SKILL.md']);
});
test('GitHub auth cannot leak to registry or content hosts', async t => {
  const f = await fixture(t); const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'fake-test-token';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  const requests = [];
  const c = new HotPick({ cache: f.dir, fetch: async (u, init) => { requests.push([u, init?.headers]); return f.fetch(u, init); } });
  await c.search('design'); await c.prepare('example/design@layout');
  for (const [url, headers] of requests) assert.equal(headers?.Authorization, new URL(url).hostname === 'api.github.com' ? 'Bearer fake-test-token' : undefined);
});
