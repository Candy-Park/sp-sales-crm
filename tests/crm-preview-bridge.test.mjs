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

test('only owner-verified reviewed business mail can use the existing link RPC',async()=>{
 const mailId='11111111-1111-4111-8111-111111111111';
 let linked=0,verified=false;
 env.localHandling=async()=>[];
 const handler=async request=>{
  const url=new URL(request.url);
  if(request.method==='GET'){
   assert.equal(url.pathname,'/api/outlook');assert.equal(url.searchParams.get('view'),'reviewed');verified=true;
   return Response.json({mails:[{id:mailId,state:'pending',excluded:false,handling:{include:true}}],hasMore:false});
  }
  assert.ok(verified);linked++;assert.equal(url.pathname,`/api/outlook/${mailId}/link`);
  return Response.json({result:'SYNTHETIC'}, {status:201});
 };
 try{
  const headers={authorization:'Bearer SYNTHETIC',origin,'content-type':'application/json'};
  assert.equal((await run(`/api/crm/outlook/${mailId}/link`,'POST',headers,'{"inquiry_id":"SYNTHETIC"}',handler)).status,201);
  assert.equal(linked,1);
  assert.equal((await run('/api/crm/outlook/22222222-2222-4222-8222-222222222222/link','POST',headers,'{}',handler)).status,403);
  const held=async()=>Response.json({mails:[{id:mailId,state:'held',excluded:false,handling:{include:true}}],hasMore:false});
  assert.equal((await run(`/api/crm/outlook/${mailId}/link`,'POST',headers,'{}',held)).status,403);
  for(const mail of [{state:'pending',excluded:true,handling:{include:true}},{state:'pending',excluded:false,handling:{include:false}}]){
   const denied=async()=>Response.json({mails:[{id:mailId,...mail}],hasMore:false});
   assert.equal((await run(`/api/crm/outlook/${mailId}/link`,'POST',headers,'{}',denied)).status,403);
  }
  const missing=async()=>Response.json({error:'denied'},{status:401});
  assert.equal((await run(`/api/crm/outlook/${mailId}/link`,'POST',headers,'{}',missing)).status,401);
  assert.equal((await run(`/api/crm/outlook/${mailId}/classification`,'POST',headers,'{}',handler)).status,404);
  assert.equal((await run(`/api/crm/outlook/${mailId}/link`,'POST',{...headers,origin:'http://foreign'},'{}',handler)).status,403);
  assert.equal(linked,1);
 }finally{delete env.localHandling;}
});

test('VPN reviewed mail cannot copy credentials into a newly registered inquiry',async()=>{
 env.localHandling=async()=>[];let writes=0;const mailId='11111111-1111-4111-8111-111111111111';
 const handler=async request=>{if(request.method==='GET')return Response.json({mails:[{id:mailId,state:'pending',excluded:false,handling:{include:true,case_id:'M20-10'}}],hasMore:false});writes++;return Response.json({result:'SYNTHETIC'});};
 try{const response=await run(`/api/crm/outlook/${mailId}/link`,'POST',{authorization:'Bearer SYNTHETIC',origin,'content-type':'application/json'},'{"registration":{}}',handler);assert.equal(response.status,422);assert.equal(writes,0);}finally{delete env.localHandling;}
});

test('VPN original is redacted on the server even when the browser category changes',async()=>{
 const mailId='11111111-1111-4111-8111-111111111111';env.redactedMailIds=new Set([mailId]);
 const handler=async()=>Response.json({mail:{id:mailId,subject:'SYNTHETIC VPN',original:{body:'SYNTHETIC PRIVATE MUST NOT RETURN',attachments:[]}}});
 try{const result=await run(`/api/crm/outlook/${mailId}`,'GET',{authorization:'Bearer SYNTHETIC'},'',handler);assert.equal(result.status,200);assert.doesNotMatch(JSON.stringify(result.result),/MUST NOT RETURN/);assert.match(result.result.mail.original.body,/표시하지 않습니다/);}finally{delete env.redactedMailIds;}
});
