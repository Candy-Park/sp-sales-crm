-- Apply only after verify-login-access.sql passes and runtime permission confirmation.
-- Read-only slice: no business INSERT/UPDATE/DELETE and no anon privileges.
begin;
do $guard$
begin
  if not exists(select 1 from auth.users where id='a11803c8-01ef-4563-95bb-c0024541be2c') then
    raise exception 'Expected app user missing; abort';
  end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('sales_access','sales_customer','sales_contact','sales_project','sales_inquiry','sales_action')
      and c.relrowsecurity)<>6 then raise exception 'RLS foundation missing';end if;
end $guard$;
insert into public.sales_access(user_id,enabled) values('a11803c8-01ef-4563-95bb-c0024541be2c',true)
  on conflict(user_id) do update set enabled=true;
grant select on public.sales_access,public.sales_customer,public.sales_contact,
  public.sales_project,public.sales_inquiry,public.sales_action to authenticated;
commit;
select 'login_read_access_enabled' as result;
