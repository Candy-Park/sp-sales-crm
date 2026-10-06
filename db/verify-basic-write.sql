-- Read-only post-apply checks, NEW sp-sales-crm only.
do $verify$
declare t text; f text; n integer;
begin
  foreach t in array array['sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    if not has_table_privilege('authenticated','public.'||t,'SELECT') or not has_table_privilege('authenticated','public.'||t,'INSERT') or not has_table_privilege('authenticated','public.'||t,'UPDATE') then raise exception 'Missing required permission: %',t;end if;
    if has_table_privilege('authenticated','public.'||t,'DELETE') or has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Excess table permission: %',t;end if;
    if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS disabled: %',t;end if;
    if not exists(select 1 from pg_trigger where tgrelid=('public.'||t)::regclass and not tgisinternal and tgenabled='O' and tgname=t||'_write_guard') then raise exception 'Missing write guard: %',t;end if;
  end loop;
  if has_table_privilege('authenticated','public.sales_access','INSERT,UPDATE,DELETE') then raise exception 'Allowlist writable';end if;
  select count(*) into n from public.sales_access where enabled;
  if n<>1 or not exists(select 1 from public.sales_access where user_id='a11803c8-01ef-4563-95bb-c0024541be2c' and enabled) then raise exception 'Unexpected allowed users';end if;
  foreach f in array array['sales_register_inquiry(jsonb)','sales_add_action(uuid,jsonb)','sales_edit_action(uuid,jsonb)','sales_edit_inquiry(uuid,jsonb)','sales_close_inquiry(uuid,jsonb)','sales_edit_party(jsonb)'] loop
    if not has_function_privilege('authenticated','public.'||f,'EXECUTE') or has_function_privilege('anon','public.'||f,'EXECUTE') then raise exception 'RPC permission: %',f;end if;
    if (select prosecdef from pg_proc where oid=('public.'||f)::regprocedure) then raise exception 'Definer RPC: %',f;end if;
  end loop;
  if exists(select 1 from public.sales_customer where name like 'SYNTHETIC%') then raise exception 'Synthetic fixture present';end if;
  if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000099') then raise exception 'Synthetic Auth user present';end if;
end $verify$;
select 'basic_write_post_apply_passed' as result;
