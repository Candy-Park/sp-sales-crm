import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileEvents} from '../src/crm-mail-import.mjs';
const iid='11111111-1111-4111-8111-111111111111',mid='22222222-2222-4222-8222-222222222222';
test('repeated observations skip recorded source IDs and closed inquiries without completing Actions',async()=>{
 let writes=0;const events=[{inquiry_id:iid,message:{id:mid,kind:'customer_sent',actual_confirmed:true}}];
 const query=async path=>Response.json(path.endsWith('/communication')?{messages:[{id:mid}],truncated:false}:{inquiry:{id:iid,status:'new'}});
 const result=await reconcileEvents({events,held:1},query,async()=>{writes++;});assert.equal(writes,0);assert.equal(result.recorded,0);assert.equal(result.held,1);
 const closed=await reconcileEvents({events},async()=>Response.json({inquiry:{id:iid,status:'closed'}}),async()=>{writes++;});assert.equal(writes,0);assert.equal(closed.held,1);
});
test('actual sent evidence records history only and stops on uncertain saves',async()=>{
 const message={id:mid,kind:'hq_sent',actual_confirmed:true};let saved;
 const query=async path=>Response.json(path.endsWith('/communication')?{messages:[],truncated:false}:{inquiry:{id:iid,status:'new'}});
 const result=await reconcileEvents({events:[{inquiry_id:iid,message}]},query,async(path,body)=>{saved={path,body};return Response.json({result:mid});});
 assert.equal(result.recorded,1);assert.deepEqual(saved.body,message);assert.equal(saved.path,`/api/inquiries/${iid}/messages`);assert.equal(saved.body.action_id,undefined);
 const failed=await reconcileEvents({events:[{inquiry_id:iid,message}]},query,async()=>Response.json({error:'uncertain'},{status:503}));assert.equal(failed.incomplete,true);
});
