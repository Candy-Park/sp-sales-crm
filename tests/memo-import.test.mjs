import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateMemoImport} from '../src/memo-import.mjs';
import {memoInput} from '../src/remote-input.mjs';
export const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export function fixture(){
 const selection={schema_version:1,source_project_ref:'syntheticsource',source_owner_id:uid(2),expected_target_project_ref:'synthetictarget',expected_target_owner_id:uid(1),records:[3,4,5].map((n,i)=>({source_id:uid(n),expected_revision:1,category:i===0?'personal':'work',homeTask:i===1}))};
 const records=selection.records.map(r=>{const snapshot=JSON.stringify({category:r.category,completed_at:null,content:'  SYNTHETIC <memo> '+r.source_id+'  ',created_at:'2026-10-01T01:00:00Z',due_date:null,id:r.source_id,owner_id:uid(2),revision:1,updated_at:'2026-10-01T01:00:00Z'});return {content:JSON.parse(snapshot).content.trim(),category:r.category,dueDate:null,homeTask:r.homeTask,origin:{projectRef:selection.source_project_ref,ownerId:uid(2),entity:'crm_memo',id:r.source_id,revision:1,createdAt:'2026-10-01T01:00:00Z',updatedAt:'2026-10-01T01:00:00Z',capturedAt:'2026-10-21T01:00:00Z',snapshot,sha256:createHash('sha256').update(snapshot).digest('hex')}};});
 return {selection,manifest:{schema_version:1,targetProjectRef:selection.expected_target_project_ref,targetOwnerId:uid(1),records}};
}
test('import validates exactly selected three, canonical snapshots and target/source identity',async()=>{
 const {manifest,selection}=fixture();const records=await validateMemoImport(manifest,selection,uid(1));assert.equal(records.length,3);assert.equal(records.filter(r=>r.homeTask).length,1);assert.match(records[0].origin.snapshot,/  SYNTHETIC/);
 for(const mutate of [m=>m.records.pop(),m=>m.records.push(m.records[0]),m=>m.targetOwnerId=uid(2),m=>m.targetProjectRef='other',m=>m.records[0].origin.ownerId=uid(1),m=>m.records[0].origin.sha256='0'.repeat(64),m=>m.records[0].origin.revision=2,m=>m.records[0].homeTask=true,m=>m.records[0].content='changed',m=>m.records[0].origin.snapshot='{}']){const m=structuredClone(manifest);mutate(m);await assert.rejects(validateMemoImport(m,selection,uid(1)));}
});
test('origin metadata only accepted on complete import creation, never mutable PATCH',()=>{
 const input=fixture().manifest.records[0];assert.deepEqual(memoInput({requestId:uid(8),input}).patch,input);
 for(const patch of [{origin:input.origin},{homeTask:true}])assert.throws(()=>memoInput({requestId:uid(8),revision:1,patch}));
 assert.throws(()=>memoInput({requestId:uid(8),input:{content:'x',category:'work',dueDate:null,homeTask:true}}));
});
