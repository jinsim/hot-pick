import {createHash} from 'node:crypto';
import {publicSnapshot} from './catalog-snapshot.mjs';
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const words=s=>String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu)||[];
export function terms(c){const p=c.profile,r=p.semantic_review;return [...new Set(words([c.name,p.description,...(r?.situations||[]),...(r?.outputs||[]),...p.situations.map(x=>x.text),...p.outputs.map(x=>x.text),...p.headings.map(x=>x.text)].join(' ')))];}
export function splitCatalog(input){
 const s=publicSnapshot(input),files={},cards={};
 for(const c of Object.values(s.cards)){
  const body=JSON.stringify({schema:1,updated_at:null,cards:{[c.id]:c},trends:{}});
  const key=hash(body);files[`/details/${key}.json`]=body;
  cards[c.id]={...c,profile:{...c.profile,description:[...c.profile.description].slice(0,240).join(''),situations:[],inputs:[],outputs:[],constraints:[],headings:[],semantic_review:c.profile.semantic_review?{blob_sha:c.blob_sha,evidence:[],situations:[],inputs:[],outputs:[],constraints:[]}:null},search_terms:terms(c),detail_hash:key,description_truncated:[...c.profile.description].length>240};
 }
 const index={...s,format:'hot-pick-index-v1',cards};files['/index.json']=JSON.stringify(index);return {index,files};
}
export function validateIndex(raw){
 if(raw?.format!=='hot-pick-index-v1')throw Error('Invalid search index format');
 const s=publicSnapshot(raw);
 for(const c of Object.values(s.cards)){
  const x=raw.cards[c.id];
  if(!/^[a-f0-9]{64}$/.test(x?.detail_hash||'')||!Array.isArray(x.search_terms)||x.search_terms.length>20000||x.search_terms.some(t=>typeof t!=='string'||t.length>2000))throw Error('Invalid search index entry');
  c.search_terms=x.search_terms;c.detail_hash=x.detail_hash;c.description_truncated=!!x.description_truncated;
 }
 return {...s,format:raw.format};
}
