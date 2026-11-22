import test from 'node:test';import assert from 'node:assert/strict';
import {configureWorker} from '../monitoring/health/deploy.mjs';
const options={account:'a'.repeat(32),token:'cloudflare-placeholder',freePlanVerified:true};
const secret={name:'HOT_PICK_DISPATCH_TOKEN',type:'secret_text'};
const response=result=>Response.json({success:true,result});
test('unverified pricing and missing bootstrap credential never mutate cloud resources',async()=>{
 let calls=0;await assert.rejects(configureWorker({...options,freePlanVerified:false,fetchImpl:()=>{calls++;throw Error('must not call');}}),/Workers Free/);assert.equal(calls,0);
 await assert.rejects(configureWorker({...options,fetchImpl:async(_url,init)=>{assert.equal(init.method,'GET');calls++;return new Response('',{status:404});}}),/new Worker requires/);assert.equal(calls,1);
});
test('redeployment preserves an existing encrypted key and confirms it before enabling cron',async()=>{
 const writes=[];let secretReads=0;
 const result=await configureWorker({...options,fetchImpl:async(url,init)=>{
 if(url.endsWith('/secrets')&&init.method==='GET'){secretReads++;return response([secret]);}
 writes.push(url);
 if(init.body instanceof FormData){const metadata=JSON.parse(await init.body.get('metadata').text());assert.deepEqual(metadata.keep_bindings,['secret_text']);assert.equal(init.body.has('scheduler.mjs'),true);}
 if(url.endsWith('/schedules'))assert.equal(secretReads,2);
 assert.ok(!url.endsWith('/secrets'));return response({usage_model:'standard'});
 }});assert.equal(result.credential_reused,true);assert.match(writes.at(-1),/\/schedules$/);
});
test('loss of secret after upload stops activation and provider errors do not leak credentials',async()=>{
 let reads=0,writes=0;
 await assert.rejects(configureWorker({...options,fetchImpl:async(url,init)=>{if(init.method==='GET')return response(reads++===0?[secret]:[]);writes++;assert.ok(!url.endsWith('/schedules'));return response({});}}),/Secret is missing/);assert.equal(writes,1);
 await assert.rejects(configureWorker({...options,fetchImpl:async()=>Response.json({success:false,errors:[{code:10000,message:'secret payload must never be echoed'}]},{status:403})}),e=>e.message.includes('403')&&!e.message.includes('secret payload'));
});
