// Run: node benchmarks/lazy-catalog.mjs SNAPSHOT_JSON TOKENIZER_MODULE
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';import {gzipSync} from 'node:zlib';
import {Catalog} from '../skills/hot-pick/scripts/catalog.mjs';import {publicSnapshot} from '../skills/hot-pick/scripts/catalog-snapshot.mjs';import {splitCatalog,validateIndex,hash} from '../skills/hot-pick/scripts/catalog-index.mjs';
const [file,tokenizer]=process.argv.slice(2);const require=createRequire(import.meta.url);const {getEncoding}=require(path.resolve(tokenizer));const enc=getEncoding('o200k_base');
const full=publicSnapshot(JSON.parse(await fs.readFile(file))),split=splitCatalog(full),index=validateIndex(split.index);const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hp-index-eval-'));const rows=[];
Date.now=()=>Date.parse(full.updated_at); // Freeze popularity decay for paired comparison.
const tasks=[['keyboard','focus','accessibility'],['python','scraping','html'],['react','performance','render'],['ranking','scoring','statistics']];
const normalize=x=>JSON.stringify(x,(k,v)=>['trace_id','created_at','elapsed_ms','catalog_origin'].includes(k)?undefined:v);
try{for(const keywords of tasks){
 const client=new Catalog({cache:dir,fetch:async url=>new Response(split.files[new URL(url).pathname])});const task={operations:[{intent:keywords.join(' '),keywords}]};
 const a=await client.route(task,full,'https://example.org/catalog.json');const b=await client.route(task,index,'https://example.org/index.json');
 const ids=r=>r.operations[0].candidates.map(c=>[c.id,c.retrieval_score]);if(JSON.stringify(ids(a))!==JSON.stringify(ids(b)))throw Error('Ranking differs');
 const selected=b.operations[0].candidates[0]?.id;let detailBytes=0,oldDetail='',newDetail='';
 if(selected){oldDetail=normalize(await client.detail(a.trace_id,selected));newDetail=normalize(await client.detail(b.trace_id,selected));if(oldDetail!==newDetail)throw Error('Detail differs');detailBytes=Buffer.byteLength(split.files[`/details/${index.cards[selected].detail_hash}.json`]);}
 rows.push({keywords,candidates:ids(b),selected,detail_bytes:detailBytes,route_tokens:{full:enc.encode(normalize(a)).length,index:enc.encode(normalize(b)).length},route_and_selected_detail_tokens:{full:enc.encode(normalize(a)).length+enc.encode(oldDetail).length,index:enc.encode(normalize(b)).length+enc.encode(newDetail).length}});
}
console.log(JSON.stringify({snapshot:{updated_at:full.updated_at,cards:Object.keys(full.cards).length,sha256:hash(JSON.stringify(full))},payload:{full_bytes:Buffer.byteLength(JSON.stringify(full)),index_bytes:Buffer.byteLength(JSON.stringify(index)),full_gzip:gzipSync(JSON.stringify(full)).length,index_gzip:gzipSync(JSON.stringify(index)).length},tokenizer:'js-tiktoken o200k_base',scope:'CLI JSON only, volatile trace/time/origin fields omitted; excludes model reasoning, billing, source reads and tool wrappers. Same ranking and selected full detail required.',cases:rows},null,2));
}finally{await fs.rm(dir,{recursive:true,force:true});}
