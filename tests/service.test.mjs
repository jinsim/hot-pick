import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCatalogServer } from '../service/server.mjs';
import { MAX_SNAPSHOT_BYTES } from '../service/snapshot.mjs';

const time = '2026-11-07T05:00:00.000Z';
const repo = 'example/skills';
const skill_path = 'tools/focus/SKILL.md';
const id = `${repo}:${skill_path}`;
const commit = 'a'.repeat(40), blob_sha = 'b'.repeat(40);
const card = {
  id, repo, skill_path, commit, blob_sha, name: 'focus', license: 'MIT', stars: 42,
  checked_at: time, source: `https://github.com/${repo}/blob/${commit}/${skill_path}`,
  profile: {
    description: 'Keyboard focus guidance', method: 'source_excerpts',
    situations: [{ line: 4, text: 'Use for keyboard focus' }], inputs: [], outputs: [],
    constraints: [], headings: [], semantic_review: null
  }
};
const snapshot = {
  schema: 1, updated_at: time, cards: { [id]: card },
  trends: { 'https://github.com/trending?since=weekly': { checked_at: time, repositories: [
    { repo, rank: 1, since: 'weekly', language_filter: null, period_stars: 3, total_stars: 42 }
  ] } }
};

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hot-pick-service-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function httpFixture(t) {
  const dir = await fixture(t);
  const file = path.join(dir, 'catalog.json');
  const server = createCatalogServer({ catalogFile: file });
  const listening = once(server, 'listening');
  server.listen(0, '127.0.0.1');
  await listening;
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const request = (url = '/v1/catalog', options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
  const replace = async data => {
    await fs.writeFile(file + '.new', typeof data === 'string' ? data : JSON.stringify(data));
    await fs.rename(file + '.new', file);
  };
  return { request, replace, file };
}

test('public GET and health return JSON; matching ETags produce a cacheable, empty 304', async t => {
  const { request, replace } = await httpFixture(t);
  const reviewed = structuredClone(snapshot);
  reviewed.cards[id].profile.semantic_review = {
    blob_sha, situations: ['키보드 포커스'], inputs: [], outputs: [], constraints: [],
    evidence: ['Use for keyboard focus']
  };
  await replace(reviewed);
  const health = await request('/health');
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true });

  const first = await request();
  assert.equal(first.status, 200);
  assert.match(first.headers.get('content-type'), /^application\/json/);
  assert.match(first.headers.get('cache-control'), /^public, max-age=300/);
  assert.deepEqual(await first.json(), reviewed);
  const etag = first.headers.get('etag');
  assert.match(etag, /^"sha256-[a-f0-9]{64}"$/);
  for (const header of [etag, `"tag,with,commas", W/${etag}`, '*']) {
    const conditional = await request('/v1/catalog', { headers: { 'If-None-Match': header } });
    assert.equal(conditional.status, 304);
    assert.equal(conditional.headers.get('etag'), etag);
    assert.equal(conditional.headers.get('cache-control'), first.headers.get('cache-control'));
    assert.equal(await conditional.text(), '');
  }
  const head = await request('/v1/catalog', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), etag);
  assert.equal(await head.text(), '');
});

test('an atomic snapshot replacement reloads on the same listener and changes the validator', async t => {
  const { request, replace } = await httpFixture(t);
  await replace(snapshot);
  const first = await request();
  const oldETag = first.headers.get('etag');
  await first.arrayBuffer();
  const next = structuredClone(snapshot);
  // Same byte length and timestamp; a new inode still changes the representation.
  next.cards[id].stars++;
  await replace(next);
  const reloaded = await request('/v1/catalog', { headers: { 'If-None-Match': oldETag } });
  assert.equal(reloaded.status, 200);
  assert.notEqual(reloaded.headers.get('etag'), oldETag);
  assert.deepEqual(await reloaded.json(), next);
});

test('missing, malformed, private and oversized snapshots are unavailable and never echoed', async t => {
  const { request, replace, file } = await httpFixture(t);
  async function unavailable(url) {
    const r = await request(url, { headers: { 'If-None-Match': '*' } });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('etag'), null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { error: 'catalog_unavailable' });
  }
  await unavailable('/health');
  await replace(snapshot);
  const good = await request();
  assert.equal(good.status, 200);
  await good.arrayBuffer();
  await replace('{"invalid": "local content"');
  await unavailable();
  const privateCard = structuredClone(snapshot);
  Object.assign(privateCard.cards[id], { ready: true, instructions: 'full source', entrypoint: '/private/SKILL.md' });
  await replace(privateCard);
  await unavailable();
  const privateProfile = structuredClone(snapshot);
  privateProfile.cards[id].profile.situations[0].text = 'Read /Users/operator/private.txt';
  await replace(privateProfile);
  await unavailable();
  await fs.truncate(file, MAX_SNAPSHOT_BYTES + 1);
  await unavailable();
  await replace(snapshot);
  const recovered = await request();
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), snapshot);
});

test('duplicate keys cannot smuggle raw input; no request can select files or write data', async t => {
  const { request, replace } = await httpFixture(t);
  await replace('{"instructions":"/private/token",' + JSON.stringify(snapshot).slice(1, -1) +
    ',"instructions":null}');
  const invalid = await request();
  assert.equal(invalid.status, 503);
  await invalid.arrayBuffer();
  await replace('{"cards":{"instructions":"/private/token"},' + JSON.stringify(snapshot).slice(1));
  const r = await request();
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.equal(body.includes('/private/token'), false);
  assert.deepEqual(JSON.parse(body), snapshot);

  const write = await request('/v1/catalog', { method: 'POST', body: '{}' });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get('allow'), 'GET, HEAD');
  await write.arrayBuffer();
  for (const url of ['/v1/search', '/v1/catalog?file=/etc/passwd', '/etc/passwd']) {
    const missing = await request(url);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not_found' });
  }
});

test('one-shot collector retains private cache, exports a public snapshot, and does not replace it on validation failure', async t => {
  const dir = await fixture(t);
  const cache = path.join(dir, 'private'), config = path.join(dir, 'config.json');
  const index = path.join(cache, 'task-catalog', 'index.json');
  const out = path.join(dir, 'public', 'catalog.json');
  await fs.mkdir(path.dirname(index), { recursive: true });
  await fs.writeFile(config, JSON.stringify({ interval_seconds: 600, prewarm: true, repositories: [], trending: [],
    include_observed: false }));
  const state = structuredClone(snapshot);
  state.repositories = {};
  Object.assign(state.cards[id], { ready: true, instructions: 'full instructions', entrypoint: '/private/SKILL.md' });
  await fs.writeFile(index, JSON.stringify(state));
  const collect = () => spawnSync(process.execPath, [fileURLToPath(new URL('../service/collect.mjs', import.meta.url))], {
    env: { ...process.env, CATALOG_CACHE: cache, CATALOG_CONFIG: config, CATALOG_FILE: out },
    encoding: 'utf8', timeout: 5000
  });
  const first = collect();
  assert.equal(first.status, 0, first.stderr);
  const privateState = JSON.parse(await fs.readFile(index, 'utf8'));
  assert.equal(privateState.cards[id].instructions, 'full instructions');
  const exported = await fs.readFile(out, 'utf8');
  assert.deepEqual(JSON.parse(exported).cards[id], card);

  state.cards[id].profile.situations[0].line = 0;
  await fs.writeFile(index, JSON.stringify(state));
  const failed = collect();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Invalid public snapshot/);
  assert.equal(await fs.readFile(out, 'utf8'), exported);
});
