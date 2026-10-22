import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {fixture,uid} from './memo-import.test.mjs';
async function database(){const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create table sales_access(user_id uuid primary key,enabled boolean not null);insert into sales_access values('${uid(1)}',true),('${uid(9)}',true);grant select on sales_access to authenticated;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`);await db.exec(await readFile('db/remote-access.sql','utf8'));await db.exec(await readFile('db/memo-origin.sql','utf8'));return db;}
async function as(db,id){await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated;`);}
test('import RPC returns current memo on any retry; conflicts and owner isolation preserve history',async()=>{
 const db=await database();try{await as(db,uid(1));const input=fixture().manifest.records[1];
 const write=async(rid,id,rev,p)=>(await db.query('select sales_remote_memo_write($1,$2,$3,$4) as memo',[uid(rid),id,rev,JSON.stringify(p)])).rows[0].memo;
 const first=await write(10,null,0,input);assert.equal(first.homeTask,true);assert.equal(first.origin.snapshot,input.origin.snapshot);
 const multiline=structuredClone(fixture().manifest.records[0]);const multilineSnap=JSON.parse(multiline.origin.snapshot);multilineSnap.content='\n\t\u00a0SYNTHETIC\u3000\n';multiline.content='SYNTHETIC';multiline.origin.snapshot=JSON.stringify(multilineSnap);multiline.origin.sha256=createHash('sha256').update(multiline.origin.snapshot).digest('hex');const multilineMemo=await write(18,null,0,multiline);assert.equal(multilineMemo.content,'SYNTHETIC');assert.equal(multilineMemo.origin.snapshot,multiline.origin.snapshot);
 const edited=await write(11,first.id,1,{content:'A edited',completed:true});assert.equal(edited.revision,2);
 assert.deepEqual(await write(10,null,0,input),edited);assert.deepEqual(await write(12,null,0,input),edited);
 assert.equal((await db.query('select * from sales_remote_memo')).rows.length,2);assert.equal((await db.query('select * from sales_remote_memo_history')).rows.length,3);
 await assert.rejects(write(10,null,0,{...input,content:'different'}),/request conflict/);
 const changed=structuredClone(input);const snap=JSON.parse(changed.origin.snapshot);snap.content='B changed';changed.content=snap.content;changed.origin.snapshot=JSON.stringify(snap);changed.origin.sha256=createHash('sha256').update(changed.origin.snapshot).digest('hex');await assert.rejects(write(13,null,0,changed),/source conflict/);
 for(const patch of [{homeTask:false},{origin:input.origin}])await assert.rejects(write(14,first.id,2,patch),/immutable|invalid/);
 const invalid=structuredClone(input);invalid.origin.sha256='0'.repeat(64);await assert.rejects(write(15,null,0,invalid),/invalid/);
 assert.equal((await db.query('select * from sales_remote_receipt')).rows.length,4);
 await as(db,uid(9));assert.equal((await db.query('select * from sales_remote_memo')).rows.length,0);await assert.rejects(write(16,first.id,2,{completed:false}),/memo unavailable/);
 await db.exec('reset role;set role anon;');await assert.rejects(write(17,null,0,input),/permission denied/);
 }finally{await db.close();}
});
