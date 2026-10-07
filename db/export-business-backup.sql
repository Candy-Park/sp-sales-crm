-- Read-only snapshot of NEW glscckjmlwvxilzneqdf public sales_* business schema.
-- Download the result as CSV to private D sources. Never log rows/mail bodies.
-- Auth credentials, Supabase managed schemas, Storage and local originals excluded.
with tables as (
 select c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and left(c.relname,6)='sales_'
), table_snapshot as (
 select t.relname,jsonb_build_object(
  'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity,
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'kind',k.contype,'definition',pg_get_constraintdef(k.oid))), '[]') from pg_constraint k where k.conrelid=t.oid),
  'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid)),'[]') from pg_index i where i.indrelid=t.oid and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid)),
  'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(g.oid)),'[]') from pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal),
  'policies',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from pg_policies p where p.schemaname='public' and p.tablename=t.relname),
  'grants',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from information_schema.role_table_grants g where g.table_schema='public' and g.table_name=t.relname),
  'column_grants',(select coalesce(jsonb_agg(to_jsonb(g)),'[]') from information_schema.role_column_grants g where g.table_schema='public' and g.table_name=t.relname),
  'rows_xml_json',(xpath('/table/row/data/text()',query_to_xml(format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb)::text data from public.%I x',t.relname),false,false,'')))[1]::text,
  'rows_sha',(xpath('/table/row/hash/text()',query_to_xml(format('select encode(extensions.digest(convert_to(coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text), ''[]''::jsonb)::text,''UTF8''),''sha256''),''hex'') hash from public.%I x',t.relname),false,false,'')))[1]::text
 ) value from tables t
)
select jsonb_build_object(
 'version',1,'project','glscckjmlwvxilzneqdf','captured_at',statement_timestamp(),'postgres_version',version(),'time_zone',current_setting('TimeZone'),
 'scope','public sales_* business schema/data; auth credentials and managed services excluded',
 'tables',(select jsonb_object_agg(relname,value) from table_snapshot),
 'functions',(select coalesce(jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'identity',p.oid::regprocedure::text,'acl',p.proacl)),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and left(p.proname,6)='sales_' and p.prokind='f'),
 'views',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'definition',pg_get_viewdef(c.oid,true),'options',c.reloptions,'acl',c.relacl)),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v' and left(c.relname,6)='sales_'),
 'enums',(select coalesce(jsonb_agg(jsonb_build_object('name',t.typname,'label',e.enumlabel,'sort',e.enumsortorder)),'[]') from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid where n.nspname='public' and left(t.typname,6)='sales_')
) business_backup;
