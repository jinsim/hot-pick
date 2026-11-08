// Literal source lookup with bounded context; source pins are supplied by OSS.readSource.
export function sourceSnippets(body,find,{context=8,limit=3}={}) {
  if(typeof find!=='string'||!find.trim()||find.length>200)throw Error('find must be a nonempty literal string of at most 200 characters');
  if(!Number.isInteger(context)||context<0||context>40)throw Error('context must be 0–40');
  if(!Number.isInteger(limit)||limit<1||limit>10)throw Error('snippet limit must be 1–10');
  const lines=body.split('\n'),needle=find.toLowerCase(),hits=[];
  for(let i=0;i<lines.length;i++)if(lines[i].toLowerCase().includes(needle))hits.push(i);
  const ranges=[];
  for(const hit of hits){
    const start=Math.max(0,hit-context),end=Math.min(lines.length-1,hit+context),last=ranges.at(-1);
    if(last&&start<=last.end+1&&end-last.start<2*context+1){last.end=end;continue;}
    if(ranges.length>=limit)break;
    ranges.push({start,end});
  }
  let remaining=12000;
  const snippets=ranges.map(({start,end})=>{const text=lines.slice(start,end+1).join('\n'),out=text.slice(0,remaining);remaining-=out.length;return {start_line:start+1,end_line:end+1,text:out,truncated:out.length<text.length};});
  return {query:find,total_lines:lines.length,total_matching_lines:hits.length,snippets,partial:snippets.some(s=>s.truncated)||hits.some(h=>!ranges.some(r=>h>=r.start&&h<=r.end)),note:'Literal matching excerpts, not the complete source. Read full pinned instructions before applying a selected skill.'};
}
