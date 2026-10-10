import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {openMemoStore} from '../src/local-memos.mjs';
import {handleLocalMemos} from '../src/local-memo-api.mjs';
import {createServer} from 'node:http';
import {mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const origin='http://127.0.0.1:4327';
async function call(store,method,path,body,extra={}){const req=Readable.from([JSON.stringify(body??{})]);req.method=method;req.headers={host:'127.0.0.1:4327',origin,'content-type':'application/json',...extra};const result={};const res={writeHead:status=>result.status=status,end:body=>result.body=JSON.parse(body)};await handleLocalMemos(req,res,path,store,origin);return result;}
test('memo API requires same-origin JSON writes and leaves non-memo routes untouched',async()=>{
 const store=openMemoStore(':memory:');try{const body={requestId:randomUUID(),input:{content:'SYNTHETIC',category:'personal',dueDate:null}};assert.equal((await call(store,'POST','/api/memos',body,{origin:undefined})).status,403);assert.equal((await call(store,'POST','/api/memos',body,{origin:'https://example.test'})).status,403);assert.equal((await call(store,'POST','/api/memos',body,{'content-type':'text/plain'})).status,403);assert.equal((await call(store,'GET','/api/memos',null,{host:'evil.test'})).status,403);assert.equal(store.list().length,0);assert.equal(await handleLocalMemos({}, {},'/api/outlook',store,origin),false);}finally{store.close();}
});
test('memo API creates, lists, updates and rejects delete or malformed requests',async()=>{
 const store=openMemoStore(':memory:');try{const created=await call(store,'POST','/api/memos',{requestId:randomUUID(),input:{content:'SYNTHETIC',category:'work',dueDate:null}});assert.equal(created.status,201);const id=created.body.memo.id;assert.equal((await call(store,'GET','/api/memos')).body.memos.length,1);assert.equal((await call(store,'PATCH','/api/memos/'+id,{requestId:randomUUID(),revision:1,patch:{completed:true}})).status,200);assert.equal((await call(store,'DELETE','/api/memos/'+id)).status,405);assert.equal((await call(store,'POST','/api/memos',{})).status,400);assert.equal((await call(store,'POST','/api/memos',{large:'x'.repeat(70000)})).status,413);}finally{store.close();}
});
test('real loopback HTTP memo save survives DB reopen; foreign origin cannot write',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'crm-memo-http-test-')),path=join(dir,'memos.sqlite');let store=openMemoStore(path),base;
 const server=createServer(async(req,res)=>{await handleLocalMemos(req,res,new URL(req.url,base).pathname,store,base);});
 try{await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 const request={requestId:randomUUID(),input:{content:'SYNTHETIC HTTP PERSISTENCE',category:'personal',dueDate:null}};
 const denied=await fetch(base+'/api/memos',{method:'POST',headers:{Origin:'https://example.test','Content-Type':'application/json'},body:JSON.stringify(request)});assert.equal(denied.status,403);
 const response=await fetch(base+'/api/memos',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(request)});assert.equal(response.status,201);const saved=(await response.json()).memo;
 store.close();store=openMemoStore(path);const listed=await(await fetch(base+'/api/memos')).json();assert.equal(listed.memos[0].id,saved.id);assert.equal(listed.memos[0].content,'SYNTHETIC HTTP PERSISTENCE');
 const edited=await fetch(base+'/api/memos/'+saved.id,{method:'PATCH',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({requestId:randomUUID(),revision:1,patch:{completed:true}})});assert.equal(edited.status,200);assert.ok((await edited.json()).memo.completedAt);
 }finally{await new Promise(r=>server.close(r));store.close();unlinkSync(path);rmdirSync(dir);}
});
