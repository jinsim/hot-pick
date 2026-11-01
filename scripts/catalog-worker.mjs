// launchd/cron entrypoint: credentials remain in memory, never in config or logs.
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
export function runWorker(config,{run=spawnSync,environment=process.env,getGithubToken=()=>execFileSync('gh',['auth','token'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}={}) {
if(!config) throw Error('Pass an absolute catalog config path');
const env={...environment};
if(!env.GITHUB_TOKEN) {try {env.GITHUB_TOKEN=getGithubToken();} catch { /* Public unauthenticated requests remain supported. */ }}
const r=run(process.execPath,[fileURLToPath(new URL('../skills/hot-pick/scripts/hot-pick.mjs',import.meta.url)),'catalog-sync','--config',config],{env,stdio:'inherit'});
let status=r.status ?? 1;
// Optional operator publishing: the user skill never requires Google credentials.
if(r.status===0 && environment.HOT_PICK_FIREBASE_PROJECT) {
  const exported=path.join(os.homedir(),'.cache/hot-pick/task-catalog/published/catalog.json');
  const publishEnv={...environment};
  delete publishEnv.GITHUB_TOKEN; delete publishEnv.GH_TOKEN;
  const output=run(process.execPath,[fileURLToPath(new URL('./catalog-export.mjs',import.meta.url)),'--out',exported],{env:publishEnv,stdio:'inherit'});
  status=output.status ?? 1;
  if(output.status===0) {
    const publication=run(process.execPath,[fileURLToPath(new URL('../service/firebase-publish.mjs',import.meta.url)),environment.HOT_PICK_FIREBASE_PROJECT,exported],{env:publishEnv,stdio:'inherit'});
    status=publication.status ?? 1;
  }
}
return status;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode=runWorker(process.argv[2]);
