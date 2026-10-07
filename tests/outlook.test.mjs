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

test('workflow preview authenticates and verifies owned server receipt before any local original read',async()=>{
 let inputs=[];const config={...env,localWorkflow:async(...args)=>{inputs.push(args);return {proposed:true,stage:'요청 후보'};}};
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/workflow','GET',undefined,null),config,upstream().fetch)).status,401);
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/workflow'),config,upstream(false).fetch)).status,403);
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/workflow'),config,upstream().fetch)).status,404);
 assert.equal(inputs.length,0);
 const up=upstream(),fetch=async(url,init)=>{const r=await up.fetch(url,init);return new URL(url).pathname==='/rest/v1/sales_outlook_classified'?Response.json([{id:mid,scope_key:data.scope_key,source_key:mail.source_key,payload_hash:data.payload_hash,category_group:'HQ 업무',state:'pending',excluded:false}]):r;};
 const r=await handleApi(request('/api/outlook/'+mid+'/workflow?owner_id=forged&category=spam'),config,fetch);
 assert.equal(r.status,200);assert.equal((await r.json()).workflow.stage,'요청 후보');
 assert.deepEqual(inputs,[[uid,{id:mid,scope_key:data.scope_key,source_key:mail.source_key,payload_hash:data.payload_hash},'HQ 업무']]);
 const u=up.calls.at(-1).u;assert.equal(u.searchParams.get('owner_id'),'eq.'+uid);assert.equal(u.searchParams.get('id'),'eq.'+mid);assert.equal(u.searchParams.get('select').includes('original'),false);
 assert.equal(up.calls.some(c=>c.init.method!=='GET'),false);
});

test('workflow is read-only and unavailable or failed local verification returns error not empty success',async()=>{
 const up=upstream(),fetch=async(url,init)=>new URL(url).pathname==='/rest/v1/sales_outlook_classified'?Response.json([{id:mid,state:'pending'}]):up.fetch(url,init);
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/workflow','POST',{}),env,fetch)).status,405);
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/workflow'),env,fetch)).status,503);
 const r=await handleApi(request('/api/outlook/'+mid+'/workflow'),{...env,localWorkflow:async()=>{throw new Error('PRIVATE_SENTINEL');}},fetch);
 assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/PRIVATE_SENTINEL/);
});
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

test('classification requires an explicit category, role, stable request ID and revision',()=>{
 const value={id:mid,revision:0,role:'HQ',category:'HQ 업무'};
 assert.deepEqual(outlookInput('outlook-classify',value),value);
 for(const bad of [{...value,owner_id:uid},{...value,revision:-1},{...value,category:'auto'},{...value,role:'forged'},{...value,id:'bad'}])assert.throws(()=>outlookInput('outlook-classify',bad));
});
test('classification authenticates before invoker RPC, stale decisions conflict',async()=>{
 const body={id:mid,revision:0,role:'HQ',category:'HQ 업무'},up=upstream();
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/classification','POST',body),env,up.fetch)).status,200);
 assert.equal(up.calls.at(-1).u.pathname,'/rest/v1/rpc/sales_classify_outlook');
 assert.deepEqual(JSON.parse(up.calls.at(-1).init.body),{p_id:mid,p_data:body});
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/classification','POST',body),env,upstream(true,'40001').fetch)).status,409);
 assert.equal((await handleApi(request('/api/outlook/'+mid+'/classification','POST',body,null),env,upstream().fetch)).status,401);
});
test('classification list uses invoker view and filters owner before paging; no original body',async()=>{
 const up=upstream();await handleApi(request('/api/outlook?category=HQ%20업무&classification=proposed'),env,up.fetch);
 const u=up.calls.at(-1).u;
 assert.equal(u.pathname,'/rest/v1/sales_outlook_classified');
 assert.equal(u.searchParams.get('category_group'),'eq.HQ 업무');
 assert.equal(u.searchParams.get('classification_state'),'eq.proposed');
 assert.equal(u.searchParams.get('owner_id'),'eq.'+uid);
 assert.equal(u.searchParams.get('select').includes('original'),false);
});
test('review sync requires verified allowlisted owner and only passes explicit mode',async()=>{
 let args,calls=0;const config={...env,localOutlook:async(...values)=>{calls++;args=values;return {running:true};}};
 assert.equal((await handleApi(request('/api/outlook/review-sync','POST',{},null),config,upstream().fetch)).status,401);
 assert.equal((await handleApi(request('/api/outlook/review-sync','POST',{}),config,upstream(false).fetch)).status,403);
 assert.equal(calls,0);
 assert.equal((await handleApi(request('/api/outlook/review-sync','POST',{}),config,upstream().fetch)).status,200);
 assert.deepEqual(args,['POST',uid,'Bearer synthetic','review-sync']);
 assert.equal((await handleApi(request('/api/outlook/review-sync'),config,upstream().fetch)).status,405);
});
