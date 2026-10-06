import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi} from '../src/api.mjs';

const env = {SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co', SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'};
const uid = 'a11803c8-01ef-4563-95bb-c0024541be2c';
function request(path='/api/me', token='synthetic-token') {
  return new Request('http://127.0.0.1:4317'+path, {headers:token ? {authorization:'Bearer '+token} : {}});
}
function upstream({enabled=true, authStatus=200, dataStatus=200}={}) {
  const seen=[];
  return {seen, fetch:async (input, init) => {
    const url=new URL(typeof input==='string' ? input : input.url);
    const headers=new Headers(init?.headers ?? input.headers);
    seen.push({url,headers});
    if(url.pathname==='/auth/v1/user') return Response.json(authStatus===200 ? {id:uid,email:'user@example.test'} : {msg:'invalid token'}, {status:authStatus});
    if(url.pathname==='/rest/v1/sales_access') return Response.json(enabled ? [{user_id:uid,enabled:true}] : []);
    if(dataStatus!==200) return Response.json({message:'private backend detail'}, {status:dataStatus});
    return Response.json([]);
  }};
}
test('anonymous request is rejected before any upstream data request', async()=>{
  const up=upstream(); const r=await handleApi(request('/api/me',null),env,up.fetch);
  assert.equal(r.status,401); assert.equal(up.seen.length,0);
});
test('invalid token cannot reach the allowlist or business tables',async()=>{
  const up=upstream({authStatus:401}); const r=await handleApi(request(),env,up.fetch);
  assert.equal(r.status,401); assert.equal(up.seen.length,1);
});
test('authenticated but unapproved user is denied',async()=>{
  const up=upstream({enabled:false}); const r=await handleApi(request(),env,up.fetch);
  assert.equal(r.status,403); assert.equal(up.seen.length,2);
});
test('enabled user is verified remotely and gets an explicit allowed response',async()=>{
  const up=upstream(); const r=await handleApi(request(),env,up.fetch);
  assert.equal(r.status,200); assert.equal((await r.json()).user.id,uid);
  assert.equal(up.seen[0].url.pathname,'/auth/v1/user');
  assert.equal(up.seen[1].url.searchParams.get('user_id'),'eq.'+uid);
  assert.equal(up.seen[1].headers.get('authorization'),'Bearer synthetic-token');
  assert.equal(r.headers.get('cache-control'),'no-store');
});
test('dashboard ignores forged owner query and filters by verified user',async()=>{
  const up=upstream(); const r=await handleApi(request('/api/dashboard?owner_id=forged'),env,up.fetch);
  assert.equal(r.status,200); const data=await r.json(); assert.deepEqual(data.actions,[]);
  for(const call of up.seen.slice(2)) assert.equal(call.url.searchParams.get('owner_id'),'eq.'+uid);
});
test('database failure is an error rather than an empty dashboard',async()=>{
  const up=upstream({dataStatus:403}); const r=await handleApi(request('/api/dashboard'),env,up.fetch);
  assert.equal(r.status,503); assert.doesNotMatch(await r.text(),/private backend detail/);
});
test('network failure is bounded and returns a safe error',async()=>{
  const r=await handleApi(request(),env,async()=>{throw new Error('secret network detail');});
  assert.equal(r.status,503); assert.doesNotMatch(await r.text(),/secret network detail/);
});
test('missing or secret-key configuration fails closed',async()=>{
  for(const key of ['', 'sb_secret_forbidden']) {
    const up=upstream(); const r=await handleApi(request(),{...env,SUPABASE_PUBLISHABLE_KEY:key},up.fetch);
    assert.equal(r.status,503); assert.equal(up.seen.length,0);
  }
});
test('write method is rejected in this read-only slice',async()=>{
  const up=upstream();const r=await handleApi(new Request('http://127.0.0.1:4317/api/me',{method:'POST'}),env,up.fetch);
  assert.equal(r.status,405);assert.equal(up.seen.length,0);
});
