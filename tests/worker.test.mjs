import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
test('Worker exposes only validated public config and denies secret configuration',async()=>{
  const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',ASSETS:{fetch:()=>new Response('static assets')}};
  const request=new Request('https://crm.example.test/config.json');
  const good=await worker.fetch(request,env);assert.equal(good.status,200);assert.equal((await good.json()).publishableKey,'sb_publishable_synthetic');
  const bad=await worker.fetch(request,{...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_forbidden'});
  assert.equal(bad.status,503);assert.doesNotMatch(await bad.text(),/sb_secret/);
});
