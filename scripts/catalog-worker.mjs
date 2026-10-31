// launchd/cron entrypoint: credentials remain in memory, never in config or logs.
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const config=process.argv[2];
if(!config) throw Error('Pass an absolute catalog config path');
const env={...process.env};
if(!env.GITHUB_TOKEN) {try {env.GITHUB_TOKEN=execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();} catch { /* Public unauthenticated requests remain supported. */ }}
const r=spawnSync(process.execPath,[fileURLToPath(new URL('../skills/hot-pick/scripts/hot-pick.mjs',import.meta.url)),'catalog-sync','--config',config],{env,stdio:'inherit'});
process.exitCode=r.status ?? 1;
