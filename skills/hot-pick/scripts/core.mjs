#!/usr/bin/env node
// No downloaded skill code is executed by this module.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const VERSION = '0.2.0';
const MAX_RESPONSE = 20 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;
const MAX_FILES = 200;
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const gitHash = x => crypto.createHash('sha1').update(`blob ${x.length}\0`).update(x).digest('hex');
const encodePath = p => p.split('/').map(encodeURIComponent).join('/');
const tokens = s => [...new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])];

export class HotPickError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new HotPickError(code, message); }
export function safePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || /[\\\x00-\x1f:]/.test(p) || p.split('/').some(x => !x || x === '.' || x === '..'))
    fail('unsafe_path', `Unsafe repository path: ${JSON.stringify(p)}`);
  return p;
}
export function parseSource(s) {
  const m = /^([\w.-]+\/[\w.-]+)(?:@([\w.-]+))?$/.exec(s || '');
  if (!m || m[1].split('/').some(x => x === '.' || x === '..')) fail('invalid_source', 'Use owner/repository@skill-name; URLs and shell commands are not source IDs.');
  return { repo: m[1], skill: m[2] };
}
async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return null; throw e; }
}
async function atomic(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try { await fs.writeFile(tmp, data, { mode: 0o600 }); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }); }
}
const writeJSON = (p, d) => atomic(p, JSON.stringify(d));

// BM25 is only an offline retrieval fallback, never a quality/confidence estimate.
export function bm25(query, docs) {
  const q = tokens(query), words = docs.map(d => String(d.text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
  const avg = words.reduce((n, w) => n + w.length, 0) / (words.length || 1) || 1;
  return docs.map((d, i) => ({ ...d, retrieval_score: q.reduce((s, t) => {
    const df = words.filter(w => w.includes(t)).length;
    const tf = words[i].filter(w => w === t).length;
    return s + Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)) * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * words[i].length / avg));
  }, 0) })).filter(d => d.retrieval_score > 0).sort((a, b) => b.retrieval_score - a.retrieval_score);
}

export class HotPick {
  constructor(options = {}) {
    this.dir = path.resolve(options.cache || path.join(os.homedir(), '.cache', 'hot-pick'));
    this.ttl = options.ttl ?? 600;
    this.offline = !!options.offline;
    this.refresh = !!options.refresh;
    this.timeout = options.timeout ?? 8000;
    this.api = options.api || 'https://skills.sh';
    this.github = options.github || 'https://api.github.com';
    this.raw = options.raw || 'https://raw.githubusercontent.com';
    this.fetch = options.fetch || globalThis.fetch;
    this.now = options.now || Date.now;
    this.stats = { requests: 0, bytes: 0, cache_hits: 0, revalidated: 0 };
    this.warnings = [];
    this.observations = new Map();
  }
  warn(s) { if (!this.warnings.includes(s)) this.warnings.push(s); }
  async cached(url, { immutable = false, stale = false, json = true, max = MAX_RESPONSE, accept } = {}) {
    const key = path.join(this.dir, 'http', `${sha(url)}.json`);
    const old = await readJSON(key);
    const valid = old && typeof old.body === 'string' && old.digest === sha(old.body);
    const age = valid ? Math.max(0, (this.now() - old.at) / 1000) : Infinity;
    const decode = body => json ? JSON.parse(body) : body;
    if (valid && (immutable || (!this.refresh && age < this.ttl) || this.offline)) {
      this.observations.set(url, old.at);
      this.stats.cache_hits++;
      if (this.offline && !immutable && age >= this.ttl) this.warn(`offline_cache_age_seconds:${Math.round(age)}`);
      return decode(old.body);
    }
    if (this.offline) fail('offline_miss', 'This request is not cached. Retry online or continue without an external skill.');
    const headers = { Accept: accept || (json ? 'application/json' : 'text/plain'), 'User-Agent': `hot-pick/${VERSION}` };
    if (valid && old.etag) headers['If-None-Match'] = old.etag;
    // Never forward a token to a registry, raw-content server, or redirected host.
    if (new URL(url).origin === 'https://api.github.com' && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    try {
      this.stats.requests++;
      const res = await this.fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(this.timeout) });
      if (res.status === 304 && valid) {
        this.observations.set(url, this.now());
        this.stats.revalidated++;
        await writeJSON(key, { ...old, at: this.now() });
        return decode(old.body);
      }
      if (!res.ok) fail(`http_${res.status}`, `HTTP ${res.status} from ${new URL(url).hostname}; retry-after=${res.headers.get('retry-after') || 'unspecified'}`);
      if (Number(res.headers.get('content-length') || 0) > max) fail('response_limit', 'Response is too large.');
      const chunks = []; let size = 0;
      for await (const part of res.body) {
        size += part.length;
        if (size > max) fail('response_limit', 'Response is too large.');
        chunks.push(part);
      }
      this.stats.bytes += size;
      const body = Buffer.concat(chunks).toString('utf8');
      const value = decode(body);
      await writeJSON(key, { at: this.now(), etag: res.headers.get('etag'), digest: sha(body), body });
      this.observations.set(url, this.now());
      return value;
    } catch (e) {
      if (valid && stale) {
        this.observations.set(url, old.at);
        this.warn(`stale_cache:${e.code || e.name}:age_seconds=${Math.round(age)}`);
        this.stats.cache_hits++;
        return decode(old.body);
      }
      if (e instanceof HotPickError) throw e;
      fail('network_error', `Request failed (${e.name}); no empty-result substitution.`);
    }
  }
  async records() {
    const dir = path.join(this.dir, 'catalog');
    let names;
    try { names = await fs.readdir(dir); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
    return (await Promise.all(names.filter(n => n.endsWith('.json')).map(n => readJSON(path.join(dir, n))))).filter(Boolean);
  }
  async record(data) {
    await writeJSON(path.join(this.dir, 'catalog', `${sha(`${data.repo}:${data.skill_path}:${data.ref}`)}.json`), data);
  }
  async search(query, { limit = 5, owner } = {}) {
    query = String(query).trim().replace(/\s+/g, ' ').toLowerCase();
    if (!query || query.length > 200) fail('invalid_query', 'Use 1–200 characters of public task keywords; omit private task content.');
    const p = new URLSearchParams({ q: query, limit: '20' });
    if (owner) p.set('owner', owner);
    let rows, mode = 'registry';
    try {
      const data = await this.cached(`${this.api}/api/search?${p}`, { stale: true });
      if (!Array.isArray(data.skills)) fail('invalid_response', 'Registry response has no skills array.');
      rows = data.skills.flatMap(s => {
        try {
          parseSource(`${s.source}@${s.name}`);
          if (!Number.isFinite(s.installs) || s.installs < 0) return [];
          return [{ source: s.source, name: s.name, installs: s.installs, selector: `${s.source}@${s.name}` }];
        } catch { return []; }
      }).filter(s => !owner || s.source.split('/')[0] === owner);
      rows = [...new Map(rows.map(s => [s.selector, s])).values()].sort((a, b) => b.installs - a.installs);
    } catch (e) {
      const docs = (await this.records()).filter(d => !owner || d.repo.split('/')[0] === owner).map(d => ({ ...d, text: `${d.name} ${d.instructions}` }));
      rows = bm25(query, docs).map(d => ({ selector: `${d.repo}@${d.name}`, source: d.repo, name: d.name, path: d.skill_path, commit: d.commit, stars: d.stars, retrieval_score: d.retrieval_score }));
      if (!rows.length) throw e;
      mode = 'local_bm25'; this.warn(`registry_unavailable:${e.code || e.name}`);
    }
    return { query, mode, candidates: rows.slice(0, limit), selection_required: true, ranking_note: 'Registry recall, then installs. Read actual instructions before choosing; installs are not GitHub stars or outcome quality.' };
  }
  async resolve(repo, ref) {
    const metadata = await this.cached(`${this.github}/repos/${repo}`, { stale: true });
    ref ||= metadata.default_branch;
    if (typeof ref !== 'string' || !ref || ref.length > 200) fail('invalid_ref', 'A branch or commit is required.');
    const fixed = /^[a-f0-9]{40}$/.test(ref);
    // Mutable ref failures are explicit. Never silently pretend the old commit is current.
    const data = fixed ? { sha: ref } : await this.cached(`${this.github}/repos/${repo}/commits/${encodeURIComponent(ref)}`);
    if (!/^[a-f0-9]{40}$/.test(data.sha || '')) fail('invalid_commit', 'GitHub did not return a full commit SHA.');
    return { repo, ref, commit: data.sha, stars: metadata.stargazers_count ?? null, license: metadata.license?.spdx_id ?? null, archived: !!metadata.archived, observed_at: this.now() };
  }
  async tree(repo, commit) {
    const data = await this.cached(`${this.github}/repos/${repo}/git/trees/${commit}?recursive=1`, { immutable: true });
    if (data.truncated || !Array.isArray(data.tree)) fail('incomplete_tree', 'Repository tree is incomplete. Use a smaller upstream skill repository.');
    for (const f of data.tree) safePath(f.path);
    return data.tree;
  }
  async blob(repo, commit, file) {
    if (file.type !== 'blob' || !['100644', '100755'].includes(file.mode)) fail('unsupported_file', `Symlinks/submodules are not loaded: ${file.path}`);
    if (!/^[a-f0-9]{40}$/.test(file.sha || '') || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE) fail('file_limit', `Invalid or oversized blob: ${file.path}`);
    const target = path.join(this.dir, 'blobs', file.sha);
    try { const data = await fs.readFile(target); if (gitHash(data) === file.sha) { this.stats.cache_hits++; return data; } }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (this.offline) fail('offline_miss', `Blob is not cached: ${file.path}`);
    const url = `${this.raw}/${repo}/${commit}/${encodePath(safePath(file.path))}`;
    this.stats.requests++;
    let res;
    try { res = await this.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(this.timeout) }); }
    catch (e) { fail('network_error', `Blob request failed (${e.name}).`); }
    if (!res.ok) fail(`http_${res.status}`, `Cannot fetch blob: ${file.path}`);
    const chunks = []; let size = 0;
    for await (const chunk of res.body) { size += chunk.length; if (size > MAX_FILE) fail('file_limit', file.path); chunks.push(chunk); }
    const data = Buffer.concat(chunks); this.stats.bytes += size;
    if (gitHash(data) !== file.sha) fail('integrity_error', `Git blob checksum mismatch: ${file.path}`);
    await atomic(target, data);
    return data;
  }
  async seedSnapshot(d) {
    if (this.offline) return;
    // Borrow the ecosystem's batch-download fast path, but validate every accepted
    // byte against our pinned Git tree; an unversioned snapshot cannot change the pin.
    const missing = [];
    for (const f of d.files) {
      try { if (gitHash(await fs.readFile(path.join(this.dir, 'blobs', f.sha))) === f.sha) continue; }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      missing.push(f);
    }
    if (missing.length < 4) return; // A small delta is cheaper than a whole snapshot.
    const parent = path.posix.dirname(d.skill_path);
    try {
      const snapshot = await this.cached(`${this.api}/api/download/${d.repo}/${encodeURIComponent(d.name)}`);
      if (!Array.isArray(snapshot.files) || snapshot.files.length > MAX_FILES) fail('snapshot_invalid', 'Invalid snapshot inventory.');
      const entries = new Map();
      for (const f of snapshot.files) {
        safePath(f.path);
        if (entries.has(f.path) || typeof f.contents !== 'string') fail('snapshot_invalid', 'Duplicate or invalid snapshot file.');
        entries.set(f.path, f.contents);
      }
      let accepted = 0;
      for (const f of missing) {
        const relative = parent === '.' ? f.path : f.path.slice(parent.length + 1);
        if (!entries.has(relative) || !['100644', '100755'].includes(f.mode)) continue;
        const bytes = Buffer.from(entries.get(relative), 'utf8');
        if (bytes.length <= MAX_FILE && gitHash(bytes) === f.sha) { await atomic(path.join(this.dir, 'blobs', f.sha), bytes); accepted++; }
      }
      this.stats.snapshot_files = (this.stats.snapshot_files || 0) + accepted;
      if (accepted < missing.length) this.warn(`snapshot_partial:${accepted}/${missing.length}:remaining_files_fetched_at_pinned_commit`);
    } catch (e) { this.warn(`snapshot_fallback:${e.code || e.name}`); }
  }
  async inspect(selector, { skillPath, ref } = {}) {
    const { repo, skill } = parseSource(selector);
    const meta = await this.resolve(repo, ref);
    const tree = await this.tree(repo, meta.commit);
    const all = tree.filter(f => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
    let candidates = skillPath ? all.filter(f => f.path === safePath(skillPath)) : all.filter(f => !skill || path.posix.basename(path.posix.dirname(f.path)) === skill);
    // A frontmatter name can differ from its directory. Do not guess in a monorepo.
    if (!candidates.length && skill && !skillPath) candidates = all.filter(f => skill.endsWith(`-${path.posix.basename(path.posix.dirname(f.path))}`));
    if (!candidates.length && !skillPath && all.length === 1) candidates = all;
    if (candidates.length !== 1) fail('ambiguous_skill', JSON.stringify({ message: 'Specify --path using one exact SKILL.md path.', paths: all.slice(0, 50).map(f => f.path), total: all.length }));
    const file = candidates[0];
    if (skillPath && file.path !== skillPath) fail('skill_not_found', 'The requested SKILL.md path does not exist.');
    const instructions = (await this.blob(repo, meta.commit, file)).toString('utf8');
    if (!instructions.startsWith('---')) fail('invalid_skill', 'SKILL.md must have frontmatter.');
    const name = /^name:\s*["']?([\w.-]+)["']?\s*$/m.exec(instructions)?.[1];
    if (!name || (skill && name !== skill)) fail('skill_name_mismatch', `Requested ${skill || 'a skill'}; frontmatter name is ${name || 'missing'}. Use the actual name and --path.`);
    const parent = path.posix.dirname(file.path);
    const files = tree.filter(f => f.type !== 'tree' && (parent === '.' || f.path.startsWith(`${parent}/`)));
    const readme = tree.find(f => /^readme\.md$/i.test(f.path));
    let overview = null;
    if (readme && readme.size <= MAX_FILE) {
      try { overview = (await this.blob(repo, meta.commit, readme)).toString('utf8').slice(0, 6000); }
      catch (e) { this.warn(`readme_unavailable:${e.code || e.name}`); }
    }
    const result = { ...meta, name, skill_path: file.path, instructions, overview, file_count: files.length, bytes: files.reduce((n, f) => n + (f.size || 0), 0), files: files.map(f => ({ path: f.path, sha: f.sha, mode: f.mode, size: f.size, type: f.type })), trust: 'Untrusted third-party instructions; retrieval and checksums are not a security audit.' };
    await this.record(result);
    return result;
  }
  async prepare(selector, options = {}) {
    const d = await this.inspect(selector, options);
    if (d.file_count > MAX_FILES || d.bytes > MAX_RESPONSE) fail('bundle_limit', `Bundle exceeds ${MAX_FILES} files or ${MAX_RESPONSE} bytes. No partial skill was produced.`);
    // Content identity lets unrelated commits reuse the exact same prepared subtree.
    const identity = sha(JSON.stringify(d.files.map(f => [f.path, f.sha, f.mode])));
    const dir = path.join(this.dir, 'bundles', identity);
    const parent = path.posix.dirname(d.skill_path);
    const relative = f => parent === '.' ? f.path : f.path.slice(parent.length + 1);
    const existing = await readJSON(path.join(dir, '.curator-manifest.json'));
    let ready = existing?.identity === identity;
    // Do not follow a replaced directory or any symlink in a cached bundle.
    async function verifyBundle() {
      if ((await fs.lstat(dir)).isSymbolicLink()) fail('cache_integrity_error', 'Bundle root is a symlink. Use a fresh cache directory.');
      for (const f of d.files) {
        const parts = safePath(relative(f)).split('/');
        let dest = dir;
        for (const part of parts) {
          dest = path.join(dest, part);
          if ((await fs.lstat(dest)).isSymbolicLink()) fail('cache_integrity_error', 'Bundle contains a symlink. Use a fresh cache directory.');
        }
        if (gitHash(await fs.readFile(dest)) !== f.sha) fail('cache_integrity_error', 'Bundle content changed. Use a fresh cache directory.');
      }
    }
    if (ready) {
      await verifyBundle();
    }
    if (!ready) {
      await this.seedSnapshot(d);
      const staging = `${dir}.${crypto.randomUUID()}.tmp`;
      await fs.mkdir(staging, { recursive: true, mode: 0o700 });
      try {
        // Bounded concurrency limits API burst and memory.
        for (let i = 0; i < d.files.length; i += 4) {
          const batch = await Promise.allSettled(d.files.slice(i, i + 4).map(async f => {
            const local = safePath(relative(f));
            if (local === '.curator-manifest.json') fail('reserved_path', 'Upstream uses a reserved manifest filename.');
            const bytes = await this.blob(d.repo, d.commit, f);
            const dest = path.join(staging, local);
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, bytes, { mode: f.mode === '100755' ? 0o700 : 0o600 });
          }));
          const failed = batch.find(r => r.status === 'rejected');
          if (failed) throw failed.reason;
        }
        await writeJSON(path.join(staging, '.curator-manifest.json'), { identity, files: d.files });
        // Valid concurrent writers have identical content. Never replace a healthy bundle.
        try { await fs.rename(staging, dir); }
        catch (e) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e;
          await verifyBundle();
        }
      } finally { await fs.rm(staging, { recursive: true, force: true }); }
    }
    return { selector: `${d.repo}@${d.name}`, commit: d.commit, ref: d.ref, bundle_id: identity, directory: dir, entrypoint: path.join(dir, 'SKILL.md'), files: d.file_count, reused: ready, global_install: false, executed: false, stars: d.stars, license: d.license };
  }
  async refreshTracked(limit = 10) {
    const rows = (await this.records()).sort((a, b) => (a.observed_at || 0) - (b.observed_at || 0)); const result = [];
    // One mutable-ref request per repo/ref in a run; refresh may force validation.
    const resolved = new Map();
    for (const r of rows.slice(0, limit)) {
      try {
        const key = `${r.repo}:${r.ref}`;
        if (!resolved.has(key)) resolved.set(key, await this.resolve(r.repo, r.ref));
        const now = resolved.get(key);
        if (now.commit === r.commit) {
          await this.record({ ...r, ...now });
          result.push({ repo: r.repo, path: r.skill_path, changed: false, commit: now.commit });
        } else {
          const updated = await this.prepare(`${r.repo}@${r.name}`, { skillPath: r.skill_path, ref: r.ref });
          result.push({ repo: r.repo, path: r.skill_path, changed: true, ...updated });
        }
      } catch (e) { result.push({ repo: r.repo, path: r.skill_path, error: e.code || e.name, message: e.message }); }
    }
    return { checked: result.length, remaining: Math.max(0, rows.length - limit), results: result };
  }
}
