// Fair process-level benchmark: no npx package download, telemetry disabled for both.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fixture } from '../tests/fixture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const cli = path.join(root, 'skills/hot-pick/scripts/hot-pick.mjs');
const baseline = path.resolve(process.env.SKILLS_BASELINE || path.join(root, '.research/npm/package/bin/cli.mjs'));
await fs.access(baseline);
const samples = Number(process.env.BENCH_SAMPLES || 30);
const live = process.env.BENCH_LIVE === '1';
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-bench-'));
const env = { ...process.env, DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', NO_COLOR: '1' };
const tempCopies = new Set();
function run(args, extra = {}) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const p = spawn(process.execPath, args, { cwd: root, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timeout = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('Benchmark process timeout')); }, 30000);
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('error', reject);
    p.on('close', code => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(`Exit ${code}: ${err.slice(0, 500)} ${out.slice(0, 500)}`));
      for (const m of out.matchAll(/(\/[^\s"`]*\/skills-use-[^\s/"`]+)/g)) tempCopies.add(m[1]);
      resolve({ ms: performance.now() - start, bytes: Buffer.byteLength(out), out });
    });
  });
}
let seed = 42;
function rand() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return (s[Math.floor((n - 1) / 2)] + s[Math.floor(n / 2)]) / 2; };
function summarize(xs) {
  const ms = xs.map(x => x.ms), ordered = [...ms].sort((a, b) => a - b), boots = [];
  for (let i = 0; i < 2000; i++) boots.push(median(ms.map(() => ms[Math.floor(rand() * ms.length)])));
  boots.sort((a, b) => a - b);
  return { n: xs.length, median_ms: +median(ms).toFixed(2), p95_ms: +ordered[Math.ceil(ordered.length * .95) - 1].toFixed(2), median_ci95_ms: [boots[50], boots[1949]].map(x => +x.toFixed(2)), median_stdout_bytes: median(xs.map(x => x.bytes)), raw_ms: ms };
}
const payload = { skills: ['layout', 'typography', 'color', 'components', 'motion'].map((name, i) => ({ id: `example/design/${name}`, name, source: 'example/design', installs: 10000 - 1000 * i })) };
let requests = 0;
const server = http.createServer((req, res) => {
  requests++;
  setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json', etag: 'fixture-v1' }); res.end(JSON.stringify(payload)); }, 40);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const api = `http://127.0.0.1:${server.address().port}`;
const results = {};
async function compare(name, left, right, n = samples) {
  const rows = { baseline: [], curator: [] };
  for (let i = 0; i < n; i++) {
    // Deterministic balanced alternation reduces order/thermal bias.
    for (const side of i % 2 ? ['curator', 'baseline'] : ['baseline', 'curator']) {
      const before = requests;
      const value = await (side === 'baseline' ? left : right)(i);
      rows[side].push({ ...value, requests: requests - before });
    }
  }
  results[name] = Object.fromEntries(Object.entries(rows).map(([side, r]) => [side, { ...summarize(r), counted_replay_requests: r.reduce((s, x) => s + x.requests, 0) }]));
}
let f;
try {
  const version = (await run([baseline, '--version'])).out.trim();
  for (let i = 0; i < 3; i++) { await run([baseline, '--version']); await run([cli, '--version']); }
  const cache = path.join(work, 'search-cache');
  const baseSearch = () => run([baseline, 'find', 'editorial design'], { SKILLS_API_URL: api });
  const ourSearch = () => run([cli, 'search', 'editorial design', '--limit', '20', '--api', api, '--cache', cache]);
  await compare('search_cold_replay_40ms', baseSearch, async () => { await fs.rm(cache, { recursive: true, force: true }); return ourSearch(); });
  await ourSearch();
  await compare('search_warm_replay_40ms', baseSearch, ourSearch);

  f = await fixture();
  for (let i = 0; i < 32; i++) f.state.files[`skills/layout/references/example-${i}.md`] = 'Readable reference material.\n'.repeat(300);
  const source = path.join(work, 'installed-layout');
  for (const [p, text] of Object.entries(f.state.files)) if (p.startsWith('skills/layout/')) {
    const dest = path.join(source, p.slice('skills/layout/'.length));
    await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, text);
  }
  const prepared = await f.c.prepare('example/design@layout');
  // Same instructions and supporting bytes on both sides; internet excluded for both.
  await compare('use_warm_local_same_files', () => run([baseline, 'use', source, '--skill', 'layout']), () => run([cli, 'prepare', 'example/design@layout', '--content', '--offline', '--cache', f.dir]));
  const installed = [];
  for (let i = 0; i < samples; i++) installed.push(await run(['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1],"utf8"))', path.join(source, 'SKILL.md')]));
  results.installed_instruction_read = summarize(installed);
  if (live) {
    const liveCache = path.join(work, 'live');
    await run([cli, 'search', 'react performance', '--limit', '20', '--cache', liveCache]);
    await compare('search_warm_live', () => run([baseline, 'find', 'react performance']), () => run([cli, 'search', 'react performance', '--limit', '20', '--cache', liveCache]), 7);
  }
  const report = {
    measured_at: new Date().toISOString(), baseline: `skills@${version}`, node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0].model,
    methodology: 'Whole fresh Node processes; 3 startup warmups; balanced alternating order; both telemetry opt-outs; baseline package already installed, no npx/network bootstrap. Same 5 replay candidates, both configured for up to 20. 40ms fixed response latency. Median percentile bootstrap 2000 draws, seed 42. Single-machine descriptive intervals, not independent user-task outcome evidence.',
    use_fixture: { files: prepared.files, bytes: Object.entries(f.state.files).filter(([p]) => p.startsWith('skills/layout/')).reduce((n, [, v]) => n + Buffer.byteLength(v), 0), content_parity: 'Both receive identical SKILL.md and supporting files; baseline copies local files to a temp directory, curator verifies and reuses a cached bundle. Installed read only reads SKILL.md and has less validation work.' },
    limitations: ['No blind LLM output-quality evaluation.', 'Cold remote skill acquisition is not benchmarked; upstream blob snapshots can outperform individual GitHub requests.', 'Cache hit and miss are separately reported; live results depend on network and upstream service.', 'Smaller stdout is not assumed: JSON provenance can be longer.', 'No private repo or MCP tool parity claim.'], results
  };
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'docs/benchmark-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ baseline: report.baseline, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.baseline ? { baseline_ms: v.baseline.median_ms, curator_ms: v.curator.median_ms, replay_requests: [v.baseline.counted_replay_requests, v.curator.counted_replay_requests] } : { median_ms: v.median_ms }])) }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(work, { recursive: true, force: true });
  if (f) await fs.rm(f.dir, { recursive: true, force: true });
  for (const p of tempCopies) if (path.basename(p).startsWith('skills-use-') && p.startsWith(os.tmpdir())) await fs.rm(p, { recursive: true, force: true });
}
