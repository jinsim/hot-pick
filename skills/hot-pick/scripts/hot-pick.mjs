#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HotPick, HotPickError } from './core.mjs';
export { HotPick, HotPickError, safePath, parseSource, bm25 } from './core.mjs';
const VERSION = '0.2.0';
function fail(code, message) { throw new HotPickError(code, message); }

export async function main(argv = process.argv.slice(2)) {
  const command = argv.shift();
  const opts = {}, positional = [];
  const flags = new Set(['offline', 'refresh', 'content']);
  const values = new Set(['cache', 'ttl', 'timeout', 'limit', 'owner', 'path', 'ref', 'api', 'since', 'language', 'file', 'workspace', 'plan', 'config', 'catalog-url']);
  while (argv.length) {
    const x = argv.shift();
    if (!x.startsWith('--')) { positional.push(x); continue; }
    const name = x.slice(2);
    if (flags.has(name)) opts[name] = true;
    else if (values.has(name) && argv.length && !argv[0].startsWith('--')) opts[name] = argv.shift();
    else fail('invalid_option', `Unknown or missing option: ${x}`);
  }
  for (const key of ['ttl', 'timeout', 'limit']) if (opts[key] !== undefined) {
    opts[key] = Number(opts[key]);
    if (!Number.isInteger(opts[key]) || opts[key] < (key === 'ttl' ? 0 : 1)) fail('invalid_option', `Invalid ${key}`);
  }
  if (opts.api) {
    const u = new URL(opts.api);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))) fail('invalid_api', 'Registry must use HTTPS (loopback HTTP is allowed for benchmarks).');
    if (u.username || u.password || u.search || u.hash) fail('invalid_api', 'Registry URL cannot contain credentials, query, or fragment.');
    opts.api = opts.api.replace(/\/$/, '');
  }
  const c = new HotPick(opts); let result;
  const start = performance.now();
  if (['catalog-sync','catalog-watch','catalog-route','catalog-label','catalog-record','catalog-status','catalog-review-queue','catalog-connect'].includes(command)) {
    const { catalogCommand } = await import('./catalog.mjs');
    console.log(JSON.stringify({ok:true,...await catalogCommand(command,positional,opts)})); return;
  }
  if (['discover', 'trending', 'repo', 'read', 'acquire', 'apply'].includes(command)) {
    const { ossCommand } = await import('./oss.mjs');
    const output = await ossCommand(command, positional, opts);
    const ok = output.status !== 'failed';
    console.log(JSON.stringify({ ok, ...output, elapsed_ms: Math.round(performance.now() - start) }));
    if (!ok) process.exitCode = 1;
    return;
  }
  if (command === 'search') result = await c.search(positional.join(' '), opts);
  else if (command === 'inspect' || command === 'prepare') {
    result = await c[command](positional[0], { skillPath: opts.path, ref: opts.ref });
    if (command === 'prepare' && opts.content) result.instructions = await fs.readFile(result.entrypoint, 'utf8');
    if (result.instructions?.length > 24000) {
      result.instructions = result.instructions.slice(0, 24000);
      result.instructions_truncated = true;
      result.next_step = 'Prepare the skill, then read its full SKILL.md from entrypoint before applying. CLI preview is incomplete.';
    }
    if (result.files?.length > 40) { result.files = result.files.slice(0, 40); result.inventory_truncated = true; }
  }
  else if (command === 'refresh') result = await c.refreshTracked(opts.limit ?? 10);
  else if (command === 'status') result = { cache: c.dir, tracked_skills: (await c.records()).length };
  else if (command === '--version') result = { version: VERSION };
  else result = { usage: ['discover "public task keywords" [--since weekly] [--language python]', 'trending [--since daily|weekly|monthly]', 'repo owner/repo [--ref SHA]', 'read owner/repo --ref SHA --file README.md', 'acquire owner/repo --ref SHA --workspace DIR', 'apply --plan task-plan.json', 'search "skill keywords" [--owner org]', 'inspect owner/repo@skill', 'prepare owner/repo@skill', 'refresh [--limit 10]', 'status'], options: '--cache DIR --offline --refresh --ttl 600 --timeout 8000', note: 'Host interprets task and reviews source; apply executes a host-authored local plan and records verification evidence.' };
  console.log(JSON.stringify({ ok: true, ...result, warnings: c.warnings, metrics: { ...c.stats, elapsed_ms: Math.round((performance.now() - start) * 100) / 100 } }));
}
if (process.argv[1] && (import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href || import.meta.url === pathToFileURL(await fs.realpath(process.argv[1])).href)) {
  main().catch(e => { console.log(JSON.stringify({ ok: false, error: e.code || 'internal_error', message: e.message })); process.exitCode = 1; });
}
