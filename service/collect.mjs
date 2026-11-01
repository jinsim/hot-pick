import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../skills/hot-pick/scripts/catalog.mjs';
import { readPublicSnapshot } from './snapshot.mjs';

const repoFile = name => fileURLToPath(new URL(`../${name}`, import.meta.url));
const cache = path.resolve(process.env.CATALOG_CACHE || '/data/cache');
const configFile = process.env.CATALOG_CONFIG || repoFile('config/catalog.json');
const output = path.resolve(process.env.CATALOG_FILE || '/snapshots/catalog.json');
const rel = path.relative(cache, output);
if (!rel || !(rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) {
  throw Error('CATALOG_FILE must be outside the private CATALOG_CACHE');
}

process.umask(0o077);
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
const result = await new Catalog({ cache }).sync({ ...config, prewarm: false });
console.log(JSON.stringify(result));
if (!result.cards && result.errors.length) throw Error('Collection failed without any usable cards');
if (result.errors.length && !result.repositories_synced) throw Error('All repository checks failed; retain the last published catalog');

await fs.mkdir(path.dirname(output), { recursive: true });
const stage = await fs.mkdtemp(path.join(path.dirname(output), '.catalog-export-'));
try {
  const candidate = path.join(stage, 'catalog.json');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [repoFile('scripts/catalog-export.mjs'), '--cache', cache, '--out', candidate],
      { stdio: 'inherit', env: { ...process.env, GITHUB_TOKEN: undefined } });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(Error(`Catalog export failed (${signal ?? code})`));
    });
  });
  await readPublicSnapshot(candidate);
  await fs.rename(candidate, output);
  console.log('Validated public snapshot published');
} finally {
  await fs.rm(stage, { recursive: true, force: true });
}
