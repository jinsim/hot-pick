import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { HotPick } from '../skills/hot-pick/scripts/hot-pick.mjs';

const hash = x => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(x)}\0`).update(x).digest('hex');
export const A = 'a'.repeat(40), B = 'b'.repeat(40);
export async function fixture(t, opts = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator-test-'));
  if (t) t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const state = {
    time: 1700000000000, commit: A, calls: [], fail: false, truncated: false,
    files: {
      'skills/layout/SKILL.md': '---\nname: layout\ndescription: Editorial typography for web UI\n---\n# Layout\nUse references/type.md. Run scripts/check.mjs only after inspecting it.\n',
      'skills/layout/references/type.md': 'Use editorial typography and asymmetric composition.\n',
      'skills/layout/scripts/check.mjs': 'console.log("fixture only");\n',
      'README.md': '# Fixture\nAn editorial web design skill.\n'
    },
    skills: [{ id: 'example/design/layout', source: 'example/design', name: 'layout', installs: 10000 }]
  };
  const fetch = async (url, init = {}) => {
    state.calls.push(url);
    if (state.fail) return new Response('unavailable', { status: 503 });
    const u = new URL(url); let data;
    if (u.pathname === '/api/search') data = { skills: state.skills };
    else if (u.pathname.startsWith('/api/download/') && state.snapshot) data = { files: Object.entries(state.files).filter(([p]) => p.startsWith('skills/layout/')).map(([p, contents]) => ({ path: p.slice('skills/layout/'.length), contents: state.badSnapshot ? 'wrong version' : contents })) };
    else if (u.pathname === '/repos/example/design') data = { default_branch: 'main', stargazers_count: 5000, license: { spdx_id: 'MIT' } };
    else if (u.pathname.startsWith('/repos/example/design/commits/')) data = { sha: /^[ab]{40}$/.test(u.pathname.split('/').at(-1)) ? u.pathname.split('/').at(-1) : state.commit };
    else if (u.pathname.startsWith('/repos/example/design/git/trees/')) data = { truncated: state.truncated, tree: Object.entries(state.files).map(([p, v]) => ({ path: p, sha: hash(v), type: 'blob', mode: state.symlink === p ? '120000' : '100644', size: Buffer.byteLength(v) })) };
    else if (u.hostname === 'raw.githubusercontent.com') {
      const p = decodeURIComponent(u.pathname.split('/').slice(4).join('/'));
      if (!(p in state.files)) return new Response('missing', { status: 404 });
      return new Response(state.corrupt ? 'tampered' : state.files[p]);
    } else return new Response('missing', { status: 404 });
    const body = JSON.stringify(data), etag = hash(body);
    if (init.headers?.['If-None-Match'] === etag) return new Response(null, { status: 304 });
    return new Response(body, { headers: { etag, 'content-type': 'application/json' } });
  };
  const create = extra => new HotPick({ cache: dir, fetch, now: () => state.time, ...opts, ...extra });
  return { dir, state, create, c: create(), fetch };
}
