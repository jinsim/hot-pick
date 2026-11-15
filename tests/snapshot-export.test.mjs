import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {publicSnapshot} from '../skills/hot-pick/scripts/catalog-snapshot.mjs';
import {readPublicSnapshot} from '../service/snapshot.mjs';

test('export and publication agree on case-insensitive path filtering', async t => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-export-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const repo='example/security',skill_path='skills/api/SKILL.md',blob_sha='b'.repeat(40);
 const unsafe=['PATCH /users/me','/HOME/private','FILE://local/path',String.raw`C:\Users\private`];
 for(const text of unsafe){
  const c={repo,skill_path,commit:'a'.repeat(40),blob_sha,name:'api',license:'MIT',stars:1,
   profile:{description:text,situations:[{line:1,text}],inputs:[],outputs:[],constraints:[],headings:[],semantic_review:{blob_sha,evidence:[text],situations:[],inputs:[],outputs:[],constraints:[]}}};
  const snapshot=publicSnapshot({schema:1,cards:{x:c},trends:{}});
  const card=Object.values(snapshot.cards)[0];
  assert.deepEqual(card.profile.situations,[]);
  assert.equal(card.profile.semantic_review,null);
  const file=path.join(dir,'snapshot.json');await fs.writeFile(file,JSON.stringify(snapshot));
  assert.equal(JSON.parse(await readPublicSnapshot(file)).cards[card.id].name,'api');
 }
});
