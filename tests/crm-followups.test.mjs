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
test('analysis attaches only the verified inquiry state and rejects unexpected source rows',async()=>{
 let mode;const env={localHandling:async()=>[target],localFollowups:async input=>{mode=input.mode;return {threads:[{mail_id:mid,inquiry_id:iid,timeline:[]}]};}};
 const handler=async req=>{
  const path=new URL(req.url).pathname;
  if(path==='/api/me')return Response.json({user:{id:owner}});
  if(path==='/api/outlook')return Response.json({hasMore:false,mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,category:'고객 업무'}}]});
  return Response.json({inquiry:{id:iid,title:'SYNTHETIC',status:'closed',updated_at:'2026-10-11T00:00:00Z'},actions:[]});
 };
 const req=()=>new Request(origin+'/api/followups?view=analysis',{headers:{authorization:'Bearer SYNTHETIC'}});
 const response=await handleFollowups(req(),env,handler);assert.equal(response.status,200);assert.equal(mode,'analysis');assert.equal((await response.json()).threads[0].current.status,'closed');
 env.localWorkReview=()=>({reviewed_on:'2026-10-10',next_action:'confirmed'});
 env.localFollowups=async()=>({threads:[{mail_id:mid,inquiry_id:iid,timeline:[{occurred_at:'2026-10-08T00:00:00Z'}],proposal:{next_action:'unconfirmed'}}]});
 const confirmed=await (await handleFollowups(req(),env,handler)).json();assert.equal(confirmed.threads[0].confirmed_review,true);assert.equal(confirmed.threads[0].proposal.next_action,'confirmed');
 env.localFollowups=async()=>({updates:[{mail_id:mid,latest_at:'2026-10-08T00:00:00Z',received:4,sent:4,later_received:2,later_sent:2},{mail_id:mid,latest_at:'2026-10-11T00:00:00Z',received:5,sent:4,later_received:1,later_sent:0}]});
 const status=await (await handleFollowups(request(),env,handler)).json();assert.equal(status.updates[0].later_received,0);assert.equal(status.updates[0].received,4);assert.deepEqual(status.updates[0].reviewed_followups,{received:2,sent:2});assert.equal(status.updates[1].later_received,1);
 env.localFollowups=async()=>({threads:[{mail_id:'unexpected',inquiry_id:iid}]});assert.equal((await handleFollowups(req(),env,handler)).status,503);
});

test('new request creates an actionable observation, protected data stays unchanged',async()=>{
 const current={id:iid,title:'Synthetic',status:'new',updated_at:'2026-10-10T00:00:00Z'};
 const action={id:mid,description:'Confirmed plan',due_date:'2026-10-12',status:'open'};
 const env={localHandling:async()=>[target],localWorkReview:()=>({reviewed_on:'2026-10-10'}),localFollowups:async()=>({threads:[{mail_id:mid,inquiry_id:iid,timeline:[{occurred_at:'2026-10-11T00:00:00Z',direction:'received',held:false}],proposal:{stage:'요청 후보',next_action:'새 요청에 답변'}}]})};
 const handler=async req=>{
  assert.equal(req.method,'GET');const path=new URL(req.url).pathname;
  return Response.json(path==='/api/me'?{user:{id:owner}}:path==='/api/outlook'?{hasMore:false,mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,category:'고객 업무'}}]}:{inquiry:current,actions:[action]});
 };
 const response=await handleFollowups(new Request(origin+'/api/followups?view=analysis'),env,handler);
 const thread=(await response.json()).threads[0];assert.equal(thread.observation.bucket,'action');assert.equal(thread.current.actions[0].due_date,'2026-10-12');assert.equal(thread.current.actions[0].status,'open');
});
test('verified HQ shipping plan updates the agenda without changing stored deadline or completion',async()=>{
 const source='d'.repeat(64);let kind='hq_received';const calls=[];
 const env={localHandling:async()=>[target],localFollowups:async()=>({threads:[{mail_id:mid,inquiry_id:iid,timeline:[{source_key:source,occurred_at:'2026-10-12T02:56:00.3100000Z',direction:'received'}],proposal:{stage:'출하 예정 답변 후보',next_action:'2026-10-13 16개 출하 예정 — 실제 출하와 송장 확인',shipping_plan:{date:'2026-10-13',quantity:16,actual_shipped:false}}}]}),localDiscovery:async()=>({events:[{inquiry_id:iid,source_key:source,message:{kind}}],held:0})};
 const handler=async req=>{
  calls.push(req.method);const path=new URL(req.url).pathname;
  if(path==='/api/me')return Response.json({user:{id:owner}});
  if(path==='/api/outlook')return Response.json({hasMore:false,mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,category:'고객 업무'}}]});
  return Response.json({inquiry:{id:iid,status:'waiting_for_hq',updated_at:'2026-10-10T00:00:00Z'},actions:[{id:mid,status:'open',due_date:'2026-10-15'}]});
 };
 const req=()=>new Request(origin+'/api/followups?view=analysis',{headers:{authorization:'Bearer SYNTHETIC'}});
 const thread=(await (await handleFollowups(req(),env,handler)).json()).threads[0];
 assert.equal(thread.observation.bucket,'waiting');assert.match(thread.observation.next_action,/2026-10-13 16개/);assert.equal(thread.observation.native_status_changed,false);
 assert.equal(thread.current.actions[0].status,'open');assert.equal(thread.current.actions[0].due_date,'2026-10-15');assert.ok(calls.every(method=>method==='GET'));
 kind='customer_received';assert.equal((await (await handleFollowups(req(),env,handler)).json()).threads[0].observation.bucket,'decision');
});
test('HQ source choice checks customer ownership before persisting a local choice',async()=>{
 let changes=0;const source='d'.repeat(64);
 const env={localHandling:async()=>[target],localFollowups:async()=>({candidates:[{source_key:source,automatic_registration:false}]}),localDiscovery:async()=>{changes++;}};
 const handler=async req=>{
  const path=new URL(req.url).pathname;
  if(path==='/api/me')return Response.json({user:{id:owner}});
  if(path==='/api/outlook')return Response.json({hasMore:false,mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,category:'고객 업무'}}]});
  if(path==='/api/lookups')return Response.json({customers:[]});
  return Response.json({inquiry:{id:iid,updated_at:'2026-10-11T00:00:00Z'},actions:[]});
 };
 const response=await handleFollowups(request('POST',{operation:'choose',source_key:source,customer_id:iid}),env,handler);
 assert.equal(response.status,403);assert.equal(changes,0);
 assert.equal((await handleFollowups(request('POST',{operation:'reconcile',owner:iid}),env,handler)).status,400);assert.equal(changes,0);
});
test('owned HQ choice resumes registration once and preserves the fixed import plan',async()=>{
 let chosen=false,ack=false,writes=0;const source='d'.repeat(64);
 const env={localHandling:async()=>[target],localFollowups:async()=>({candidates:[{source_key:source,automatic_registration:chosen,inquiry_id:ack?iid:null}]}),localDiscovery:async input=>{
  if(input.mode==='choose'){chosen=true;return {chosen:true};}if(input.mode==='ack'){ack=true;return {saved:true};}if(input.mode==='events')return {events:[],held:0};
  return {source_key:source,registration:{id:iid},action:{id:mid,due_date:'2026-10-14'},message:{id:mid}};
 }};
 const handler=async req=>{
  const path=new URL(req.url).pathname;if(req.method==='POST'){writes++;return Response.json({result:path==='/api/inquiries'?iid:mid});}
  if(path==='/api/me')return Response.json({user:{id:owner}});
  if(path==='/api/outlook')return Response.json({hasMore:false,mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,category:'고객 업무'}}]});
  if(path==='/api/lookups')return Response.json({customers:[{id:iid,name:'Synthetic HQ'}]});
  return Response.json({inquiry:{id:iid,updated_at:'2026-10-11T00:00:00Z'},actions:[]});
 };
 const response=await handleFollowups(request('POST',{operation:'choose',source_key:source,customer_id:iid}),env,handler);
 assert.equal(response.status,200);assert.equal((await response.json()).imported,1);assert.equal(writes,3);assert.equal(ack,true);
 assert.equal((await handleFollowups(request('POST',{operation:'choose',source_key:source,customer_id:iid}),env,handler)).status,409);assert.equal(writes,3);
});
test('local original lookup verifies native inquiry ownership before reading a source',async()=>{
 let reads=0;const env={localHandling:async()=>[target],localFollowups:async()=>({}),localDiscovery:async()=>{reads++;return {mails:[]};}};
 const handler=async req=>{
  const path=new URL(req.url).pathname;if(path==='/api/me')return Response.json({user:{id:owner}});
  if(path==='/api/outlook')return Response.json({hasMore:false,mails:[{id:mid,state:'linked',inquiry_id:iid,handling:{include:true,category:'고객 업무'}}]});
  if(path==='/api/inquiries/'+iid)return Response.json({inquiry:{id:iid,updated_at:'2026-10-11T00:00:00Z'},actions:[]});
  return Response.json({error:'foreign inquiry'},{status:404});
 };
 const req=id=>new Request(origin+'/api/followups?view=sources&inquiry_id='+id);
 assert.equal((await handleFollowups(req(owner),env,handler)).status,404);assert.equal(reads,0);
 assert.equal((await handleFollowups(req(iid),env,handler)).status,200);assert.equal(reads,1);
});
