import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../src/api.mjs';
import {searchProducts,productQuery,linkInput} from '../src/products.mjs';
const lr={pn:'LR',family_rate_gbps:100,form_factor:'QSFP28',application:'100GBASE-LR4',reach:[{medium:'SMF',min_m:2,max_m:10000}],temperature:{basis:'case_operating',min_c:0,max_c:70},wavelengths_nm:[{min:1294.53,max:1296.59},{min:1308.09,max:1310.19}]};
const sr={...lr,pn:'SR',application:'100GBASE-SR4',reach:[{medium:'OM3',min_m:0.5,max_m:70},{medium:'OM4',min_m:0.5,max_m:100}],wavelengths_nm:[{min:840,max:860,typical:null}]};
test('P/N-only lookup never implies technical specification compatibility',()=>assert.equal(searchProducts([lr],{q:'LR'})[0].match,'unfiltered'));
test('LR4 10km and case operating temperature matches reviewed LR4',()=>{
 const found=searchProducts([lr,sr],{rate_gbps:100,form_factor:'QSFP28',medium:'SMF',reach_m:10000,min_c:0,max_c:70});
 assert.equal(found[0].product.pn,'LR');assert.equal(found[0].match,'match');assert.equal(found[1].match,'mismatch');
});
test('OM3 100m mismatches SR4, OM4 100m matches; reach minimum matters',()=>{
 assert.equal(searchProducts([sr],{medium:'OM3',reach_m:100})[0].match,'mismatch');
 assert.equal(searchProducts([sr],{medium:'OM4',reach_m:100})[0].match,'match');
 assert.equal(searchProducts([lr],{medium:'SMF',reach_m:1})[0].match,'mismatch');
});
test('industrial temperature and unsupported wavelength fail; missing facts need confirmation',()=>{
 assert.ok(searchProducts([lr,sr],{min_c:-40,max_c:85}).every(p=>p.match==='mismatch'));
 assert.equal(searchProducts([sr],{wavelength_nm:1310})[0].match,'mismatch');
 assert.equal(searchProducts([{pn:'UNKNOWN'}],{medium:'OM4',reach_m:100})[0].match,'unknown');
 assert.equal(searchProducts([lr],{packing:true})[0].match,'unknown');
});
test('filters reject reversed temperature, invalid units, unknown filters and malformed numbers',()=>{
 for(const q of ['reach_m=-1','reach_m=1e4','min_c=70&max_c=0','rate_gbps=0','medium=MMF','reach_m=100','owner_id=forged','packing=yes'])assert.throws(()=>productQuery(new URLSearchParams(q)));
 assert.deepEqual(productQuery(new URLSearchParams('q=SPQ&medium=OM4&reach_m=100&packing=true')),{q:'SPQ',medium:'OM4',reach_m:100,packing:true});
});
const uid='a11803c8-01ef-4563-95bb-c0024541be2c',iid='20000000-0000-4000-8000-000000000001',pid='30000000-0000-4000-8000-000000000001';
const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
const body={id:iid,product_id:pid,disposition:'candidate',reason:'100G 검토 후보'};
function req(path,method='GET',data){return new Request('http://127.0.0.1:4317'+path,{method,headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:data?JSON.stringify(data):undefined});}
function up({enabled=true,code=null}={}){let seen=[];return {seen,fetch:async(url,init)=>{url=new URL(url);seen.push({url,init});if(url.pathname==='/auth/v1/user')return Response.json({id:uid});if(url.pathname.endsWith('sales_access'))return Response.json(enabled?[{user_id:uid,enabled:true}]:[]);if(url.pathname.includes('/rpc/'))return code?Response.json({code},{status:400}):Response.json(iid);if(url.pathname.endsWith('sales_product'))return Response.json([{id:pid,spec:lr}]);return Response.json([]);}};}
test('catalog API verifies allowlist and owner; server returns comparison classification',async()=>{
 const u=up();const r=await handleApi(req('/api/products?medium=SMF&reach_m=10000'),env,u.fetch);assert.equal(r.status,200);assert.equal((await r.json()).products[0].match,'match');assert.equal(u.seen.at(-1).url.searchParams.get('owner_id'),'eq.'+uid);
 const denied=up({enabled:false});assert.equal((await handleApi(req('/api/products'),env,denied.fetch)).status,403);assert.equal(denied.seen.length,2);
});
test('link needs reason and explicit disposition; client owner/snapshot rejected',()=>{
 assert.equal(linkInput(body).reason,body.reason);
 for(const b of [{...body,reason:''},{...body,owner_id:uid},{...body,snapshot:lr},{...body,disposition:'confirmed'},{...body,product_id:'fake'}])assert.throws(()=>linkInput(b));
});
test('candidate POST is an owner-safe RPC and Closed rejection is actionable',async()=>{
 const u=up();assert.equal((await handleApi(req('/api/inquiries/'+iid+'/products','POST',body),env,u.fetch)).status,200);assert.equal(u.seen.at(-1).url.pathname,'/rest/v1/rpc/sales_link_product');assert.deepEqual(JSON.parse(u.seen.at(-1).init.body),{p_inquiry_id:iid,p_data:body});
 const closed=up({code:'23514'});assert.equal((await handleApi(req('/api/inquiries/'+iid+'/products','POST',body),env,closed.fetch)).status,422);
});
test('candidate history has inquiry and owner filters and disallows delete/update',async()=>{
 const u=up();assert.equal((await handleApi(req('/api/inquiries/'+iid+'/products'),env,u.fetch)).status,200);assert.equal(u.seen.at(-1).url.searchParams.get('inquiry_id'),'eq.'+iid);assert.equal(u.seen.at(-1).url.searchParams.get('owner_id'),'eq.'+uid);assert.equal((await handleApi(req('/api/inquiries/'+iid+'/products','DELETE'),env,u.fetch)).status,405);
});
test('product candidate denial happens before write, and forged owner/snapshot cannot reach RPC',async()=>{
 const denied=up({enabled:false});assert.equal((await handleApi(req('/api/inquiries/'+iid+'/products','POST',body),env,denied.fetch)).status,403);assert.equal(denied.seen.length,2);
 for(const bad of [{...body,owner_id:uid},{...body,snapshot:{pn:'invented'}}]){const u=up();assert.equal((await handleApi(req('/api/inquiries/'+iid+'/products','POST',bad),env,u.fetch)).status,400);assert.equal(u.seen.length,2);}
});
test('catalog failure reports an error instead of no candidates; disabled catalogue rows are filtered',async()=>{
 const u=up();await handleApi(req('/api/products'),env,u.fetch);assert.equal(u.seen.at(-1).url.searchParams.get('enabled'),'eq.true');
 const failed=await handleApi(req('/api/products'),env,async(url,init)=>new URL(url).pathname.endsWith('sales_product')?Response.json({}, {status:403}):u.fetch(url,init));assert.equal(failed.status,503);assert.equal((await failed.json()).products,undefined);
});
