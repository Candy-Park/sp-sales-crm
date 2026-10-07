import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreBusiness,verifyBusiness} from '../tools/business-backup.mjs';
import {PGlite} from '@electric-sql/pglite';

function snapshot(){return {version:1,project:'glscckjmlwvxilzneqdf',tables:{sales_example:{columns:[{name:'id',type:'integer',notnull:true},{name:'original',type:'jsonb',notnull:true}],constraints:[{name:'sales_example_pkey',kind:'p',definition:'PRIMARY KEY (id)'}],indexes:[],triggers:[],policies:[],grants:[],column_grants:[],rls:false,force_rls:false,rows_xml_json:'[{"id":1,"original":{"body":"SYNTHETIC &amp; 😀"}}]',rows_sha:null}},functions:[],views:[],enums:[]};}

test('restore checks destination is empty and validates all relations before writing',async()=>{
 const pg=await PGlite.create();try{
  const bad=snapshot();bad.tables.private_other=bad.tables.sales_example;
  await assert.rejects(()=>restoreBusiness(pg,bad));assert.equal((await pg.query("select count(*)::int n from pg_class where relname='sales_example'")).rows[0].n,0);
  await pg.exec('create table public.sales_existing(id int)');await assert.rejects(()=>restoreBusiness(pg,snapshot()));
 }finally{await pg.close();}
});

test('separate Postgres restore preserves unicode, XML escaping, constraints and detects content corruption',async()=>{
 const pg=await PGlite.create();try{
  const data=snapshot();await restoreBusiness(pg,data);
  assert.equal((await pg.query('select original from sales_example')).rows[0].original.body,'SYNTHETIC & 😀');
  const hash=(await pg.query("select md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text) hash from sales_example x")).rows[0].hash;
  data.tables.sales_example.rows_md5=hash;
  assert.equal((await verifyBusiness(pg,data)).content_match,true);
  await assert.rejects(()=>pg.exec("insert into sales_example values(1,'{}')"));
  await pg.exec("update sales_example set original='{}'");assert.equal((await verifyBusiness(pg,data)).content_match,false);
 }finally{await pg.close();}
});

test('nonempty owner relationships restore with FK validation and RLS denies another owner',async()=>{
 const pg=await PGlite.create();try{
  const owner='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
  const t=snapshot().tables.sales_example;
  const data={...snapshot(),tables:{sales_parent:{...t,columns:[{name:'id',type:'integer',notnull:true},{name:'owner_id',type:'uuid',notnull:true}],constraints:[{name:'parent_identity',kind:'u',definition:'UNIQUE(id,owner_id)'},{name:'owner_fk',kind:'f',definition:'FOREIGN KEY(owner_id) REFERENCES auth.users(id)'}],rows_xml_json:JSON.stringify([{id:1,owner_id:owner},{id:2,owner_id:foreign}])},sales_child:{...t,rls:true,columns:[{name:'id',type:'integer',notnull:true},{name:'parent_id',type:'integer',notnull:true},{name:'owner_id',type:'uuid',notnull:true}],constraints:[{name:'child_parent_fk',kind:'f',definition:'FOREIGN KEY(parent_id,owner_id) REFERENCES sales_parent(id,owner_id)'}],rows_xml_json:JSON.stringify([{id:10,parent_id:1,owner_id:owner},{id:20,parent_id:2,owner_id:foreign}]),grants:[{privilege_type:'SELECT',grantee:'authenticated'}],column_grants:[],policies:[{policyname:'child_read',permissive:'PERMISSIVE',cmd:'SELECT',roles:['authenticated'],qual:'owner_id=auth.uid()',with_check:null}]}}};
  await restoreBusiness(pg,data);
  assert.equal((await verifyBusiness(pg,data)).count_match,true);
  await pg.exec(`set request.jwt.claim.sub='${owner}';set role authenticated;`);
  assert.deepEqual((await pg.query('select id from sales_child')).rows,[{id:10}]);
  await pg.exec('reset role');
  await assert.rejects(()=>pg.exec(`insert into sales_child values(30,2,'${owner}')`));
 }finally{await pg.close();}
});

test('restore hash uses backup time zone rather than the Windows local display offset',async()=>{
 const pg=await PGlite.create();try{
  await pg.exec("set time zone 'Etc/GMT-9'");
  const data=snapshot(),t=data.tables.sales_example;
  data.time_zone='UTC';t.columns=[{name:'created_at',type:'timestamptz',notnull:true}];t.constraints=[];
  t.rows_xml_json='[{"created_at":"2026-10-07T01:02:03.123456+00:00"}]';
  t.rows_md5=(await pg.query('select md5(($1::jsonb)::text) hash',[t.rows_xml_json])).rows[0].hash;
  await restoreBusiness(pg,data);assert.equal((await verifyBusiness(pg,data)).content_match,true);
 }finally{await pg.close();}
});
