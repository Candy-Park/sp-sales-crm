import test from 'node:test';
import assert from 'node:assert/strict';
import {localFollowups} from '../tools/outlook-local.mjs';
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('restarting Outlook clears stale skipped state and keeps completion polling active',async()=>{
 const input={owner:'synthetic-restart',mode:'refresh',targets:[{id:'mail',inquiry_id:'inquiry'}]};
 await localFollowups(input,async()=>({skipped:'outlook_not_running',updates:[{mail_id:'mail',inquiry_id:'inquiry'}]}));
 await flush();
 assert.equal((await localFollowups({...input,mode:'status'})).skipped,'outlook_not_running');
 let finish;
 const started=await localFollowups(input,()=>new Promise(resolve=>finish=resolve));
 assert.equal(started.running,true);assert.equal(started.skipped,undefined);
 const polling=await localFollowups({...input,mode:'status'});
 assert.equal(polling.running,true);assert.equal(polling.skipped,undefined);
 finish({ready:true,last_checked_at:'2026-10-11T10:20:00Z',updates:[{mail_id:'mail',inquiry_id:'inquiry'}]});
 await flush();
 const completed=await localFollowups({...input,mode:'status'});
 assert.equal(completed.running,false);assert.equal(completed.ready,true);assert.equal(completed.skipped,undefined);
});
