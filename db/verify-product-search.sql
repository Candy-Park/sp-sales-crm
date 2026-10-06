-- Read-only post-application check, NEW glscckjmlwvxilzneqdf only.
do $verify$
declare t text;
begin
 foreach t in array array['sales_product','sales_inquiry_product'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing';end if;
  if not has_table_privilege('authenticated','public.'||t,'SELECT') or has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Read grants invalid';end if;
  if has_table_privilege('authenticated','public.'||t,'UPDATE,DELETE') then raise exception 'Excess mutation grants';end if;
 end loop;
 if has_table_privilege('authenticated','public.sales_product','INSERT') or not has_table_privilege('authenticated','public.sales_inquiry_product','INSERT') then raise exception 'Insert grants invalid';end if;
 if (select count(*) from public.sales_product where owner_id='a11803c8-01ef-4563-95bb-c0024541be2c' and batch_id='41000000-0000-4000-8000-000000000001')<>2 then raise exception 'Wrong import count';end if;
 if exists(select 1 from public.sales_product where batch_id='41000000-0000-4000-8000-000000000001' and (spec->>'product_status'<>'Unknown' or spec->'source'->>'latest_revision_verified'<>'false' or spec->'source'->>'file' like '%/%')) then raise exception 'Unknown facts or local path changed';end if;
 if (select prosecdef from pg_proc where oid='public.sales_link_product(uuid,jsonb)'::regprocedure) then raise exception 'Definer RPC';end if;
 if not has_function_privilege('authenticated','public.sales_link_product(uuid,jsonb)','EXECUTE') or has_function_privilege('anon','public.sales_link_product(uuid,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.sales_guard_product_link()','EXECUTE') then raise exception 'RPC grants invalid';end if;
 if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000079') or exists(select 1 from public.sales_customer where name='SYNTHETIC product test') then raise exception 'Rollback fixture remained';end if;
end $verify$;
select 'two_product_search_post_apply_passed' as result;
