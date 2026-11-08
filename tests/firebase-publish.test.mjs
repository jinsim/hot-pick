import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {publishCatalog} from '../service/firebase-publish.mjs';

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'hot-pick-publish-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'catalog.json'),repo='example/tools',skill_path='SKILL.md',commit='a'.repeat(40),blob_sha='b'.repeat(40),id=`${repo}:${skill_path}`;
  const snapshot={schema:1,updated_at:null,cards:{[id]:{id,repo,skill_path,commit,blob_sha,name:'tools',license:'MIT',stars:1,checked_at:null,
    source:`https://github.com/${repo}/blob/${commit}/${skill_path}`,profile:{description:'Example',method:'source_excerpts',semantic_review:null,situations:[],inputs:[],outputs:[],constraints:[],headings:[]}}},trends:{}};
  const body=JSON.stringify(snapshot),hash=createHash('sha256').update(gzipSync(body)).digest('hex');
  await fs.writeFile(file,body);
  return {file,body,hash};
}
function transport({hash,body,unchanged=false,badUpload=false,failFinalize=false,split=false}) {
  const calls=[],version='sites/test-project/versions/version1';
  const fetchImpl=async(url,options)=>{
    calls.push({url,method:options.method});
    assert.equal(options.headers.Authorization,'Bearer fixture-token');
    assert.equal(options.redirect,'error');
    const json=data=>Response.json(data);
    if(url.endsWith('/projects/test-project/sites/test-project')) return json({name:'projects/test-project/sites/test-project'});
    if(url.endsWith('/channels/live')) return json(unchanged?{release:{version:{name:version}},retainedReleaseCount:10}:{retainedReleaseCount:999999});
    if(url.includes('updateMask=retainedReleaseCount')) {assert.deepEqual(JSON.parse(options.body),{retainedReleaseCount:10});return json({retainedReleaseCount:10});}
    if(url.endsWith('/files?pageSize=100')) return json({files:[{path:'/__/firebase/init.js',hash:'firebase-added'},{path:'/catalog.json',hash}]});
    if(url.endsWith('/versions')) return json({name:version});
    if(url.endsWith(':populateFiles')) {if(!split)assert.deepEqual(JSON.parse(options.body).files,{'/catalog.json':hash});else {const f=JSON.parse(options.body).files;assert.ok(f['/index.json']);assert.ok(Object.keys(f).some(k=>k.startsWith('/details/')));}return json({uploadRequiredHashes:[hash],uploadUrl:badUpload?'https://attacker.example/files':`https://upload-firebasehosting.googleapis.com/upload/${version}/files`});}
    if(url.startsWith('https://upload-firebasehosting.googleapis.com/')) {assert.equal(gunzipSync(options.body).toString(),body);return new Response('');}
    if(url.includes('update_mask')) return failFinalize ? new Response('',{status:503}) : json({status:'FINALIZED'});
    if(url.includes('/releases?')) return json({version:{name:version}});
    throw Error(`Unexpected test endpoint ${url}`);
  };
  return {fetchImpl,calls};
}
test('publisher validates, uploads only public gzip, finalizes then releases',async t=>{
  const f=await fixture(t),mock=transport(f);
  const r=await publishCatalog({...f,project:'test-project',getToken:()=> 'fixture-token',fetchImpl:mock.fetchImpl});
  assert.equal(r.status,'published');assert.equal(r.url,'https://test-project.web.app/catalog.json');
  assert.ok(mock.calls.some(c=>c.url.includes('updateMask=retainedReleaseCount')));
  assert.ok(mock.calls.at(-1).url.includes('/releases?'));
});
test('unchanged published hash avoids a new version or upload',async t=>{
  const f=await fixture(t),mock=transport({...f,unchanged:true});
  const r=await publishCatalog({...f,project:'test-project',getToken:()=> 'fixture-token',fetchImpl:mock.fetchImpl});
  assert.equal(r.status,'unchanged');assert.ok(mock.calls.every(c=>c.method==='GET'));
});
test('untrusted upload destinations and failed finalization never release',async t=>{
  const f=await fixture(t);
  for(const mode of [{badUpload:true},{failFinalize:true}]){
    const mock=transport({...f,...mode});
    await assert.rejects(publishCatalog({...f,project:'test-project',getToken:()=> 'fixture-token',fetchImpl:mock.fetchImpl}));
    assert.ok(!mock.calls.some(c=>c.url.includes('/releases?')));
    assert.ok(!mock.calls.some(c=>c.url.includes('attacker.example')));
  }
});
test('private or empty snapshots fail before credentials or network',async t=>{
  const f=await fixture(t);
  for(const body of [JSON.stringify({...JSON.parse(f.body),private:'secret'}),JSON.stringify({schema:1,updated_at:null,cards:{},trends:{}})]) {
    await fs.writeFile(f.file,body);
    await assert.rejects(publishCatalog({file:f.file,project:'test-project',getToken:()=>assert.fail('credential requested'),fetchImpl:()=>assert.fail('network requested')}));
  }
});

test('split publisher includes index and detail files in the same atomic release',async t=>{const f=await fixture(t),mock=transport({...f,split:true});const r=await publishCatalog({...f,split:true,project:'test-project',getToken:()=> 'fixture-token',fetchImpl:mock.fetchImpl});assert.equal(r.status,'published');assert.ok(mock.calls.at(-1).url.includes('/releases?'));});
