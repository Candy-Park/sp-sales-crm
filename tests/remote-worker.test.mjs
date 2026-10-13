import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/remote-worker.mjs';
import {readFile} from 'node:fs/promises';
test('external Worker protects API, adds security headers and serves only packaged assets',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('<html>SYNTHETIC shell</html>',{headers:{'content-type':'text/html'}})}};
 const page=await worker.fetch(new Request('https://crm.example/'),env);
 assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.equal(page.headers.get('referrer-policy'),'no-referrer');
 const result=await worker.fetch(new Request('https://crm.example/api/crm/memos'),env);
 assert.notEqual(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
});
test('asset-first deployment has its own packaged security headers, without requiring Worker invocation',async()=>{
 const headers=await readFile('web/remote-headers','utf8');
 assert.match(headers,/^\/\*\r?\n/);
 assert.match(headers,/Content-Security-Policy:.*script-src 'self'.*frame-ancestors 'none'/);
 for(const name of ['Referrer-Policy: no-referrer','X-Content-Type-Options: nosniff','Strict-Transport-Security: max-age=31536000'])assert.ok(headers.includes(name));
 const builder=await readFile('tools/build-remote.mjs','utf8');assert.match(builder,/copyFile\('web\/remote-headers',out\+'\/_headers'\)/);
});
