import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {publicSnapshot,catalogURL} from './catalog-snapshot.mjs';
import { OSS } from './oss.mjs';
import { parseSource, safePath } from './core.mjs';
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const words = s => String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const load = async (p, fallback) => { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch(e) { if(e.code === 'ENOENT') return fallback; throw e; } };
async function save(p, data) { await fs.mkdir(path.dirname(p), {recursive:true,mode:0o700}); const tmp = `${p}.${crypto.randomUUID()}.tmp`; await fs.writeFile(tmp, JSON.stringify(data,null,2),{mode:0o600}); await fs.rename(tmp,p); }
export function describe(text) {
  const lines = text.split('\n');
  const description = /^description:\s*(.*)$/m.exec(text)?.[1] || '';
  // Extract source passages, not invented semantic classifications or success probabilities.
  const excerpts = regex => lines.flatMap((line,i) => regex.test(line) ? [{line:i+1,text:line.slice(0,800)}] : []).slice(0,20);
  return {description, situations:excerpts(/when|use for|use this|trigger|appropriate/i),
    inputs:excerpts(/input|require|prerequisite|dependenc/i), outputs:excerpts(/output|produce|deliver|generat/i),
    constraints:excerpts(/do not|don't|never|avoid|only|not use/i), headings:excerpts(/^#{1,4} /), method:'source_excerpts', semantic_review:null};
}
export class Catalog {
  constructor(options={}) { this.client=options.client || new OSS(options); this.root=path.join(this.client.dir,'task-catalog'); }
  async state() { return load(path.join(this.root,'index.json'),{schema:1,repositories:{},cards:{},trends:{}}); }
  async publish(state) {
    await save(path.join(this.root,'index.json'),state);
    const cards=Object.fromEntries(Object.entries(state.cards).map(([id,c])=>{const {instructions,overview,fingerprint,...compact}=c;return [id,compact];}));
    await save(path.join(this.root,'routing.json'),{schema:1,updated_at:state.updated_at,cards,trends:state.trends});
  }
  async sync(config) {
    if (![600,1800,3600].includes(config.interval_seconds)) throw Error('interval_seconds must be 600, 1800 or 3600');
    await fs.mkdir(this.root,{recursive:true});
    const lock=path.join(this.root,'sync.lock');
    const fd=await fs.open(lock,'wx').catch(e=>{if(e.code==='EEXIST') throw Error('Another sync owns sync.lock; remove only after confirming its process ended');throw e;});
    await fd.writeFile(String(process.pid));
    const start=Date.now(), changed=[], errors=[];
    try {
      const state=await this.state();
      for (const scope of config.trending || []) {
        try { const t=await this.client.trending(scope); const key=t.source; state.trends[key]={checked_at:t.data_checked_at,repositories:t.repositories}; }
        catch(e) {errors.push({phase:'trending',message:e.message});}
      }
      const seeds=(config.repositories || []).map(r=>parseSource(r).repo);
      const observed=config.include_observed === false ? [] : Object.values(state.trends).flatMap(t=>t.repositories.map(r=>r.repo));
      const repos=[...new Set([...seeds,...observed])];
      // Least recently inspected first prevents starvation when the budget is small.
      repos.sort((a,b)=>(state.repositories[a]?.last_attempt_at || state.repositories[a]?.checked_at || '').localeCompare(state.repositories[b]?.last_attempt_at || state.repositories[b]?.checked_at || ''));
      for (const repo of repos.slice(0,config.max_repositories_per_sync || 12)) {
        try {
          const meta=await this.client.resolve(repo);
          if(meta.archived) {for(const [id,c] of Object.entries(state.cards)) if(c.repo===repo) delete state.cards[id];state.repositories[repo]={...meta,checked_at:new Date().toISOString()};continue;}
          const tree=await this.client.tree(repo,meta.commit);
          const entries=tree.filter(f=>f.type==='blob' && /(^|\/)SKILL\.md$/.test(f.path));
          const keep=new Set(entries.map(e=>`${repo}:${e.path}`));
          for(const [id,c] of Object.entries(state.cards)) if(c.repo===repo && !keep.has(id)) delete state.cards[id];
          const readme=tree.find(f=>/^readme\.md$/i.test(f.path));
          const overview=readme ? (await this.client.blob(repo,meta.commit,readme)).toString('utf8') : '';
          entries.sort((a,b)=>(state.cards[`${repo}:${a.path}`]?.checked_at||'').localeCompare(state.cards[`${repo}:${b.path}`]?.checked_at||''));
          for (const entry of entries.slice(0,config.max_skills_per_repository || 500)) {
            const id=`${repo}:${entry.path}`, old=state.cards[id];
            const parent=path.posix.dirname(entry.path);
            const files=tree.filter(f=>f.type!=='tree' && (parent==='.' || f.path.startsWith(parent+'/')));
            const fingerprint=digest(JSON.stringify(files.map(f=>[f.path,f.sha,f.mode])));
            const text=old?.blob_sha===entry.sha ? old.instructions : (await this.client.blob(repo,meta.commit,entry)).toString('utf8');
            let card={...old,id,repo,commit:meta.commit,skill_path:entry.path,blob_sha:entry.sha,fingerprint,
              name:/^name:\s*["']?([\w.-]+)/m.exec(text)?.[1] || path.posix.basename(parent),
              license:meta.license,stars:meta.stars,instructions:text,overview:overview.slice(0,16000),
              profile:old?.blob_sha===entry.sha ? old.profile : describe(text),checked_at:new Date().toISOString(),
              source:`https://github.com/${repo}/blob/${meta.commit}/${entry.path}`};
            if (old?.fingerprint!==fingerprint) {card.ready=false;delete card.entrypoint; changed.push(id);}
            if(config.prewarm && !card.ready) {
              try { const prepared=await this.client.prepare(repo,{skillPath:entry.path,ref:meta.commit}); card.ready=true;card.entrypoint=prepared.entrypoint; }
              catch(e) { card.preparation_error=e.message; }
            }
            state.cards[id]=card;
            if(Object.keys(state.cards).length % 10 === 0) await this.publish(state);
          }
          if(entries.length>(config.max_skills_per_repository || 500)) errors.push({repo,message:'Skill inventory capped; remaining entries deferred'});
          state.repositories[repo]={...meta,checked_at:new Date().toISOString(),skills:entries.length};
        } catch(e) { errors.push({repo,message:e.message}); }
        state.repositories[repo]={...state.repositories[repo],last_attempt_at:new Date().toISOString()};
        await this.publish(state);
      }
      state.updated_at=new Date().toISOString(); await this.publish(state);
      const result={updated_at:state.updated_at,cards:Object.keys(state.cards).length,ready:Object.values(state.cards).filter(c=>c.ready).length,changed,errors,warnings:this.client.warnings,metrics:this.client.stats,elapsed_ms:Date.now()-start};
      await save(path.join(this.root,'last-sync.json'),result); return result;
    } finally {await fd.close();await fs.rm(lock,{force:true});}
  }
  async label(file) {
    const labels=await load(file,null), state=await this.state();
    if(!Array.isArray(labels)) throw Error('Expected an array of reviewed skill profiles');
    for(const label of labels) {
      const c=state.cards[label.id]; if(!c || c.blob_sha!==label.blob_sha) throw Error('Profile is not pinned to current skill evidence');
      for(const k of ['situations','inputs','outputs','constraints']) if(!Array.isArray(label[k]) || label[k].some(x=>typeof x!=='string')) throw Error(`Expected ${k} string array`);
      if(!Array.isArray(label.evidence) || !label.evidence.length || label.evidence.some(q=>typeof q!=='string'||!c.instructions.includes(q))) throw Error('Evidence quotes must occur verbatim in SKILL.md');
    }
    // Same lock as sync: no lost update between collector and semantic review.
    const lock=path.join(this.root,'sync.lock');const fd=await fs.open(lock,'wx');
    try {const latest=await this.state();for(const label of labels) {if(latest.cards[label.id]?.blob_sha!==label.blob_sha) throw Error('Skill changed during labeling'); latest.cards[label.id].profile.semantic_review=label;} await this.publish(latest);}
    finally {await fd.close();await fs.rm(lock,{force:true});} return {reviewed:labels.length};
  }
  async route(task, remoteSnapshot=null, origin=null) {
    const start=performance.now(), state=remoteSnapshot || await load(path.join(this.root,'routing.json'),null) || await this.state();
    if(!Array.isArray(task.operations)||!task.operations.length||task.operations.length>12) throw Error('Provide 1–12 operations with public keywords');
    const unique=new Map();for(const c of Object.values(state.cards)) {const key=c.repo+':'+c.name;if(!unique.has(key)||(!unique.get(key).ready&&c.ready)) unique.set(key,c);}
    const cards=[...unique.values()];
    const docs=cards.map(c=>{const p=c.profile.semantic_review;return {c,terms:words([c.name,c.profile.description,...(p?.situations||[]),...(p?.outputs||[]),...c.profile.situations.map(x=>x.text),...c.profile.outputs.map(x=>x.text),...c.profile.headings.map(x=>x.text)].join(' '))};});
    const df=new Map();for(const d of docs) for(const term of new Set(d.terms)) df.set(term,(df.get(term)||0)+1);
    const operations=task.operations.map(op=>{
      if(typeof op.intent!=='string'||!Array.isArray(op.keywords)||!op.keywords.length) throw Error('Each operation needs intent and keywords');
      const query=[...new Set(words(op.keywords.join(' ')))];
      const ranked=docs.flatMap(({c,terms})=>{
        if(c.license===null || c.license==='NOASSERTION') return [];
        const matches=query.filter(w=>terms.includes(w));if(matches.length < Math.min(2,query.length)) return [];
        const score=matches.reduce((s,w)=>s+Math.log(1+cards.length/(1+df.get(w))),0)/Math.sqrt(query.length);
        const trend=Object.entries(state.trends).flatMap(([source,t])=>t.repositories.filter(r=>r.repo===c.repo).map(r=>({...r,source,checked_at:t.checked_at})));
        return [{id:c.id,name:c.name,repo:c.repo,commit:c.commit,path:c.skill_path,ready:c.ready,entrypoint:c.entrypoint,profile:c.profile,source:c.source,stars:c.stars,trending:trend,matched_terms:matches,retrieval_score:score,checked_at:c.checked_at}];
      }).sort((a,b)=>b.retrieval_score-a.retrieval_score).slice(0,3);
      return {intent:op.intent,constraints:op.constraints || [],candidates:ranked};
    });
    const result={schema:1,trace_id:crypto.randomUUID(),created_at:new Date().toISOString(),catalog_updated_at:state.updated_at || null,status:'candidates_only',catalog_origin:origin,operations,
      selection_required:'Host must check fit, constraints and expected output, then read full pinned instructions. Scores are retrieval, not success probabilities.',requests:this.client.stats.requests,warnings:this.client.warnings,elapsed_ms:performance.now()-start};
    await save(path.join(this.root,'traces',result.trace_id+'.json'),result); return result;
  }
  async record(file) {
    const event=await load(file,null);
    if(!/^[a-f0-9-]{36}$/.test(event?.trace_id||'')) throw Error('Invalid trace_id');
    const p=path.join(this.root,'traces',event.trace_id+'.json'),trace=await load(p,null);
    const ids=new Set(trace?.operations.flatMap(o=>o.candidates.map(c=>c.id)) || []);
    if(!Array.isArray(event.decisions)||!event.decisions.length) throw Error('Decisions required');
    for(const d of event.decisions) if(!ids.has(d.id)||!['used','rejected'].includes(d.status)||typeof d.reason!=='string'||(d.status==='used'&&(!d.artifacts?.length||!d.checks?.length))) throw Error('Each decision needs candidate id, status, reason; used needs artifacts and checks');
    trace.host_reported_outcome=event;await save(p,trace);return {trace_id:event.trace_id,recorded:true,trust:'Host-reported outcome; not independently executed by this command'};
  }
}
export async function catalogCommand(command,args,opts) {
  const c=new Catalog(opts);
  if(command==='catalog-sync'||command==='catalog-watch') {
    const config=await load(opts.config,null);if(!config) throw Error('--config required');
    if(![600,1800,3600].includes(config.interval_seconds)) throw Error('Invalid interval_seconds');
    if(command==='catalog-sync') return c.sync(config);
    // Product worker, explicitly launched by the operator. Never runs in request path.
    do {try{console.log(JSON.stringify(await c.sync(config)));}catch(e){console.error(e.message);} await new Promise(r=>setTimeout(r,config.interval_seconds*1000));}while(true);
  }
  if(command==='catalog-connect') {
    const url=catalogURL(opts['catalog-url']);
    await save(path.join(c.root,'connection.json'),{url});
    return {catalog_url:url,configured:true,note:'Configuration saved locally. Reachability is checked on the first lookup.'};
  }
  if(command==='catalog-route') {
    const task=await load(opts.file,null), remote=opts['catalog-url']||process.env.HOT_PICK_CATALOG_URL||(await load(path.join(c.root,'connection.json'),{})).url;
    if(!remote) return c.route(task);
    const url=catalogURL(remote);
    // Dedicated client never forwards GitHub credentials to a catalog endpoint.
    const client=new OSS({...opts,github:'https://catalog.invalid'});
    const originalFetch=client.fetch;
    client.fetch=(url,init)=>{const headers={...init.headers};delete headers.Authorization;return originalFetch(url,{...init,headers});};
    const snapshot=publicSnapshot(await client.cached(url,{stale:true,max:32*1024*1024}));
    c.client.stats=client.stats;c.client.warnings=client.warnings;
    return c.route(task,snapshot,url);
  }
  if(command==='catalog-review-queue') {
    const state=await c.state();return {items:Object.values(state.cards).filter(x=>x.profile.semantic_review?.blob_sha!==x.blob_sha).slice(0,opts.limit||20).map(x=>({id:x.id,blob_sha:x.blob_sha,commit:x.commit,source:x.source,instructions:x.instructions,overview:x.overview})),note:'One-shot local host review only; no LLM daemon or API call. Apply validated profiles with catalog-label.'};
  }
  if(command==='catalog-label') return c.label(opts.file);
  if(command==='catalog-record') return c.record(opts.file);
  const s=await c.state();return {cards:Object.keys(s.cards).length,ready:Object.values(s.cards).filter(x=>x.ready).length,updated_at:s.updated_at,last_sync:await load(path.join(c.root,'last-sync.json'),null)};
}
