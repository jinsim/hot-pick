import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Catalog} from '../skills/hot-pick/scripts/catalog.mjs';
import {readPublicSnapshot} from './snapshot.mjs';

export async function bootstrap(cache, url) {
  const catalog=new Catalog({cache});
  try {await fs.access(path.join(catalog.root,'index.json'));return {seeded:false};}
  catch(error) {if(error.code!=='ENOENT') throw error;}
  // Only the published, validated public catalog crosses the migration boundary.
  const state=await catalog.client.cached(url,{max:32*1024*1024});
  const stage=path.join(cache,'bootstrap.json');
  await fs.writeFile(stage,JSON.stringify(state),{mode:0o600});
  try {
    const snapshot=JSON.parse(await readPublicSnapshot(stage));
    if(!Object.keys(snapshot.cards).length) throw Error('Bootstrap catalog is empty');
    await catalog.publish({...snapshot,repositories:{}});
    return {seeded:true,cards:Object.keys(snapshot.cards).length};
  } finally {await fs.rm(stage,{force:true});}
}

export async function prune(cache, limit=256*1024*1024) {
  const index=await fs.stat(path.join(cache,'task-catalog/index.json'));
  if(index.size>limit) throw Error('Catalog index exceeds cache budget');
  let bytes=index.size;
  const files=[];
  for(const [dir,pattern] of [['http',/^[a-f0-9]{64}\.json$/],['blobs',/^[a-f0-9]{40}$/]]) {
    for(const entry of await fs.readdir(path.join(cache,dir),{withFileTypes:true}).catch(e=>{if(e.code==='ENOENT')return [];throw e;})) {
      if(!entry.isFile() || !pattern.test(entry.name)) throw Error('Unexpected file in collector cache');
      const file=path.join(cache,dir,entry.name),stat=await fs.stat(file);
      files.push({file,size:stat.size,at:stat.mtimeMs});bytes+=stat.size;
    }
  }
  let removed=0;
  for(const f of files.sort((a,b)=>a.at-b.at)) {
    if(bytes<=limit)break;
    await fs.unlink(f.file);bytes-=f.size;removed++;
  }
  return {bytes,removed,limit};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command,cache,url]=process.argv.slice(2);
  if(!cache)throw Error('Pass bootstrap|prune CACHE [PUBLIC_URL]');
  if(command==='bootstrap')console.log(JSON.stringify(await bootstrap(cache,url)));
  else if(command==='prune')console.log(JSON.stringify(await prune(cache)));
  else throw Error('Unknown cloud state command');
}
