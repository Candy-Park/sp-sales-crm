-- Read-only structural assertions; contains no real user/customer data.
do $check$
declare
    names text[] := array['sales_access','sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'];
    n integer;
begin
    select count(*) into n from pg_catalog.pg_tables
      where schemaname='public' and tablename=any(names);
    if n <> 6 then raise exception 'Expected 6 basic tables, got %', n; end if;
    select count(*) into n from pg_catalog.pg_class c
      join pg_catalog.pg_namespace s on s.oid=c.relnamespace
      where s.nspname='public' and c.relname=any(names) and c.relrowsecurity;
    if n <> 6 then raise exception 'Every basic table must have RLS enabled'; end if;
    select count(*) into n from information_schema.role_table_grants
      where table_schema='public' and table_name=any(names) and grantee in ('anon','authenticated','PUBLIC');
    if n <> 0 then raise exception 'App grants must remain closed during foundation setup'; end if;
    select count(*) into n from pg_catalog.pg_policies
      where schemaname='public' and tablename=any(names);
    if n <> 16 then raise exception 'Expected 16 initial policies, got %', n; end if;
end
$check$;
select 'basic_schema_structure_passed' as result;
