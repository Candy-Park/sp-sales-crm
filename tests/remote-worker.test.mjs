import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/remote-worker.mjs';
test('external Worker protects API, adds security headers and serves only packaged assets',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('<html>SYNTHETIC shell</html>',{headers:{'content-type':'text/html'}})}};
 const page=await worker.fetch(new Request('https://crm.example/'),env);
 assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal(page.headers.get('referrer-policy'),'no-referrer');
 const result=await worker.fetch(new Request('https://crm.example/api/crm/memos'),env);
 assert.notEqual(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
});
