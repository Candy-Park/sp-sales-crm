import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileRequests} from '../src/crm-mail-import.mjs';
const key='a'.repeat(64),iid='11111111-1111-4111-8111-111111111111',aid='22222222-2222-4222-8222-222222222222';
test('verified plan is replayed unchanged and acknowledged only after inquiry/action/history succeed',async()=>{
 const calls=[],modes=[],plan={registration:{id:iid},action:{id:aid,due_date:'2026-10-14'},message:{id:aid},source_key:key};
 const local=async input=>{modes.push(input.mode);return plan;};
 const write=async(path,body)=>{calls.push([path,body]);return Response.json({result:path.endsWith('/actions')||path.endsWith('/messages')?aid:iid});};
 const result=await reconcileRequests({candidates:[{source_key:key,automatic_registration:true},{source_key:'b'.repeat(64),needs_customer_choice:true}]},{owner:iid,targets:[]},local,write);
 assert.equal(result.imported,1);assert.deepEqual(modes,['prepare','ack']);assert.equal(calls.length,3);assert.equal(calls[1][1].due_date,'2026-10-14');
});
test('partial failure stops without acknowledgement or completion; retry uses the same plan',async()=>{
 const modes=[];let count=0;
 const result=await reconcileRequests({candidates:[{source_key:key,automatic_registration:true}]},{owner:iid,targets:[]},async input=>{modes.push(input.mode);return {registration:{id:iid},action:{id:aid},message:{id:aid},source_key:key};},async()=>Response.json(count++?{error:'conflict'}:{result:iid},{status:count>1?409:200}));
 assert.equal(result.imported,0);assert.equal(result.incomplete,true);assert.deepEqual(modes,['prepare']);
});
