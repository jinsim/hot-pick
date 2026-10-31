import {parseSource,safePath} from './core.mjs';
const excerpts=value=>Array.isArray(value)?value.slice(0,40).map(x=>({line:Number(x.line)||0,text:String(x.text||'').slice(0,2000)})):[];
const strings=value=>Array.isArray(value)?value.slice(0,40).map(x=>String(x).slice(0,2000)):[];
export function publicSnapshot(state) {
  if(state?.schema!==1 || !state.cards || typeof state.cards!=='object' || Array.isArray(state.cards) || Object.keys(state.cards).length>10000) throw Error('Invalid catalog snapshot');
  const cards={};
  for(const c of Object.values(state.cards)) {
    const repo=parseSource(c.repo).repo, skill_path=safePath(c.skill_path);
    if(!/^[a-f0-9]{40}$/.test(c.commit||'') || !/^[a-f0-9]{40}$/.test(c.blob_sha||'')) throw Error('Invalid catalog source pin');
    const p=c.profile||{}, r=p.semantic_review;
    const profile={description:String(p.description||'').slice(0,12000),method:'source_excerpts',semantic_review:null};
    for(const key of ['situations','inputs','outputs','constraints','headings']) profile[key]=excerpts(p[key]);
    if(r && r.blob_sha===c.blob_sha) {profile.semantic_review={blob_sha:r.blob_sha,evidence:strings(r.evidence)};for(const key of ['situations','inputs','outputs','constraints']) profile.semantic_review[key]=strings(r[key]);}
    for(const key of ['situations','inputs','outputs','constraints','headings']) profile[key]=profile[key].filter(x=>!/(?:\/Users\/|\/home\/|file:\/\/)/.test(x.text));
    if(/(?:\/Users\/|\/home\/|file:\/\/)/.test(profile.description)) profile.description='Description contains a local path; read pinned source.';
    if(profile.semantic_review && /(?:\/Users\/|\/home\/|file:\/\/)/.test(JSON.stringify(profile.semantic_review))) profile.semantic_review=null;
    const id=`${repo}:${skill_path}`;
    cards[id]={id,repo,name:String(c.name||''),commit:c.commit,skill_path,blob_sha:c.blob_sha,license:c.license||null,stars:Number.isFinite(c.stars)?c.stars:null,profile,source:`https://github.com/${repo}/blob/${c.commit}/${skill_path}`,checked_at:c.checked_at||null};
  }
  const trends={};
  for(const [source,t] of Object.entries(state.trends||{})) {
    if(!/^https:\/\/github\.com\/trending(?:[/?]|$)/.test(source)||!Array.isArray(t.repositories)) continue;
    trends[source]={checked_at:t.checked_at||null,repositories:t.repositories.slice(0,100).map(r=>({repo:parseSource(r.repo).repo,rank:r.rank,since:r.since,language_filter:r.language_filter||null,period_stars:r.period_stars,total_stars:r.total_stars}))};
  }
  return {schema:1,updated_at:state.updated_at||null,cards,trends};
}
export function catalogURL(value) {
  const u=new URL(value);
  if(u.protocol!=='https:' && !(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))) throw Error('Catalog URL must use HTTPS (loopback HTTP allowed for local verification)');
  if(u.username||u.password||u.search||u.hash) throw Error('Catalog URL cannot embed credentials, query, or fragment');
  return u.href;
}
