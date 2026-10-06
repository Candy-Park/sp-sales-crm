-- Read-only post-apply assertions. No data or permission changes.
do $verify$
declare t text; n integer;
begin
  foreach t in array array['sales_access','sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    if not has_table_privilege('authenticated','public.'||t,'SELECT') then raise exception 'Missing authenticated SELECT: %',t;end if;
    if has_table_privilege('anon','public.'||t,'SELECT') then raise exception 'Anonymous SELECT exposed: %',t;end if;
    if has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE')
      or has_table_privilege('authenticated','public.'||t,'DELETE') then raise exception 'Unexpected client write permission: %',t;end if;
    if not (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=t) then
      raise exception 'RLS missing: %',t;end if;
  end loop;
  if (select count(*) from public.sales_access where enabled)<>1 or not exists(
    select 1 from public.sales_access where user_id='a11803c8-01ef-4563-95bb-c0024541be2c' and enabled
  ) then raise exception 'Unexpected enabled allowlist';end if;
  if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000099') then raise exception 'Synthetic Auth fixture remains';end if;
  foreach t in array array['sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    execute format('select count(*) from public.%I where id in (%L,%L)',t,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002') into n;
    if n<>0 then raise exception 'Synthetic business fixture remains: %',t;end if;
  end loop;
end $verify$;
select 'login_read_post_apply_passed' as result;
