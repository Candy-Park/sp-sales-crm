import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openMemoStore} from '../src/local-memos.mjs';
const create=()=>({requestId:randomUUID(),input:{content:'SYNTHETIC 메모',category:'work',dueDate:'2026-10-12'}});
test('memo create, edit, complete and reopen persist across database reopen',()=>{
 const dir=mkdtempSync(join(tmpdir(),'crm-memo-test-')),path=join(dir,'memos.sqlite');let store;
 try{store=openMemoStore(path);const first=store.create(create());const edited=store.update(first.id,{requestId:randomUUID(),revision:1,patch:{content:'SYNTHETIC 수정',completed:true}});assert.equal(edited.revision,2);assert.ok(edited.completedAt);store.close();store=openMemoStore(path);const saved=store.list()[0];assert.equal(saved.content,'SYNTHETIC 수정');assert.equal(saved.category,'work');assert.equal(saved.dueDate,'2026-10-12');assert.ok(saved.completedAt);assert.equal(store.update(saved.id,{requestId:randomUUID(),revision:2,patch:{completed:false}}).completedAt,null);
 }finally{store?.close();unlinkSync(path);rmdirSync(dir);}
});
test('retry creates exactly once and stale revision cannot overwrite a memo',()=>{
 const store=openMemoStore(':memory:');try{const request=create(),first=store.create(request);assert.deepEqual(store.create(request),first);assert.equal(store.list().length,1);assert.throws(()=>store.create({...request,input:{...request.input,content:'DIFFERENT'}}),e=>e.status===409);const patch={requestId:randomUUID(),revision:1,patch:{content:'UPDATED'}};const edited=store.update(first.id,patch);assert.deepEqual(store.update(first.id,patch),edited);assert.throws(()=>store.update(first.id,{requestId:randomUUID(),revision:1,patch:{content:'STALE'}}),e=>e.status===409);assert.equal(store.list()[0].content,'UPDATED');}finally{store.close();}
});
test('invalid dates, empty content, unknown keys and foreign memo ids are rejected',()=>{
 const store=openMemoStore(':memory:');try{for(const change of [{content:' '},{content:'x'.repeat(10001)},{category:'other'},{dueDate:'2026-02-30'},{password:'SYNTHETIC'}])assert.throws(()=>store.create({...create(),input:{...create().input,...change}}),e=>e.status===400);assert.throws(()=>store.update(randomUUID(),{requestId:randomUUID(),revision:1,patch:{completed:true}}),e=>e.status===404);assert.equal(store.list().length,0);}finally{store.close();}
});
