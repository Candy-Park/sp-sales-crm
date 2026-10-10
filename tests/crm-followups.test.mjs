import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleFollowups} from '../src/crm-followups.mjs';
const origin='http://127.0.0.1:4327',mid='11111111-1111-4111-8111-111111111111',iid='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333';
const target={id:mid,scope_key:'a'.repeat(64),source_key:'b'.repeat(64),payload_hash:'c'.repeat(64)};
const request=(method='GET',body)=>new Request(origin+'/api/followups',{method,headers:{authorization:'Bearer SYNTHETIC',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
test('followup refresh uses verified owner/receipts, excludes VPN and sends no credential to local collector',async()=>{
 let input;
 const env={localHandling:async()=>[target],localFollowups:async value=>{input=value;return {running:true};}};
 const handler=async req=>{
  const path=new URL(req.url).pathname;
  if(path==='/api/me')return Response.json({user:{id:owner}});
  if(path==='/api/outlook')return Response.json({mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,case_id:'M20-03',category:'고객 업무'}},{id:'44444444-4444-4444-8444-444444444444',state:'linked',inquiry_id:iid,handling:{include:true,case_id:'M20-10',category:'HQ 업무'}}],hasMore:false});
  assert.equal(path,'/api/inquiries/'+iid);return Response.json({inquiry:{id:iid,updated_at:'2026-10-10T03:00:00Z'},actions:[]});
 };
 const response=await handleFollowups(request('POST',{operation:'refresh'}),env,handler);assert.equal(response.status,202);assert.equal(input.mode,'refresh');assert.equal(input.owner,owner);assert.equal(input.targets.length,1);assert.equal(input.targets[0].inquiry_id,iid);assert.doesNotMatch(JSON.stringify(input),/Bearer|SYNTHETIC/);
});
test('authorization, incomplete receipt set and unexpected operations never start capture',async()=>{
 let scans=0;const env={localHandling:async()=>[],localFollowups:async()=>{scans++;}};
 assert.equal((await handleFollowups(request(),env,async()=>Response.json({error:'denied'},{status:401}))).status,401);
 assert.equal((await handleFollowups(request('POST',{operation:'delete'}),env,()=>{throw Error('must not read');})).status,400);
 const handler=async req=>new URL(req.url).pathname==='/api/me'?Response.json({user:{id:owner}}):Response.json({mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,case_id:'M20-03',category:'고객 업무'}}],hasMore:false});
 assert.equal((await handleFollowups(request(),env,handler)).status,503);assert.equal(scans,0);
});
