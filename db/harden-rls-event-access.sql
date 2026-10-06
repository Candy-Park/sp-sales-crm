-- NEW sp-sales-crm only. Restrict client calls to the administrative event function.
-- Keep ensure_rls enabled and preserve its SECURITY DEFINER implementation.
begin;
do $guard$ begin
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rls_auto_enable' and p.pronargs=0
      and p.prorettype='event_trigger'::regtype and p.prosecdef) then
    raise exception 'Expected administrative event function missing';
  end if;
  if not exists(select 1 from pg_event_trigger where evtname='ensure_rls'
    and evtfoid='public.rls_auto_enable()'::regprocedure and evtenabled='O') then
    raise exception 'Expected active RLS event trigger missing';
  end if;
  if to_regclass('public.sales_rls_security_probe') is not null then
    raise exception 'Security probe name already in use';
  end if;
end $guard$;
revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
savepoint rls_probe;
create table public.sales_rls_security_probe(id integer);
do $verify$ begin
  if not (select relrowsecurity from pg_class where oid='public.sales_rls_security_probe'::regclass) then
    raise exception 'Automatic RLS protection failed';
  end if;
end $verify$;
rollback to savepoint rls_probe;
do $verify$ begin
  if has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
    or has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE') then
    raise exception 'Administrative event function still client executable';
  end if;
  if to_regclass('public.sales_rls_security_probe') is not null then
    raise exception 'Security probe persisted';
  end if;
end $verify$;
commit;
select 'rls_event_access_hardened' as result;
