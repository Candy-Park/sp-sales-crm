-- Read-only, safe aggregate proof. Retain original 338-row baseline separately.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.sales_access where enabled limit 1),true);
set local role authenticated;
do $verify$ begin
 if (select count(*) from public.sales_outlook_classified)<>(select count(*) from public.sales_outlook_mail) then raise exception 'View lost owned mail';end if;
 if exists(select 1 from public.sales_outlook_classified where owner_id<>auth.uid()) then raise exception 'Foreign view row';end if;
 if exists(select 1 from public.sales_outlook_classified where label is not null and (classification_state<>'confirmed' or category_group<>label->>'category')) then raise exception 'Gold shadowed';end if;
end $verify$;
reset role;
rollback;
select jsonb_build_object(
 'mails',(select count(*) from public.sales_outlook_mail),
 'proposals',(select count(*) from public.sales_outlook_proposal),
 'label_history',(select count(*) from public.sales_outlook_label),
 'confirmed_mails',(select count(*) from public.sales_outlook_classified where label is not null),
 'linked',(select count(*) from public.sales_outlook_mail where state='linked'),
 'held',(select count(*) from public.sales_outlook_mail where state='held'),
 'excluded',(select count(*) from public.sales_outlook_mail where excluded),
 'held_without_body',(select count(*) from public.sales_outlook_mail where state='held' and original->'body'='null'::jsonb),
 'baseline_count',(select count(*) from public.sales_outlook_mail where occurred_at<'2026-10-07T01:27:00+09:00'),
 'baseline_original_sha256',(select encode(extensions.digest(convert_to(string_agg(id::text||source_key||payload_hash||original::text,'' order by id),'UTF8'),'sha256'),'hex') from public.sales_outlook_mail where occurred_at<'2026-10-07T01:27:00+09:00'),
 'baseline_state_sha256',(select encode(extensions.digest(convert_to(string_agg(id::text||state||coalesce(inquiry_id::text,'')||excluded::text||triage_revision::text,'' order by id),'UTF8'),'sha256'),'hex') from public.sales_outlook_mail where occurred_at<'2026-10-07T01:27:00+09:00'),
 'rls',(select bool_and(relrowsecurity) from pg_class where oid in ('public.sales_outlook_proposal'::regclass,'public.sales_outlook_label'::regclass)),
 'immutable',not has_table_privilege('authenticated','public.sales_outlook_label','UPDATE,DELETE') and not has_table_privilege('authenticated','public.sales_outlook_proposal','UPDATE,DELETE'),
 'anon_denied',not has_table_privilege('anon','public.sales_outlook_classified','SELECT') and not has_function_privilege('anon','public.sales_classify_outlook(uuid,jsonb)','EXECUTE'),
 'timestamp_write_denied',not has_column_privilege('authenticated','public.sales_outlook_label','created_at','INSERT') and not has_column_privilege('authenticated','public.sales_outlook_proposal','created_at','INSERT'),
 'invoker',not exists(select 1 from pg_proc where oid in ('public.sales_propose_outlook(jsonb)'::regprocedure,'public.sales_classify_outlook(uuid,jsonb)'::regprocedure,'public.sales_guard_outlook_label()'::regprocedure) and prosecdef),
 'view_invoker',(select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.sales_outlook_classified'::regclass)
) verification;
