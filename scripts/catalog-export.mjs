import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {publicSnapshot} from '../skills/hot-pick/scripts/catalog-snapshot.mjs';
const args=process.argv.slice(2),options={};
while(args.length){const key=args.shift();if(!['--cache','--out'].includes(key)||!args.length)throw Error('Use --cache DIR --out FILE');options[key]=args.shift();}
if(!options['--out']) throw Error('--out required');
const cache=options['--cache']||path.join(os.homedir(),'.cache/hot-pick');
const state=JSON.parse(await fs.readFile(path.join(cache,'task-catalog/index.json'),'utf8'));
const snapshot=publicSnapshot(state),data=JSON.stringify(snapshot),out=path.resolve(options['--out']);
await fs.mkdir(path.dirname(out),{recursive:true});const tmp=out+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(tmp,data,{mode:0o600});await fs.rename(tmp,out);
console.log(JSON.stringify({cards:Object.keys(snapshot.cards).length,reviewed:Object.values(snapshot.cards).filter(c=>c.profile.semantic_review).length,bytes:Buffer.byteLength(data),sha256:crypto.createHash('sha256').update(data).digest('hex')}));
