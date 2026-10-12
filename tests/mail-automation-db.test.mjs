// Real application SQL/API in an isolated in-memory PostgreSQL database.
// Synthetic mail only; never loads .env, production backups, tokens or mailboxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {handleApi} from '../src/api.mjs';
import {reconcileRequests,reconcileEvents} from '../src/crm-mail-import.mjs';

const owner='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const customer='00000000-0000-4000-8000-000000000003';
function syntheticPlan(){
 const code=`import sys,json,tempfile,hashlib
sys.path.insert(0,'tools')
from pathlib import Path
from outlook_outbox import Outbox
from outlook_discovery import candidate,prepare_import,communication_event
owner='${owner}'
key=hashlib.sha256(b'synthetic-new-request').hexdigest()
mail=dict(source_key=key,conversation_key=hashlib.sha256(b'synthetic-conversation').hexdigest(),direction='received',sender='buyer@example.invalid',recipients='Candy',subject='SYNTHETIC packing request',body='Candy, please provide packing specifications.',occurred_at='2026-10-11T01:00:00.0000000Z',attachments=[])
settings=dict(customers=[dict(id='${customer}',name='SYNTHETIC customer',domains=['example.invalid'])],hq_domains=['hq.invalid'])
value=candidate(mail,settings)
with tempfile.TemporaryDirectory() as folder:
 path=Path(folder)/'synthetic.sqlite'
 box=Outbox(path);box.bind_owner(owner);box.close()
 plan=prepare_import(path,owner,value,'2026-10-12')
 sent=mail|dict(source_key=hashlib.sha256(b'synthetic-sent').hexdigest(),direction='sent',body='Packing specifications attached.',occurred_at='2026-10-11T02:00:00.0000000Z')
 event=communication_event(sent,settings,{}, {sent['source_key']:['example.invalid']},owner,plan['registration']['id'])
 print(json.dumps(dict(plan=plan,candidate=value,event=event)))`;
 return JSON.parse(execFileSync('python',['-X','utf8','-c',code],{windowsHide:true,encoding:'utf8',timeout:15000}));
}

test('new mail survives uncertain receipt, SQL requery, sent-history retry and owner isolation',async()=>{
 const fixture=syntheticPlan(),pg=await PGlite.create();
 try{
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for(const path of ['db/schema-basic.sql','db/basic-work-write.sql','db/communication.sql','db/enable-basic-write.sql','db/enable-communication.sql'])await pg.exec(await readFile(path,'utf8'));
  await pg.query('insert into auth.users values($1),($2)',[owner,other]);
  await pg.query('insert into sales_access(user_id) values($1),($2)',[owner,other]);
  await pg.query('insert into sales_customer(id,owner_id,name) values($1,$2,$3)',[customer,owner,'SYNTHETIC customer']);
  await pg.exec('grant select on sales_access,sales_customer,sales_contact,sales_project,sales_inquiry,sales_action to authenticated');
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await pg.exec('set role authenticated');
  let actor=owner,lostReceipt=true;const errors=[];
  const upstream=async(raw,options)=>{
   const url=new URL(raw),path=url.pathname;
   if(path==='/auth/v1/user')return Response.json({id:actor,is_anonymous:false});
   try{
    if(path.startsWith('/rest/v1/rpc/')){
     const rpc=path.split('/').at(-1),body=JSON.parse(options.body);
     assert.ok(['sales_register_inquiry','sales_add_action','sales_record_message','sales_close_inquiry'].includes(rpc));
     const args=body.p_inquiry_id||body.p_id;
     const result=await pg.query(args?`select public.${rpc}($1::uuid,$2::jsonb) result`:`select public.${rpc}($1::jsonb) result`,args?[args,JSON.stringify(body.p_data)]:[JSON.stringify(body.p_data)]);
     if(rpc==='sales_record_message'&&lostReceipt){lostReceipt=false;return Response.json({code:'SYNTHETIC_LOST_RECEIPT'},{status:503});}
     return Response.json(result.rows[0].result);
    }
    const table=path.split('/').at(-1);assert.ok(['sales_access','sales_inquiry','sales_action','sales_message','sales_hq_question','sales_hq_review'].includes(table));
    const clauses=[],values=[];
    for(const [column,value] of url.searchParams)if(['user_id','owner_id','id','inquiry_id','enabled'].includes(column)){
     assert.ok(value.startsWith('eq.'));values.push(value.slice(3));clauses.push(`${column}=$${values.length}`);
    }
    const result=await pg.query(`select * from public.${table}${clauses.length?' where '+clauses.join(' and '):''}`,values);
    return Response.json(result.rows.map(row=>({...row,...(row.due_date instanceof Date?{due_date:row.due_date.toISOString().slice(0,10)}:{})})));
   }catch(error){errors.push(error);return Response.json({code:error.code||'SYNTHETIC_DB_ERROR'},{status:400});}
  };
  const env={SUPABASE_URL:'https://glscckjmlwvxilzneqdf.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_SYNTHETIC_ONLY'};
  const api=(path,body)=>handleApi(new Request('http://localhost'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer SYNTHETIC_ONLY','content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env,upstream);
  let acknowledgements=0;
  const local=async input=>{if(input.mode==='ack')acknowledgements++;return fixture.plan;};
  const analysis={candidates:[fixture.candidate]},context={owner,targets:[]};
  const uncertain=await reconcileRequests(analysis,context,local,api);
  assert.equal(uncertain.incomplete,true);assert.equal(acknowledgements,0);
  const recovered=await reconcileRequests(analysis,context,local,api);
  assert.equal(recovered.imported,1,JSON.stringify(errors.map(e=>e.message)));assert.equal(recovered.incomplete,false);assert.equal(acknowledgements,1);
  const iid=fixture.plan.registration.id;
  let detail=await (await api('/api/inquiries/'+iid)).json();
  assert.equal(detail.actions.length,1);assert.equal(detail.actions[0].due_date,'2026-10-15');assert.equal(detail.actions[0].mandatory,true);
  assert.equal(detail.inquiry.original_text,fixture.plan.registration.original_text);assert.equal(detail.inquiry.status,'customer_reply_needed');
  const eventData={events:[fixture.event],held:0};
  assert.equal((await reconcileEvents(eventData,path=>api(path),api)).recorded,1);
  assert.equal((await reconcileEvents(eventData,path=>api(path),api)).recorded,0);
  detail=await (await api('/api/inquiries/'+iid)).json();
  assert.equal(detail.inquiry.status,'waiting_for_customer');assert.equal(detail.actions[0].status,'open');assert.equal(detail.actions[0].due_date,'2026-10-15');
  assert.equal((await (await api('/api/inquiries/'+iid+'/communication')).json()).messages.length,2);
  const blocked=await api('/api/inquiries/'+iid+'/close',{revision:detail.inquiry.revision,resolved:true});
  assert.equal(blocked.status,422);assert.ok(errors.some(error=>error.code==='23514'&&error.message==='Open mandatory action'),JSON.stringify(errors.map(error=>error.message)));
  actor=other;await pg.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal((await api('/api/inquiries/'+iid)).status,404);
  assert.equal((await (await api('/api/inquiries/'+iid+'/communication')).json()).messages.length,0);
  await pg.exec('reset role');
  assert.equal((await pg.query('select count(*)::int n from sales_inquiry')).rows[0].n,1);
  assert.equal((await pg.query('select count(*)::int n from sales_action')).rows[0].n,1);
  assert.equal((await pg.query('select count(*)::int n from sales_message')).rows[0].n,2);
 }finally{await pg.close();}
});
