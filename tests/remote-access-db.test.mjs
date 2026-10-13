import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {memoInput, snapshotInput} from '../src/remote-input.mjs';
const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const request='00000000-0000-4000-8000-000000000003',next='00000000-0000-4000-8000-000000000004';
async function database(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.sales_access(user_id uuid primary key,enabled boolean not null);
 insert into public.sales_access values('${owner}',true),('${other}',true);
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 alter table public.sales_access enable row level security;
 create policy access_own on public.sales_access for select to authenticated using(user_id=auth.uid());
 grant select on public.sales_access to authenticated;`);
 await db.exec(await readFile('db/remote-access.sql','utf8'));return db;
}
async function as(db,id){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);}
test('remote memo input rejects forged owner, impossible dates and invalid partial updates',()=>{
 assert.deepEqual(memoInput({requestId:request,input:{content:'  synthetic  ',category:'work',dueDate:null}}),{requestId:request,revision:0,patch:{content:'synthetic',category:'work',dueDate:null}});
 for(const input of [{requestId:request,owner_id:owner,input:{content:'x',category:'work',dueDate:null}},{requestId:request,input:{content:'x',category:'work',dueDate:'2026-02-30'}},{requestId:request,revision:1,patch:{completed:'true'}}])assert.throws(()=>memoInput(input));
 assert.throws(()=>snapshotInput({requestId:request,kind:'analysis',revision:0,payload:[],owner_id:owner}));
});
test('cloud memos preserve create retries, edit versions, completion and original history',async()=>{
 const db=await database();try{
 await as(db,owner);const patch={content:'SYNTHETIC memo',category:'work',dueDate:'2026-10-16'};
 const write=(rid,id,rev,p)=>db.query('select public.sales_remote_memo_write($1,$2,$3,$4) as memo',[rid,id,rev,JSON.stringify(p)]);
 const first=(await write(request,null,0,patch)).rows[0].memo;
 assert.equal(first.content,patch.content);assert.equal(first.revision,1);
 assert.deepEqual((await write(request,null,0,patch)).rows[0].memo,first);
 await assert.rejects(write(request,null,0,{...patch,content:'different'}),/request conflict/);
 const changed=(await write(next,first.id,1,{completed:true})).rows[0].memo;assert.equal(changed.revision,2);assert.ok(changed.completedAt);
 await assert.rejects(write('00000000-0000-4000-8000-000000000005',first.id,1,{content:'stale'}),/version conflict/);
 const rows=await db.query('select snapshot from public.sales_remote_memo_history order by revision');assert.equal(rows.rows.length,2);assert.equal(rows.rows[0].snapshot.content,'SYNTHETIC memo');
 await as(db,other);assert.equal((await db.query('select * from public.sales_remote_memo')).rows.length,0);
 await assert.rejects(write('00000000-0000-4000-8000-000000000006',first.id,2,{completed:false}),/memo unavailable/);
 }finally{await db.close();}
});
test('private snapshots enforce owner, idempotency and version ordering; anonymous reads fail',async()=>{
 const db=await database();try{
 await as(db,owner);const put=(rid,rev,payload)=>db.query('select public.sales_remote_snapshot_write($1,$2,$3,$4) as state',[rid,'analysis',rev,JSON.stringify(payload)]);
 const first=(await put(request,0,{threads:[],candidates:[]})).rows[0].state;
 assert.equal(first.revision,1);assert.deepEqual((await put(request,0,{threads:[],candidates:[]})).rows[0].state,first);
 await put(next,1,{threads:[],candidates:[],checked:true});
 await assert.rejects(put('00000000-0000-4000-8000-000000000005',1,{stale:true}),/version conflict/);
 await as(db,other);assert.equal((await db.query('select * from public.sales_remote_snapshot')).rows.length,0);
 await db.exec('reset role;set role anon;');await assert.rejects(db.query('select * from public.sales_remote_snapshot'),/permission denied/);
 }finally{await db.close();}
});
test('PC commands are owner-scoped, idempotent, leased and cannot complete after a stale claim',async()=>{
 const db=await database();try{
 await as(db,owner);
 const enqueue=(rid,input)=>db.query('select public.sales_remote_enqueue($1,$2) as command',[rid,JSON.stringify(input)]);
 const first=(await enqueue(request,{operation:'refresh'})).rows[0].command;
 assert.deepEqual((await enqueue(request,{operation:'refresh'})).rows[0].command,first);
 await assert.rejects(enqueue(next,{operation:'refresh',owner_id:other}),/invalid command/);
 await as(db,other);assert.equal((await db.query('select public.sales_remote_claim() as command')).rows[0].command,null);
 await as(db,owner);const claimed=(await db.query('select public.sales_remote_claim() as command')).rows[0].command;
 assert.equal(claimed.id,first.id);assert.ok(claimed.lease);
 assert.equal((await db.query('select public.sales_remote_claim() as command')).rows[0].command,null);
 const complete=(lease,result)=>db.query('select public.sales_remote_complete($1,$2,$3) as command',[first.id,lease,JSON.stringify(result)]);
 await assert.rejects(complete(next,{ok:true}),/lease conflict/);
 const done=(await complete(claimed.lease,{ok:true})).rows[0].command;
 assert.equal(done.state,'done');assert.deepEqual((await complete(claimed.lease,{ok:true})).rows[0].command,done);
 await assert.rejects(complete(claimed.lease,{ok:false}),/result conflict/);
 await as(db,other);assert.equal((await db.query('select * from public.sales_remote_command')).rows.length,0);
 }finally{await db.close();}
});
