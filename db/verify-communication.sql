-- Read-only post-application verification; NEW sp-sales-crm only.
do $verify$
declare t text; f text;
begin
 foreach t in array array['sales_message','sales_hq_question','sales_hq_review'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||t)::regclass) then raise exception 'RLS missing';end if;
  if not has_table_privilege('authenticated','public.'||t,'SELECT') or not has_table_privilege('authenticated','public.'||t,'INSERT') or has_table_privilege('authenticated','public.'||t,'UPDATE,DELETE') or has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'History grants invalid';end if;
  if exists(select 1 from pg_policies where schemaname='public' and tablename=t and cmd not in ('SELECT','INSERT')) then raise exception 'Unexpected policy';end if;
 end loop;
 foreach f in array array['sales_record_message(uuid,jsonb)','sales_add_hq_question(uuid,jsonb)','sales_review_hq_question(uuid,jsonb)'] loop
  if not has_function_privilege('authenticated','public.'||f,'EXECUTE') or has_function_privilege('anon','public.'||f,'EXECUTE') or (select prosecdef from pg_proc where oid=('public.'||f)::regprocedure) then raise exception 'RPC grants or invoker invalid';end if;
 end loop;
 foreach f in array array['sales_guard_communication()','sales_communication_inquiry_guard()','sales_message_effects()'] loop
  if has_function_privilege('authenticated','public.'||f,'EXECUTE') or has_function_privilege('anon','public.'||f,'EXECUTE') then raise exception 'Trigger helper exposed';end if;
 end loop;
 if (select count(*) from public.sales_access where enabled)<>1 then raise exception 'Allowlist expanded';end if;
 if exists(select 1 from auth.users where id='00000000-0000-4000-8000-000000000069') or exists(select 1 from public.sales_inquiry where id in ('00000000-0000-4000-8000-000000000060','00000000-0000-4000-8000-000000000068')) then raise exception 'Synthetic fixtures remain';end if;
 if exists(select 1 from public.sales_inquiry where status in ('waiting_for_hq','waiting_for_customer') and (waiting_target is null or waiting_since is null)) then raise exception 'Waiting evidence incomplete';end if;
end $verify$;
select 'communication_post_apply_passed' as result;
