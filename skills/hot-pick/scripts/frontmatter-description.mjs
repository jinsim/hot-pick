// Extract common SKILL.md description scalars without evaluating YAML tags or loading code.
export function skillDescription(text) {
  const lines=String(text).replace(/\r\n/g,'\n').split('\n');
  const end=lines[0]?.trim()==='---'?lines.findIndex((l,i)=>i>0&&l.trim()==='---'):-1;
  const source=end>0?lines.slice(1,end):lines;
  const index=source.findIndex(l=>/^description:\s*/.test(l));if(index<0)return '';
  const value=source[index].replace(/^description:\s*/,'').trim();
  const tail=[];
  for(let i=index+1;i<source.length;i++){
    const l=source[i];if(l.trim()&&!/^\s/.test(l))break;tail.push(l);
  }
  const indent=Math.min(...tail.filter(l=>l.trim()).map(l=>l.match(/^\s*/)[0].length));
  const content=tail.map(l=>l.slice(Number.isFinite(indent)?indent:0));
  if(/^[>|][+-]?\s*(?:#.*)?$/.test(value))return value[0]==='|'?content.join('\n').trim():content.join(' ').replace(/\s+/g,' ').trim();
  let scalar=value;
  if((value.startsWith('"')&&!value.endsWith('"'))||(value.startsWith("'")&&!value.endsWith("'")))scalar=[value,...content].join(' ');
  if(scalar.startsWith('"')&&scalar.endsWith('"')){try{return JSON.parse(scalar);}catch{return scalar.slice(1,-1);}}
  if(scalar.startsWith("'")&&scalar.endsWith("'"))return scalar.slice(1,-1).replaceAll("''", "'");
  return scalar;
}
