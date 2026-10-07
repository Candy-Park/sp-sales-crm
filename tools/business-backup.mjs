// Offline public sales_* restore only. No network, Auth secrets or live DB mutations.
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
const identifier=/^[a-z_][a-z0-9_]*$/;
const quote=value=>{if(!identifier.test(value))throw new Error('Unsupported identifier');return '"'+value+'"';};
const relation=name=>'public.'+quote(name);
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const decodeXml=text=>text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi,(all,v)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v]??String.fromCodePoint(v.startsWith('#x')?parseInt(v.slice(2),16):Number(v.slice(1)))));
const role=name=>name.toUpperCase()==='PUBLIC'?'PUBLIC':quote(name);
function validate(snapshot){
 if(snapshot?.version!==1||snapshot.project!=='glscckjmlwvxilzneqdf'||!snapshot.tables||!Object.keys(snapshot.tables).length)throw new Error('Wrong backup project or format');
 for(const [name,t] of Object.entries(snapshot.tables)){
  if(!/^sales_[a-z0-9_]+$/.test(name)||!Array.isArray(t.columns)||!t.columns.length)throw new Error('Business relation required');
  for(const c of t.columns)quote(c.name);
  if(!Array.isArray(JSON.parse(decodeXml(t.rows_xml_json))))throw new Error('Invalid table rows');
 }
}
function aclGrants(acl,target,kind){
 const codes={r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN',X:'EXECUTE'};
 const sql=[];
 for(const entry of acl??[]){const m=/^([^=]*)=([^/]*)\//.exec(entry);if(!m)throw new Error('Unsupported ACL');const who=role(m[1]||'PUBLIC');
  for(const p of m[2].replaceAll('*','')){if(!codes[p])throw new Error('Unsupported privilege');sql.push(`GRANT ${codes[p]} ON ${kind} ${target} TO ${who}`);}
 }
 return sql;
}
export async function restoreBusiness(pg,snapshot){
 validate(snapshot);
 await pg.query("select set_config('TimeZone',$1,false)",[snapshot.time_zone??'UTC']);
 const exists=await pg.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind in ('r','v')");
 if(exists.rows[0].n)throw new Error('Restore requires a fresh isolated database');
 await pg.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA public,auth TO authenticated,anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;`);
 if((await pg.query("select exists(select 1 from pg_namespace where nspname='extensions') present")).rows[0].present)await pg.exec('GRANT USAGE ON SCHEMA extensions TO authenticated,anon');
 const enums=new Map();for(const e of snapshot.enums??[]){if(!enums.has(e.name))enums.set(e.name,[]);enums.get(e.name).push(e);}
 for(const [name,labels] of enums)await pg.exec(`CREATE TYPE ${relation(name)} AS ENUM (${labels.sort((a,b)=>a.sort-b.sort).map(e=>literal(e.label)).join(',')})`);
 for(const [name,t] of Object.entries(snapshot.tables))await pg.exec(`CREATE TABLE ${relation(name)} (${t.columns.map(c=>quote(c.name)+' '+c.type+(c.default?' DEFAULT '+c.default:'')+(c.notnull?' NOT NULL':'')).join(',')})`);
 // Minimal owner-ID compatibility table; no Auth email/password/session is restored.
 for(const [name,t] of Object.entries(snapshot.tables)){
  const owner=t.columns.find(c=>['owner_id','user_id'].includes(c.name));
  if(owner)await pg.exec(`INSERT INTO auth.users SELECT DISTINCT ${quote(owner.name)} FROM jsonb_populate_recordset(null::${relation(name)},${literal(decodeXml(t.rows_xml_json))}::jsonb) WHERE ${quote(owner.name)} IS NOT NULL ON CONFLICT DO NOTHING`);
 }
 for(const [name,t] of Object.entries(snapshot.tables))for(const k of t.constraints.filter(c=>c.kind!=='f'))await pg.exec(`ALTER TABLE ${relation(name)} ADD CONSTRAINT ${quote(k.name)} ${k.definition}`);
 for(const [name,t] of Object.entries(snapshot.tables))await pg.exec(`INSERT INTO ${relation(name)} SELECT * FROM jsonb_populate_recordset(null::${relation(name)},${literal(decodeXml(t.rows_xml_json))}::jsonb)`);
 for(const [name,t] of Object.entries(snapshot.tables))for(const k of t.constraints.filter(c=>c.kind==='f'))await pg.exec(`ALTER TABLE ${relation(name)} ADD CONSTRAINT ${quote(k.name)} ${k.definition}`);
 for(const f of snapshot.functions??[])await pg.exec(f.definition);
 for(const [name,t] of Object.entries(snapshot.tables)){
  for(const index of t.indexes??[])await pg.exec(index);
  for(const trigger of t.triggers??[])await pg.exec(trigger);
  for(const p of t.policies??[])await pg.exec(`CREATE POLICY ${quote(p.policyname)} ON ${relation(name)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(role).join(',')}${p.qual?' USING ('+p.qual+')':''}${p.with_check?' WITH CHECK ('+p.with_check+')':''}`);
  if(t.rls)await pg.exec(`ALTER TABLE ${relation(name)} ENABLE ROW LEVEL SECURITY`);
  if(t.force_rls)await pg.exec(`ALTER TABLE ${relation(name)} FORCE ROW LEVEL SECURITY`);
  for(const g of t.grants??[])if(g.grantee!=='postgres')await pg.exec(`GRANT ${g.privilege_type} ON TABLE ${relation(name)} TO ${role(g.grantee)}`);
  for(const g of t.column_grants??[])if(g.grantee!=='postgres')await pg.exec(`GRANT ${g.privilege_type} (${quote(g.column_name)}) ON TABLE ${relation(name)} TO ${role(g.grantee)}`);
 }
 for(const f of snapshot.functions??[]){const target=f.identity.startsWith('public.')?f.identity:'public.'+f.identity;await pg.exec(`REVOKE ALL ON FUNCTION ${target} FROM PUBLIC`);for(const sql of aclGrants(f.acl??['=X/postgres'],target,'FUNCTION'))await pg.exec(sql);}
 for(const v of snapshot.views??[]){if(!/^sales_[a-z0-9_]+$/.test(v.name))throw new Error('Unsupported view');const options=v.options??[];if(options.some(o=>!/^security_(invoker|barrier)=(true|false)$/.test(o)))throw new Error('Unsupported view option');await pg.exec(`CREATE VIEW ${relation(v.name)}${options.length?' WITH ('+options.join(',')+')':''} AS ${v.definition}`);for(const sql of aclGrants(v.acl,relation(v.name),'TABLE'))await pg.exec(sql);}
}
export async function verifyBusiness(pg,snapshot){
 validate(snapshot);await pg.query("select set_config('TimeZone',$1,false)",[snapshot.time_zone??'UTC']);const tables={};
 for(const [name,t] of Object.entries(snapshot.tables)){
  const count=JSON.parse(decodeXml(t.rows_xml_json)).length;
  const r=(await pg.query(`select count(*)::int count, ${t.rows_sha?"encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text,'UTF8'),'sha256'),'hex')":"md5(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]'::jsonb)::text)"} hash from ${relation(name)} x`)).rows[0];
  tables[name]={expected:count,restored:r.count,count_match:r.count===count,content_match:(t.rows_sha??t.rows_md5)==null?false:r.hash===(t.rows_sha??t.rows_md5)};
 }
 return {scope:'Full public sales_* business data/schema; Auth/Storage/managed services excluded',isolated:true,auth_compatibility_stub:true,tables,count_match:Object.values(tables).every(t=>t.count_match),content_match:Object.values(tables).every(t=>t.content_match)};
}
async function main(){
 const [input,destination,report]=process.argv.slice(2);if(!input||!destination||!report)throw new Error('Input, fresh local destination and report required');
 const roots=['D:/AI/projects/sp-sales-crm/sources','D:/AI/projects/sp-sales-crm/scratch','D:/AI/projects/sp-sales-crm/outputs'];
 for(const [index,path] of [input,destination,report].entries()){const rel=relative(resolve(roots[index]),resolve(path));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Private project path required');}
 try{await access(destination);throw new Error('Destination already exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(destination,{recursive:true});
 const snapshot=JSON.parse(await readFile(input,'utf8'));const pg=await PGlite.create(destination,{extensions:{pgcrypto}});
 try{
  await pg.exec('CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;');
  await restoreBusiness(pg,snapshot);const result=await verifyBusiness(pg,snapshot);
  await writeFile(report,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({tables:Object.keys(result.tables).length,count_match:result.count_match,content_match:result.content_match,isolated:true}));
  if(!result.count_match||!result.content_match)process.exitCode=1;
 }finally{await pg.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('Business restore failed: '+(error.code??'validation'));process.exitCode=1;});
