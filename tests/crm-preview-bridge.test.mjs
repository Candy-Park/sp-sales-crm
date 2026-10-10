import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {handleCRMBridge} from '../src/crm-preview-bridge.mjs';
const origin='http://127.0.0.1:4327',env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_ONLY'};
async function run(path,method='GET',headers={},body='',handler){let status,result;const req=Readable.from(body?[Buffer.from(body)]:[]);Object.assign(req,{url:path,method,headers:{host:'127.0.0.1:4327',...headers}});const res={writeHead(s){status=s;},end(value){result=value?JSON.parse(value):null;}};const matched=await handleCRMBridge(req,res,path.split('?')[0],env,origin,handler);return {matched,status,result};}
test('CRM bridge does not change local mail/memo routes and rejects unauthenticated or foreign requests',async()=>{
 let calls=0;const handler=()=>{calls++;throw Error('must not call');};
 assert.equal((await run('/api/memos','GET',{},'',handler)).matched,false);
 assert.equal((await run('/api/outlook','POST',{},'',handler)).matched,false);
 assert.equal((await run('/api/crm/inquiries','POST',{},'{}',handler)).status,401);
 assert.equal((await run('/api/crm/dashboard','GET',{host:'foreign'},'',handler)).status,403);
 assert.equal((await run('/api/crm/inquiries','POST',{authorization:'Bearer SYNTHETIC',origin:'http://foreign'},'{}',handler)).status,403);
 assert.equal((await run('/api/crm/outlook/anything','POST',{authorization:'Bearer SYNTHETIC',origin},'{}',handler)).status,404);
 assert.equal(calls,0);
});
test('CRM bridge forwards existing protected API paths, query and exact body to its original handler',async()=>{
 let seen;
 const handler=async(req,config)=>{seen={path:new URL(req.url).pathname,query:new URL(req.url).search,body:await req.json(),config};return Response.json({result:'SYNTHETIC'}, {status:201});};
 const result=await run('/api/crm/inquiries?offset=10','POST',{authorization:'Bearer SYNTHETIC',origin,'content-type':'application/json'},'{"title":"SYNTHETIC"}',handler);
 assert.equal(result.status,201);assert.equal(seen.path,'/api/inquiries');assert.equal(seen.query,'?offset=10');assert.deepEqual(seen.body,{title:'SYNTHETIC'});assert.equal(seen.config,env);
});
test('CRM bridge exposes only validated public config and preserves original API authorization failures',async()=>{
 assert.deepEqual((await run('/api/crm/config')).result,{url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY});
 const handler=async()=>Response.json({error:'SYNTHETIC denied'},{status:403});
 assert.equal((await run('/api/crm/dashboard','GET',{authorization:'Bearer SYNTHETIC'},'',handler)).status,403);
});
