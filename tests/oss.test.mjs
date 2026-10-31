import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { OSS, parseTrending, runCommand } from '../skills/hot-pick/scripts/oss.mjs';
import { fixture, A } from './fixture.mjs';

const card = '<article class="Box-row"><h2><a href="/example/design">example / design</a></h2><p>HTML parsing library</p><a href="/example/design/stargazers">1,234</a><span>120 stars this week</span></article>';
test('Trending extracts real period counts; high all-time stars are separate', () => {
  const r = parseTrending(card)[0];
  assert.equal(r.period_stars, 120); assert.equal(r.total_stars, 1234); assert.equal(r.since, 'weekly');
  assert.equal(parseTrending(card, { since: 'daily' })[0].period_stars, null);
  assert.throws(() => parseTrending('<html>Login required</html>'), { code: 'trending_unavailable' });
});
test('discovery merges Trending with task search and caches both across calls', async t => {
  const f = await fixture(t);
  const calls = [];
  const c = new OSS({ cache: f.dir, fetch: async (url, init) => {
    calls.push(url);
    if (url.includes('/trending')) { assert.equal(init.headers.Accept, 'text/html'); return new Response(card); }
    return new Response(JSON.stringify({ items: [{ full_name: 'other/popular', stargazers_count: 999999, archived: false, fork: false }], incomplete_results: false }));
  }});
  const r = await c.discover('HTML parsing');
  assert.equal(r.candidates[0].repo, 'example/design'); assert.equal(r.candidates[1].trending, null);
  await c.discover('HTML parsing'); assert.equal(calls.length, 2);
});
test('Trending outages do not invent trend signals or mask search failures', async t => {
  const f = await fixture(t);
  const c = new OSS({ cache: f.dir, fetch: async url => url.includes('/trending') ? new Response('down', { status: 503 }) : new Response(JSON.stringify({ items: [], incomplete_results: true })) });
  assert.equal((await c.discover('unknown')).candidates.length, 0);
  assert.ok(c.warnings.includes('github_search_incomplete'));
  assert.ok(c.warnings.some(w => w.startsWith('trending_failed')));
});
test('cached observation time is not falsely refreshed by a cache hit', async t => {
  const f = await fixture(t); let now = 1000000;
  const c = new OSS({ cache: f.dir, now: () => now, fetch: async () => new Response(card) });
  const a = await c.trending(); now += 1000; const b = await c.trending();
  assert.equal(a.data_checked_at, b.data_checked_at); assert.notEqual(a.observed_at, b.observed_at);
});
test('general repository inspection works without any SKILL.md', async t => {
  const f = await fixture(t); f.state.files = { 'README.md': '# Library\nParse HTML', 'pyproject.toml': '[project]\nname="example"' };
  const c = new OSS({ cache: f.dir, fetch: f.fetch }); const r = await c.repository('example/design');
  assert.deepEqual(r.type_hints, ['library_or_cli']); assert.equal(r.commit, A);
  assert.equal((await c.readSource('example/design', 'README.md', A)).text, '# Library\nParse HTML');
  await assert.rejects(c.readSource('example/design', '../secret', A), { code: 'unsafe_path' });
});
test('command execution handles failure and timeout without using shell expansion', async t => {
  const f = await fixture(t);
  const result = await runCommand([process.execPath, '-e', 'process.stdout.write(process.argv[1])', '$(echo surprise)'], f.dir);
  assert.equal(result.stdout, '$(echo surprise)');
  assert.equal((await runCommand([process.execPath, '-e', 'process.exit(3)'], f.dir)).exit_code, 3);
  assert.equal((await runCommand([process.execPath, '-e', 'setInterval(()=>{},1000)'], f.dir, { timeout: 50 })).stopped, 'timeout');
});
async function planFixture(t, changes = {}) {
  const f = await fixture(t);
  const plan = { version: 1, task: 'Write a checked artifact', workspace: '.', source: { repo: 'example/design', commit: A },
    steps: [{ name: 'write', argv: [process.execPath, '-e', 'require("fs").writeFileSync("result.json",JSON.stringify({value:42}))'] }],
    checks: [{ name: 'value must be 42', argv: [process.execPath, '-e', 'if(JSON.parse(require("fs").readFileSync("result.json")).value!==42)process.exit(1)'] }], artifacts: ['result.json'], ...changes };
  const file = path.join(f.dir, 'plan.json'); await fs.writeFile(file, JSON.stringify(plan));
  const c = new OSS({ cache: f.dir });
  c.acquire = async () => ({ repo: 'example/design', commit: A, directory: f.dir });
  return { f, c, file };
}
test('apply executes real commands and records checked artifact hashes', async t => {
  const { c, file } = await planFixture(t); const r = await c.apply(file);
  assert.equal(r.status, 'checks_passed'); assert.equal(r.artifacts[0].sha256.length, 64);
  assert.equal(JSON.parse(await fs.readFile(r.receipt_path)).checks[0].exit_code, 0);
});
test('a failed validation never becomes a success receipt', async t => {
  const { c, file } = await planFixture(t, { checks: [{ name: 'reject', argv: [process.execPath, '-e', 'process.exit(1)'] }] });
  const r = await c.apply(file); assert.equal(r.status, 'failed'); assert.equal(r.error.code, 'execution_failed');
});
test('plans must include checks; nonexistent outputs fail despite zero exit codes', async t => {
  const a = await planFixture(t, { checks: [] }); await assert.rejects(a.c.apply(a.file), { code: 'invalid_plan' });
  const b = await planFixture(t, { artifacts: ['missing.json'] }); assert.equal((await b.c.apply(b.file)).status, 'failed');
});
test('apply does not inherit ambient tokens into third-party subprocesses', async t => {
  const old = process.env.HOT_PICK_SECRET_TEST; process.env.HOT_PICK_SECRET_TEST = 'private';
  t.after(() => { if (old === undefined) delete process.env.HOT_PICK_SECRET_TEST; else process.env.HOT_PICK_SECRET_TEST = old; });
  const f = await fixture(t); const r = await runCommand([process.execPath, '-e', 'if(process.env.HOT_PICK_SECRET_TEST)process.exit(1)'], f.dir);
  assert.equal(r.exit_code, 0);
});
