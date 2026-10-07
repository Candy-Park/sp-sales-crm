import test from 'node:test';
import assert from 'node:assert/strict';
import {outlookInput} from '../src/outlook.mjs';
import {handleApi} from '../src/api.mjs';
const uid='a11803c8-01ef-4563-95bb-c0024541be2c',mid='00000000-0000-4000-8000-000000000071';
const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
const mail={source_key:'b'.repeat(64),identity_method:'internet_message_id',direction:'received',subject:'가상 제목',body:'원문 😀',sender:'synthetic@example.test',recipients:'synthetic@example.test',occurred_at:'2026-10-06T12:00:00Z',conversation_key:null,attachments:[]};
const data={id:mid,scope_key:'a'.repeat(64),source_key:mail.source_key,payload_hash:'c'.repeat(64),body_length:Array.from(mail.body).length,original_json:JSON.stringify(mail)};
function request(path,method='GET',body,token='synthetic'){return new Request('http://127.0.0.1:4317'+path,{method,headers:{...(token?{authorization:'Bearer '+token}:{}),'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});}
function upstream(enabled=true,code=null){const calls=[];return {calls,fetch:async(url,init)=>{const u=new URL(url);calls.push({u,init});if(u.pathname==='/auth/v1/user')return Response.json({id:uid});if(u.pathname==='/rest/v1/sales_access')return Response.json(enabled?[{user_id:uid,enabled:true}]:[]);if(u.pathname.includes('/rpc/'))return code?Response.json({code},{status:400}):Response.json({id:mid,source_key:mail.source_key,payload_hash:data.payload_hash});return Response.json([]);}};}
test('Outlook envelope retains complete normal original, unicode character length and stable receipt hash',()=>{assert.deepEqual(outlookInput('outlook-ingest',data),data);});
test('held body is null on transport; truncated or secretly included held original is rejected',()=>{
 const held={...data,body_length:100001,original_json:JSON.stringify({...mail,body:null})};assert.deepEqual(outlookInput('outlook-ingest',held),held);
 assert.throws(()=>outlookInput('outlook-ingest',{...held,original_json:JSON.stringify(mail)}));
 assert.throws(()=>outlookInput('outlook-ingest',{...data,body_length:100}));
});
test('forged ownership, attachment contents and source changes fail before RPC',async()=>{
 for(const bad of [{...data,owner_id:uid},{...data,original_json:JSON.stringify({...mail,source_key:'d'.repeat(64)})},{...data,original_json:JSON.stringify({...mail,attachments:[{name:'x',size:1,content:'private'}]})}]){
  const up=upstream();assert.equal((await handleApi(request('/api/outlook','POST',bad),env,up.fetch)).status,400);assert.equal(up.calls.length,2);
 }
});
test('Outlook upload verifies remote auth and allowlist before invoker RPC',async()=>{
 const up=upstream();assert.equal((await handleApi(request('/api/outlook','POST',data),env,up.fetch)).status,200);
 assert.equal(up.calls.at(-1).u.pathname,'/rest/v1/rpc/sales_ingest_outlook');assert.deepEqual(JSON.parse(up.calls.at(-1).init.body),{p_data:data});
});
test('outlook reads always restrict owner and inquiry, use bounded pagination and omit bodies from lists',async()=>{
 const up=upstream();assert.equal((await handleApi(request('/api/outlook?owner_id=forged&inquiry_id='+mid+'&offset=50'),env,up.fetch)).status,200);
 const u=up.calls.at(-1).u;assert.equal(u.searchParams.get('owner_id'),'eq.'+uid);assert.equal(u.searchParams.get('inquiry_id'),'eq.'+mid);assert.equal(u.searchParams.get('offset'),'50');assert.equal(u.searchParams.get('select').includes('original'),false);
});
test('unapproved or anonymous caller cannot launch local collector or query mail',async()=>{
 for(const method of ['GET','POST']){let called=0;const config={...env,localOutlook:async()=>{called++;return {};}};
  assert.equal((await handleApi(request('/api/outlook/local',method,{},null),config,upstream().fetch)).status,401);
  assert.equal((await handleApi(request('/api/outlook/local',method,{}),config,upstream(false).fetch)).status,403);assert.equal(called,0);
 }
});
test('local collection receives only verified owner and current authorization, absent bridge fails closed',async()=>{
 let args;const config={...env,localOutlook:async(...v)=>{args=v;return {running:true};}};
 assert.equal((await handleApi(request('/api/outlook/local','POST',{}),config,upstream().fetch)).status,200);assert.deepEqual(args,['POST',uid,'Bearer synthetic']);
 assert.equal((await handleApi(request('/api/outlook/local'),env,upstream().fetch)).status,503);
});
test('explicit link rejects both destinations, missing choice or ownership; original registration is validated',()=>{
 for(const bad of [{},{inquiry_id:mid,registration:{}},{inquiry_id:mid,owner_id:uid}])assert.throws(()=>outlookInput('outlook-link',bad));
 assert.deepEqual(outlookInput('outlook-link',{inquiry_id:mid}),{inquiry_id:mid});
});
test('foreign mail is not found, constraints conflict safely and mail deletion never reaches DB',async()=>{
 assert.equal((await handleApi(request('/api/outlook/'+mid),env,upstream().fetch)).status,404);
 const up=upstream();assert.equal((await handleApi(request('/api/outlook/'+mid,'DELETE',{}),env,up.fetch)).status,405);assert.equal(up.calls.length,0);
 for(const [code,status] of [['40001',409],['23514',422],['42501',403]])assert.equal((await handleApi(request('/api/outlook/'+mid+'/link','POST',{inquiry_id:mid}),env,upstream(true,code).fetch)).status,status);
});

test('triage only accepts a boolean decision and revision; no ownership or original changes',()=>{
 assert.deepEqual(outlookInput('outlook-triage',{excluded:true,revision:1}),{excluded:true,revision:1});
 for(const bad of [{},{excluded:'true',revision:1},{excluded:true,revision:0},{excluded:false,revision:1.5},{excluded:true,revision:2147483647},{excluded:true,revision:1,owner_id:uid},{excluded:true,revision:1,original:{}}])assert.throws(()=>outlookInput('outlook-triage',bad));
});
test('active list hides excluded mail on the server; filters paginate independently without bodies',async()=>{
 for(const [view,filter] of [['','eq.false'],['excluded','eq.true'],['all',null]]){
  const up=upstream();assert.equal((await handleApi(request('/api/outlook?offset=50'+(view?'&view='+view:'')),env,up.fetch)).status,200);
  const u=up.calls.at(-1).u;assert.equal(u.searchParams.get('excluded'),filter);assert.equal(u.searchParams.get('offset'),'50');assert.equal(u.searchParams.get('select').includes('original'),false);
 }
 const up=upstream();assert.equal((await handleApi(request('/api/outlook?view=forged'),env,up.fetch)).status,400);
});
test('authenticated exclusion uses invoker RPC and stale revisions are conflicts; anonymous is blocked',async()=>{
 const up=upstream();assert.equal((await handleApi(request('/api/outlook/'+mid+'/triage','POST',{excluded:true,revision:1}),env,up.fetch)).status,200);
 assert.equal(up.calls.at(-1).u.pathname,'/rest/v1/rpc/sales_triage_outlook');assert.deepEqual(JSON.parse(up.calls.at(-1).init.body),{p_id:mid,p_data:{excluded:true,revision:1}});
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/triage','POST',{excluded:true,revision:1}),env,upstream(true,'40001').fetch)).status,409);
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/triage','POST',{excluded:true,revision:1},null),env,upstream().fetch)).status,401);
});
