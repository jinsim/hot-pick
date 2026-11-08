import {sourceSnippets} from './source-snippets.mjs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { HotPick, HotPickError, safePath, parseSource } from './core.mjs';

const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const fail = (code, message) => { throw new HotPickError(code, message); };
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const repoID = value => { const r = parseSource(value); if (r.skill) fail('invalid_repo', 'Use owner/repo without @skill.'); return r.repo; };
const pinned = value => { if (!/^[a-f0-9]{40}$/.test(value || '')) fail('commit_required', 'Use the full commit SHA returned by repo.'); return value; };
async function save(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}

export function parseTrending(html, { since = 'weekly', language = '' } = {}) {
  const cards = [...html.matchAll(/<article\b[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/g)];
  const result = [];
  for (const [, card] of cards) {
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(card)?.[1];
    const repo = heading && /href="\/([\w.-]+\/[\w.-]+)"/.exec(heading)?.[1];
    if (!repo) continue;
    const growth = /([\d,]+)\s+stars?\s+(today|this week|this month)/i.exec(text(card));
    const period = { daily: 'today', weekly: 'this week', monthly: 'this month' }[since];
    const starsMatch = new RegExp(`href="/${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/stargazers"[^>]*>([\\s\\S]*?)</a>`).exec(card);
    result.push({ repo, description: text(/<p\b[^>]*>([\s\S]*?)<\/p>/.exec(card)?.[1] || ''),
      rank: result.length + 1, since, language_filter: language || null,
      period_stars: growth && growth[2].toLowerCase() === period ? Number(growth[1].replaceAll(',', '')) : null,
      total_stars: starsMatch ? Number(text(starsMatch[1]).replaceAll(',', '')) || null : null });
  }
  if (!result.length) fail('trending_unavailable', 'No GitHub Trending cards parsed; page format changed or returned a challenge/empty response.');
  return result;
}

// Child processes never use a shell. This is not a sandbox. Only host-authored,
// reviewed plans belong here; downloaded README instructions are not execution authority.
export function runCommand(argv, cwd, { timeout = 120000, env = {} } = {}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x => typeof x !== 'string' || x.includes('\0'))) fail('invalid_command', 'argv must be nonempty strings.');
  const base = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  return new Promise(resolve => {
    let stdout = '', stderr = '', bytes = 0, stopped = null;
    const start = Date.now();
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...base, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const stop = reason => { stopped = reason; try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(() => stop('timeout'), timeout);
    const consume = (d, err) => {
      bytes += d.length; if (bytes > 1024 * 1024) stop('output_limit');
      if (err) stderr = (stderr + d.toString()).slice(-16000); else stdout = (stdout + d.toString()).slice(-16000);
    };
    child.stdout.on('data', d => consume(d, false)); child.stderr.on('data', d => consume(d, true));
    child.on('error', e => { stderr += e.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ argv, exit_code: code, signal, stopped, stdout, stderr, elapsed_ms: Date.now() - start }); });
  });
}

export class OSS extends HotPick {
  async trending({ since = 'weekly', language = '' } = {}) {
    if (!['daily', 'weekly', 'monthly'].includes(since) || !/^[\w+#.-]*$/.test(language)) fail('invalid_trending', 'Use daily, weekly, or monthly and a language slug.');
    const url = `https://github.com/trending${language ? '/' + encodeURIComponent(language) : ''}?since=${since}`;
    const html = await this.cached(url, { json: false, stale: true, max: 4 * 1024 * 1024, accept: 'text/html' });
    return { source: url, ...this.freshness(url), repositories: parseTrending(html, { since, language }), scope: 'Repositories displayed by this GitHub Trending page, not every trending project.' };
  }
  freshness(url) { return { observed_at: new Date(this.now()).toISOString(), data_checked_at: this.observations?.get(url) ? new Date(this.observations.get(url)).toISOString() : null }; }
  async discover(query, options = {}) {
    if (!query || query.length > 200) fail('invalid_query', 'Use up to 200 characters of public task keywords.');
    const limit = Math.min(options.limit || 10, 100);
    const params = new URLSearchParams({ q: `${query} archived:false fork:false`, per_page: String(Math.max(limit, 20)) });
    const url = `${this.github}/search/repositories?${params}`;
    let data, trend;
    const outcomes = await Promise.allSettled([this.cached(url, { stale: true }), this.trending(options)]);
    if (outcomes[0].status === 'fulfilled') data = outcomes[0].value;
    else this.warn(`search_failed:${outcomes[0].reason.code || outcomes[0].reason.name}`);
    if (outcomes[1].status === 'fulfilled') trend = outcomes[1].value;
    else this.warn(`trending_failed:${outcomes[1].reason.code || outcomes[1].reason.name}`);
    if (!data && !trend) throw outcomes[0].reason;
    if (data && !Array.isArray(data.items)) fail('invalid_search', 'GitHub search returned an invalid items array.');
    if (data?.incomplete_results) this.warn('github_search_incomplete');
    const byRepo = new Map((trend?.repositories || []).map(r => [r.repo.toLowerCase(), r]));
    const candidates = (data?.items || []).filter(r => !r.archived && !r.fork).map((r, i) => ({
      repo: repoID(r.full_name), description: r.description, language: r.language, stars: r.stargazers_count,
      license: r.license?.spdx_id || null, pushed_at: r.pushed_at, topics: r.topics || [],
      github_search_rank: i + 1, discovery: 'github_task_search', trending: byRepo.get(r.full_name.toLowerCase()) || null
    }));
    // Supplement recall from real Trending cards. This lexical check is not a semantic verdict.
    const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const seen = new Set(candidates.map(c => c.repo.toLowerCase()));
    for (const r of trend?.repositories || []) {
      const corpus = `${r.repo} ${r.description}`.toLowerCase();
      if (!seen.has(r.repo.toLowerCase()) && words.some(w => w.length > 2 && corpus.includes(w))) candidates.push({ ...r, stars: r.total_stars, trending: r, discovery: 'trending_lexical_candidate', github_search_rank: null });
    }
    candidates.sort((a, b) => Number(!!b.trending) - Number(!!a.trending) || (a.github_search_rank ?? Infinity) - (b.github_search_rank ?? Infinity));
    return { query, ...this.freshness(url), candidates: candidates.slice(0, limit), trending_source: trend?.source || null,
      ranking: 'Trending matches first, then GitHub relevance. Host must inspect task fit; absence from this page is not proof of no momentum.', application_required: true };
  }
  async repository(source, { ref } = {}) {
    const repo = repoID(source), meta = await this.resolve(repo, ref);
    const tree = await this.tree(repo, meta.commit);
    const select = tree.filter(f => f.type === 'blob' && (/^(readme(?:\.[\w-]+)?|licen[sc]e(?:\.[\w-]+)?|copying|package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/i.test(f.path)));
    const evidence = [];
    for (const file of select.slice(0, 8)) {
      try {
        const body = (await this.blob(repo, meta.commit, file)).toString('utf8');
        evidence.push({ path: file.path, blob_sha: file.sha, url: `https://github.com/${repo}/blob/${meta.commit}/${file.path}`, text: body.slice(0, 16000), truncated: body.length > 16000 });
      } catch (e) { this.warn(`evidence_unavailable:${file.path}:${e.code}`); }
    }
    if (!evidence.some(e => /^readme/i.test(e.path))) this.warn('readme_missing_or_unavailable');
    const manifests = evidence.filter(e => /^(package\.json|pyproject\.toml|cargo\.toml|go\.mod)$/.test(e.path)).map(e => e.path);
    const types = [];
    if (tree.some(f => /(^|\/)SKILL\.md$/.test(f.path))) types.push('skill');
    if (manifests.length) types.push('library_or_cli');
    if (!types.length) types.push('source_project');
    return { ...meta, ...this.freshness(`${this.github}/repos/${repo}`), evidence, type_hints: types,
      relevant_paths: tree.filter(f => /(^|\/)(docs?|examples?|src)(\/|$)|SKILL\.md$|mcp/i.test(f.path)).slice(0, 80).map(f => f.path),
      file_count: tree.length, next_step: 'Read needed files at this commit; choose based on operation, stack, dependencies and license. Type hints are not verified capabilities.' };
  }
  async readSource(source, filePath, ref, full = false, options = {}) {
    const repo = repoID(source), commit = pinned(ref), file = safePath(filePath || '');
    const entry = (await this.tree(repo, commit)).find(f => f.path === file);
    if (!entry) fail('file_not_found', file);
    const body = (await this.blob(repo, commit, entry)).toString('utf8');
    if(options.find!==undefined)return {repo,commit,path:file,blob_sha:entry.sha,...sourceSnippets(body,options.find,{context:options.context,limit:options.limit})};
    return { repo, commit, path: file, blob_sha: entry.sha, text: full ? body : body.slice(0, 48000), truncated: !full && body.length > 48000 };
  }
  async acquire(source, ref, workspace) {
    const repo = repoID(source), commit = pinned(ref);
    if (!workspace) fail('workspace_required', 'Set --workspace to the task directory.');
    const root = path.resolve(workspace);
    await fs.mkdir(root, { recursive: true });
    const directory = path.join(root, '.hot-pick', 'sources', repo.replace('/', '__'), commit);
    const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
    const git = async (args, cwd) => {
      const r = await runCommand(['git', '-c', 'core.hooksPath=/dev/null', ...args], cwd, { timeout: 120000, env });
      if (r.exit_code !== 0) fail('git_failed', r.stderr || r.stopped || 'Git command failed');
      return r.stdout.trim();
    };
    let exists = false;
    try { await fs.access(directory); exists = true; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!exists) {
      if (this.offline) fail('offline_miss', 'Pinned checkout not available locally.');
      await fs.mkdir(path.dirname(directory), { recursive: true });
      const stage = `${directory}.${crypto.randomUUID()}.tmp`;
      await fs.mkdir(stage);
      try {
        await git(['init', '--quiet'], stage);
        await git(['remote', 'add', 'origin', `https://github.com/${repo}.git`], stage);
        await git(['fetch', '--depth', '1', 'origin', commit], stage);
        await git(['checkout', '--detach', '--quiet', 'FETCH_HEAD'], stage);
        if ((await git(['rev-parse', 'HEAD'], stage)) !== commit) fail('commit_mismatch', 'Fetched checkout differs from requested commit.');
        await fs.rename(stage, directory);
      } finally { await fs.rm(stage, { recursive: true, force: true }); }
    }
    if ((await git(['rev-parse', 'HEAD'], directory)) !== commit || (await git(['remote', 'get-url', 'origin'], directory)) !== `https://github.com/${repo}.git`) fail('checkout_mismatch', 'Existing checkout does not match source and commit.');
    if (await git(['status', '--porcelain', '--untracked-files=normal'], directory)) fail('checkout_modified', 'Pinned checkout has changes; keep task outputs outside it.');
    return { repo, commit, directory, reused: exists, executed: false, next_step: 'Review source/dependencies, write a local task plan, then apply it. No build/install hooks ran during acquisition.' };
  }
  async apply(planFile) {
    const planPath = path.resolve(planFile || '');
    const plan = JSON.parse(await fs.readFile(planPath, 'utf8'));
    if (plan.version !== 1 || typeof plan.task !== 'string' || !plan.task.trim() || !Array.isArray(plan.steps) || !plan.steps.length || !Array.isArray(plan.checks) || !plan.checks.length || !Array.isArray(plan.artifacts) || !plan.artifacts.length) fail('invalid_plan', 'Need version:1, task, source, workspace, steps, checks and artifacts.');
    if (typeof plan.workspace !== 'string' || !plan.source) fail('invalid_plan', 'workspace and source are required.');
    const workspace = path.resolve(path.dirname(planPath), plan.workspace);
    const checkout = await this.acquire(plan.source.repo, plan.source.commit, workspace);
    const substitute = s => s.replaceAll('${workspace}', workspace).replaceAll('${source}', checkout.directory);
    const commands = items => items.map(item => {
      if (!item.name || !Array.isArray(item.argv) || !item.argv.length || item.argv.some(a => typeof a !== 'string' || a.includes('\0'))) fail('invalid_plan', 'Each step/check needs a name and argv string array.');
      const cwd = item.cwd ? path.resolve(workspace, safePath(item.cwd)) : workspace;
      const timeout = item.timeout_ms ?? 120000;
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600000) fail('invalid_plan', 'timeout_ms must be 1..600000.');
      const env = item.env || {};
      if (Object.values(env).some(v => typeof v !== 'string')) fail('invalid_plan', 'Environment values must be strings.');
      return { name: item.name, argv: item.argv.map(substitute), cwd, timeout, env: Object.fromEntries(Object.entries(env).map(([k, v]) => [k, substitute(v)])) };
    });
    const steps = commands(plan.steps), checks = commands(plan.checks);
    const artifacts = plan.artifacts.map(safePath);
    const id = `${Date.now()}-${crypto.randomUUID()}`;
    const receiptPath = path.join(workspace, '.hot-pick', 'runs', `${id}.json`);
    const receipt = { schema: 1, task: plan.task, source: { repo: checkout.repo, commit: checkout.commit }, plan_sha256: hash(await fs.readFile(planPath)), status: 'running', started_at: new Date().toISOString(), steps: [], checks: [], artifacts: [] };
    await save(receiptPath, receipt);
    try {
      for (const [kind, list] of [['steps', steps], ['checks', checks]]) {
        for (const item of list) {
          const r = await runCommand(item.argv, item.cwd, item);
          receipt[kind].push({ name: item.name, ...r });
          await save(receiptPath, receipt);
          if (r.exit_code !== 0 || r.stopped) fail('execution_failed', `${kind}: ${item.name} failed (${r.stopped || r.exit_code}).`);
        }
      }
      const realRoot = await fs.realpath(workspace);
      for (const rel of artifacts) {
        const file = path.join(workspace, rel), real = await fs.realpath(file);
        if (!real.startsWith(realRoot + path.sep) || !(await fs.stat(real)).isFile()) fail('invalid_artifact', 'Artifacts must be files within the task workspace.');
        const bytes = await fs.readFile(real);
        receipt.artifacts.push({ path: rel, bytes: bytes.length, sha256: hash(bytes) });
      }
      receipt.status = 'checks_passed';
    } catch (e) { receipt.status = 'failed'; receipt.error = { code: e.code || e.name, message: e.message }; }
    receipt.finished_at = new Date().toISOString();
    await save(receiptPath, receipt);
    return { ...receipt, receipt_path: receiptPath, qualification: 'Checks and artifacts were observed; their adequacy for the user task is assessed by the host, not by exit codes alone.' };
  }
}

export async function ossCommand(command, args, options) {
  const c = new OSS(options);
  let result;
  if (command === 'discover') result = await c.discover(args.join(' '), options);
  if (command === 'trending') result = await c.trending(options);
  if (command === 'repo') result = await c.repository(args[0], options);
  if (command === 'read') result = await c.readSource(args[0], options.file, options.ref, options.text, options);
  if (command === 'acquire') result = await c.acquire(args[0], options.ref, options.workspace);
  if (command === 'apply') result = await c.apply(options.plan);
  return { ...result, warnings: c.warnings, metrics: c.stats };
}
