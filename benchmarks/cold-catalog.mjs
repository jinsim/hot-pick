// Paired real-network CLI cold-cache timings, alternating order; no LLM calls.
import {execFileSync} from 'node:child_process';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../skills/hot-pick/scripts/hot-pick.mjs',import.meta.url));
const root=await fs.mkdtemp(path.join(os.tmpdir(),'hp-cold-')),results=[];
await fs.writeFile(path.join(root,'task.json'),JSON.stringify({operations:[{intent:'Fix keyboard accessibility',keywords:['keyboard','focus','accessibility']}]}));
try{for(let round=0;round<3;round++)for(const kind of round%2?['index','catalog']:['catalog','index']){
 const cache=path.join(root,`${round}-${kind}`),url=`https://jinsim-hot-pick.web.app/${kind}.json`,start=performance.now();
 const output=JSON.parse(execFileSync(process.execPath,[cli,'catalog-route','--catalog-url',url,'--file',path.join(root,'task.json'),'--cache',cache,'--timeout','120000'],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:150000}));
 if(!output.ok)throw Error(JSON.stringify(output));
 const elapsed_ms=performance.now()-start;
 const first=output.operations[0].candidates[0];let detail_ms=null;
 if(first){const start=performance.now();const detail=JSON.parse(execFileSync(process.execPath,[cli,'catalog-detail','--trace',output.trace_id,first.id,'--cache',cache,'--timeout','120000'],{encoding:'utf8',maxBuffer:8*1024*1024,timeout:150000}));if(!detail.ok)throw Error(JSON.stringify(detail));detail_ms=performance.now()-start;}
 results.push({round,kind,elapsed_ms,detail_ms,total_ms:elapsed_ms+(detail_ms||0),requests:output.requests,snapshot:output.catalog_updated_at,ids:output.operations[0].candidates.map(c=>c.id)});
}
 if(new Set(results.map(x=>x.snapshot)).size!==1)throw Error('Catalog changed during comparison; rerun');
 if(new Set(results.map(x=>JSON.stringify(x.ids))).size!==1)throw Error('Candidate order changed');
 console.log(JSON.stringify({checked_at:new Date().toISOString(),method:'Three alternating pairs, fresh client cache each time, real Firebase HTTPS. Includes Node startup. CDN/OS caches uncontrolled; single machine, no universal speed claim.',results},null,2));
}finally{await fs.rm(root,{recursive:true,force:true});}
