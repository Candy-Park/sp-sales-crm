import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewedMailPage} from '../src/outlook-handling.mjs';
import {handleApi} from '../src/api.mjs';
const ids=['00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000082'];
const decisions=ids.map((id,i)=>({id,scope_key:'a'.repeat(64),source_key:(i?'c':'b').repeat(64),payload_hash:'d'.repeat(64),case_id:'M20-0'+(i+1),include:i===0,category:i===0?'고객 업무':null,role:i===0?'고객사':null,reason:i===0?'사용자 담당 고객 업무':'사용자 담당 범위 밖',reply_note:''}));
const owned=decisions.map(({id,scope_key,source_key,payload_hash})=>({id,scope_key,source_key,payload_hash}));
const mails=ids.map(id=>({id,subject:'SYNTHETIC',category_group:'HQ 업무',classification_state:'proposed',occurred_at:'2026-10-09T00:00:00Z'}));
test('reviewed business and skipped lists separate handling from server labels without mutating them',()=>{
 const before=JSON.stringify(mails),page=reviewedMailPage(mails,owned,decisions,{view:'reviewed',offset:0,category:'고객 업무',state:'all'});
 assert.equal(page.mails.length,1);assert.equal(page.mails[0].id,ids[0]);assert.equal(page.mails[0].handling.category,'고객 업무');
 assert.equal(page.mails[0].category_group,'HQ 업무');assert.equal(JSON.stringify(mails),before);
 const skipped=reviewedMailPage(mails,owned,decisions,{view:'registration-skipped',offset:0,category:'all',state:'all'});
 assert.equal(skipped.mails[0].id,ids[1]);assert.equal(skipped.summary.reviewed,2);assert.equal(skipped.summary.business,1);
});
test('changed, missing or duplicate owner receipt matches fail instead of exposing local decisions',()=>{
 for(const rows of [[],[{...owned[0],payload_hash:'e'.repeat(64)},owned[1]],[owned[0],owned[0]]])assert.throws(()=>reviewedMailPage(mails,rows,decisions,{view:'reviewed',offset:0,category:'all',state:'all'}));
 assert.throws(()=>reviewedMailPage([mails[0]],owned,decisions,{view:'reviewed',offset:0,category:'all',state:'all'}));
});
test('reviewed API validates real auth and allowlist before local reads, owner queries and GET only',async()=>{
 const uid='00000000-0000-4000-8000-000000000099',calls=[];let locals=0;
 const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',localHandling:async owner=>{assert.equal(owner,uid);locals++;return decisions;}};
 const request=(token=true)=>new Request('http://127.0.0.1:4317/api/outlook?view=reviewed&owner_id=forged',{headers:token?{authorization:'Bearer synthetic'}:{}});
 const upstream=async(url,init)=>{const u=new URL(url);calls.push({u,init});if(u.pathname==='/auth/v1/user')return Response.json({id:uid});if(u.pathname==='/rest/v1/sales_access')return Response.json([{user_id:uid,enabled:true}]);return Response.json(u.pathname.endsWith('/sales_outlook_mail')?owned:mails);};
 assert.equal((await handleApi(request(false),env,upstream)).status,401);assert.equal(locals,0);
 const response=await handleApi(request(),env,upstream);assert.equal(response.status,200);assert.equal((await response.json()).mails.length,1);assert.equal(locals,1);
 for(const {u,init} of calls){assert.equal(init.method,'GET');if(u.pathname.includes('/sales_outlook_')){assert.equal(u.searchParams.get('owner_id'),'eq.'+uid);assert.equal(u.searchParams.get('select').includes('original'),false);}}
 const missing=await handleApi(request(),{...env,localHandling:undefined},upstream);assert.equal(missing.status,503);
 const denied=await handleApi(request(),env,async(url,init)=>new URL(url).pathname.endsWith('/sales_access')?Response.json([]):upstream(url,init));assert.equal(denied.status,403);assert.equal(locals,1);
});
