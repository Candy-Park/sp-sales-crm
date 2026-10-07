-- NEW glscckjmlwvxilzneqdf only. Read-only verification after actual collection.
-- Local role/claim settings roll back. No original content or account IDs in results.
begin;
select set_config('crm.verify_mail_total',(select count(*)::text from public.sales_outlook_mail),true);
select set_config('request.jwt.claim.sub',(select user_id::text from public.sales_access where enabled limit 1),true);
set local role authenticated;
do $owner$
begin
 if (select count(*) from public.sales_outlook_mail)<>current_setting('crm.verify_mail_total')::integer then raise exception 'Owned collection unavailable';end if;
 if exists(select 1 from public.sales_outlook_mail where owner_id<>auth.uid()) then raise exception 'Foreign mail visible';end if;
end $owner$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000076',true);
set local role authenticated;
do $unapproved$
begin
 if exists(select 1 from public.sales_outlook_mail) then raise exception 'Unapproved sees actual mail';end if;
 begin perform public.sales_ingest_outlook('{}');raise exception 'Unapproved ingest allowed';exception when insufficient_privilege then null;end;
 begin perform public.sales_link_outlook('00000000-0000-4000-8000-000000000071','{}');raise exception 'Unapproved link allowed';exception when insufficient_privilege then null;end;
end $unapproved$;
reset role;
set local role anon;
do $anonymous$
begin
 begin perform count(*) from public.sales_outlook_mail;raise exception 'Anonymous actual read allowed';exception when insufficient_privilege then null;end;
 begin perform public.sales_ingest_outlook('{}');raise exception 'Anonymous ingest allowed';exception when insufficient_privilege then null;end;
 begin perform public.sales_link_outlook('00000000-0000-4000-8000-000000000071','{}');raise exception 'Anonymous link allowed';exception when insufficient_privilege then null;end;
end $anonymous$;
reset role;
rollback;
select 'outlook_actual_access_passed' result,
 (select count(*) from public.sales_outlook_mail) total,
 (select count(*) from public.sales_access where enabled) enabled_accounts,
 (select relrowsecurity from pg_class where oid='public.sales_outlook_mail'::regclass) rls,
 not (select prosecdef from pg_proc where oid='public.sales_ingest_outlook(jsonb)'::regprocedure) ingest_invoker,
 not (select prosecdef from pg_proc where oid='public.sales_link_outlook(uuid,jsonb)'::regprocedure) link_invoker,
 not has_table_privilege('authenticated','public.sales_outlook_mail','DELETE') delete_denied,
 not has_column_privilege('authenticated','public.sales_outlook_mail','original','UPDATE') original_update_denied;
