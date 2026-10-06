import test from 'node:test';
import assert from 'node:assert/strict';
import {communicationInput} from '../src/communication.mjs';
import {handleApi} from '../src/api.mjs';
const uid='a11803c8-01ef-4563-95bb-c0024541be2c',iid='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
const draft={id:other,kind:'hq_draft',target:'Synthetic HQ',subject:'100G confirmation',body:'Please confirm 100G / 10 km. Price unknown.',question_ids:[iid]};
function request(path,method='GET',body){return new Request('http://127.0.0.1:4317'+path,{method,headers:{authorization:'Bearer synthetic-token','content-type':'application/json'},body:body?JSON.stringify(body):undefined});}
function upstream({allowed=true,auth=200,code}={}){const seen=[];return {seen,fetch:async(u,init)=>{const url=new URL(u);seen.push({url,init});if(url.pathname==='/auth/v1/user')return Response.json({id:uid},{status:auth});if(url.pathname==='/rest/v1/sales_access')return Response.json(allowed?[{user_id:uid,enabled:true}]:[]);if(url.pathname.includes('/rpc/'))return code?Response.json({code,message:'PRIVATE internal details'},{status:400}):Response.json(other);return Response.json([]);}};}
test('manual communication retains body, source reference and distinct draft/send evidence',()=>{
 const value=communicationInput('message',draft);
 assert.equal(value.body,draft.body);assert.equal(value.occurred_at,null);assert.equal(value.actual_confirmed,false);
 assert.throws(()=>communicationInput('message',{...draft,occurred_at:'2026-10-07T00:00:00Z'}));
 for(const kind of ['hq_sent','customer_sent']){
  assert.throws(()=>communicationInput('message',{...draft,kind}));
  assert.throws(()=>communicationInput('message',{...draft,kind,occurred_at:'2026-10-07T00:00:00Z',actual_confirmed:false}));
  const sent=communicationInput('message',{...draft,kind,question_ids:kind==='hq_sent'?[iid]:[],occurred_at:'2026-10-06T00:00:00.123456Z',actual_confirmed:true});
  assert.equal(sent.occurred_at,'2026-10-06T00:00:00.123456Z');
 }
});
test('message validators reject client ownership, snapshots, impossible dates and incompatible fields',()=>{
 for(const body of [{...draft,owner_id:uid},{...draft,snapshot:{}},{...draft,kind:'automatic_send'},{...draft,body:' '},{...draft,question_ids:[iid,iid]},{...draft,source_id:'forged'},{...draft,kind:'hq_received',occurred_at:'2026-02-30T00:00:00Z'},{...draft,kind:'customer_draft',question_ids:[iid]}])assert.throws(()=>communicationInput('message',body));
});
test('question review requires revision, answer evidence and reason without overwriting original question',()=>{
 assert.deepEqual(communicationInput('question',{id:iid,question:'Packing requirement?'}),{id:iid,question:'Packing requirement?'});
 for(const body of [{revision:1,status:'answered',note:'confirmed'},{revision:1,status:'partial',response_message_id:other,note:''},{revision:1,status:'cancelled',note:''},{revision:0,status:'open',note:''},{revision:1,status:'answered',response_message_id:other,note:'confirmed',question:'rewritten'}])assert.throws(()=>communicationInput('review',body));
 assert.equal(communicationInput('review',{revision:1,status:'partial',response_message_id:other,note:'Only reach answered; Packing unknown'}).status,'partial');
 assert.equal(communicationInput('review',{revision:1,status:'cancelled',note:'Customer withdrew this request'}).response_message_id,null);
});
test('communication reads retain owner and inquiry filters; failures do not become empty histories',async()=>{
 const up=upstream();const r=await handleApi(request('/api/inquiries/'+iid+'/communication?owner_id=forged'),env,up.fetch);assert.equal(r.status,200);
 const reads=up.seen.filter(c=>['/rest/v1/sales_message','/rest/v1/sales_hq_question'].includes(c.url.pathname));assert.equal(reads.length,2);
 for(const c of reads){assert.equal(c.url.searchParams.get('owner_id'),'eq.'+uid);assert.equal(c.url.searchParams.get('inquiry_id'),'eq.'+iid);}
 const fail=await handleApi(request('/api/inquiries/'+iid+'/communication'),env,async(u,i)=>new URL(u).pathname.endsWith('sales_message')?Response.json({},{status:500}):up.fetch(u,i));assert.equal(fail.status,503);
});
test('a server row cap of 1000 cannot conceal truncated question history',async()=>{
 const up=upstream();const offsets=[];
 const fetch=async(u,init)=>{const url=new URL(u);if(url.pathname==='/rest/v1/sales_hq_question'){
  offsets.push(url.searchParams.get('offset')??'0');return Response.json(url.searchParams.get('offset')==='1000'?[{id:other,question:'Unanswered beyond row cap'}]:Array.from({length:1000},(_,n)=>({id:'synthetic-'+n,question:'Synthetic question'})));
 }return up.fetch(u,init);};
 const r=await handleApi(request('/api/inquiries/'+iid+'/communication'),env,fetch);assert.equal(r.status,200);const data=await r.json();
 assert.equal(data.truncated,true);assert.equal(data.questions.length,1000);assert.deepEqual(offsets,['0','1000']);
});
test('communication mutations verify Auth and allowlist before safe invoker RPCs',async()=>{
 const routes=[['/api/inquiries/'+iid+'/messages','POST',draft,'sales_record_message'],['/api/inquiries/'+iid+'/questions','POST',{id:other,question:'Packing?'},'sales_add_hq_question'],['/api/questions/'+other,'PATCH',{revision:1,status:'partial',response_message_id:iid,note:'Await Packing'},'sales_review_hq_question']];
 for(const [path,method,body,rpc]of routes){const up=upstream();assert.equal((await handleApi(request(path,method,body),env,up.fetch)).status,200);assert.equal(up.seen.at(-1).url.pathname,'/rest/v1/rpc/'+rpc);assert.equal(JSON.parse(up.seen.at(-1).init.body).p_data.owner_id,undefined);
  for(const settings of [{allowed:false},{auth:401}]){const deny=upstream(settings);assert.ok([401,403].includes((await handleApi(request(path,method,body),env,deny.fetch)).status));assert.equal(deny.seen.some(c=>c.url.pathname.includes('/rpc/')),false);}
 }
});
test('message history and questions reject deletion, invalid routes, uncertain save and DB constraints safely',async()=>{
 const up=upstream();assert.equal((await handleApi(request('/api/inquiries/'+iid+'/messages','DELETE'),env,up.fetch)).status,405);assert.equal((await handleApi(request('/api/questions/123','PATCH',{}),env,up.fetch)).status,400);
 assert.equal((await handleApi(request('/api/inquiries/'+iid+'/messages','POST',{...draft,owner_id:uid}),env,up.fetch)).status,400);
 for(const [code,status]of [['40001',409],['23514',422],['42501',403],['XX000',503]]){const db=upstream({code});const r=await handleApi(request('/api/inquiries/'+iid+'/messages','POST',draft),env,db.fetch);assert.equal(r.status,status);assert.doesNotMatch(await r.text(),/PRIVATE/);}
 const failure=await handleApi(request('/api/inquiries/'+iid+'/messages','POST',draft),env,async(u,i)=>{if(new URL(u).pathname.includes('/rpc/'))throw Error('Synthetic lost response');return up.fetch(u,i);});assert.equal(failure.status,503);assert.match((await failure.json()).error,/저장 결과를 확인하지 못/);
});
