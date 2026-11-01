import {createHash} from 'node:crypto';
import {promises as fs} from 'node:fs';
import {readPublicSnapshot} from './snapshot.mjs';
const [file,url]=process.argv.slice(2);
const expected=await readPublicSnapshot(file);
const digest=x=>createHash('sha256').update(x).digest('hex');
const hash=digest(expected);
let result;
for(let attempt=0;attempt<6;attempt++) {
  const response=await fetch(url,{headers:{'Cache-Control':'no-cache'},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Public catalog returned HTTP ${response.status}`);
  const body=Buffer.from(await response.arrayBuffer());
  if(digest(body)===hash) {
    const etag=response.headers.get('etag');
    if(!etag)throw Error('Published catalog lacks ETag');
    const conditional=await fetch(url,{headers:{'If-None-Match':etag},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(conditional.status!==304 || (await conditional.arrayBuffer()).byteLength!==0) throw Error('Conditional GET failed');
    const data=JSON.parse(body);
    result={verified:true,url,sha256:hash,cards:Object.keys(data.cards).length,updated_at:data.updated_at,conditional_status:304};
    break;
  }
  if(attempt<5)await new Promise(resolve=>setTimeout(resolve,5000));
}
if(!result)throw Error('Live catalog differs from the published snapshot');
console.log(JSON.stringify(result));
if(process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
  `\n### Verified public catalog\n\n- Cards: ${result.cards}\n- Updated: ${result.updated_at}\n- SHA-256: \`${hash}\`\n- Conditional GET: 304, empty body\n`);
