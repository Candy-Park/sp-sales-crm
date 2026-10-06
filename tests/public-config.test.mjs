import test from 'node:test';
import assert from 'node:assert/strict';
import {publicConfig} from '../src/public-config.mjs';
test('public config refuses secrets and wrong projects before serialization',()=>{
  const url='https://glscckjmlwvxilzneqdf.supabase.co';
  for(const key of ['sb_secret_sensitive','eyJlegacy-token',''])assert.equal(publicConfig({SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:key}),null);
  assert.equal(publicConfig({SUPABASE_URL:'https://legacy.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic'}),null);
  assert.deepEqual(publicConfig({SUPABASE_URL:url,SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',EXTRA_SECRET:'private'}),{url,publishableKey:'sb_publishable_synthetic'});
});
