-- Synthetic only; every row, user and local claim rolls back. No actual content output.
begin;
select set_config('crm.verify_original_total',(select count(*)::text from public.sales_outlook_mail),true);
select set_config('request.jwt.claim.sub',(select user_id::text from public.sales_access where enabled limit 1),true);
set local role authenticated;
do $tests$
declare mid uuid:='00000000-0000-4000-8000-000000000081';hid uuid:='00000000-0000-4000-8000-000000000082';iid uuid:='00000000-0000-4000-8000-000000000083';m jsonb;p jsonb;r jsonb;receipt jsonb;before_original jsonb;registration jsonb;
begin
 m:=jsonb_build_object('source_key',repeat('7',64),'identity_method','internet_message_id','direction','received','subject','SYNTHETIC triage','body','SYNTHETIC original 😀','sender','synthetic@example.test','recipients','synthetic@example.test','occurred_at','2026-10-06T12:00:00Z','conversation_key',null,'attachments','[]'::jsonb);
 p:=jsonb_build_object('id',mid,'scope_key',repeat('6',64),'source_key',repeat('7',64),'payload_hash',encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),'body_length',length(m->>'body'),'original_json',m::text);
 receipt:=public.sales_ingest_outlook(p);
 select to_jsonb(t)-'excluded'-'triage_revision' into before_original from public.sales_outlook_mail t where id=mid;
 r:=public.sales_triage_outlook(mid,'{"excluded":true,"revision":1}');
 if r->>'triage_revision'<>'2' or r->>'excluded'<>'true' or r<>public.sales_triage_outlook(mid,'{"excluded":true,"revision":1}') then raise exception 'Exclusion retry failed';end if;
 if receipt<>public.sales_ingest_outlook(p) or not (select excluded from public.sales_outlook_mail where id=mid) then raise exception 'Recapture changed exclusion or receipt';end if;
 registration:=jsonb_build_object('id',iid,'customer_name','SYNTHETIC triage rollback','title','SYNTHETIC inquiry','channel','email','received_at',m->>'occurred_at','original_text',m->>'body');
 begin perform public.sales_link_outlook(mid,jsonb_build_object('registration',registration));raise exception 'Excluded linked';exception when check_violation then null;end;
 if exists(select 1 from public.sales_inquiry where id=iid) then raise exception 'Rejected link created inquiry';end if;
 r:=public.sales_triage_outlook(mid,'{"excluded":false,"revision":2}');
 if r->>'triage_revision'<>'3' or r->>'excluded'<>'false' then raise exception 'Restore failed';end if;
 begin perform public.sales_triage_outlook(mid,'{"excluded":true,"revision":1}');raise exception 'Stale decision overwrote restore';exception when serialization_failure then null;end;
 if before_original<>(select to_jsonb(t)-'excluded'-'triage_revision' from public.sales_outlook_mail t where id=mid) then raise exception 'Original changed';end if;
 begin perform public.sales_triage_outlook(mid,'{"excluded":"true","revision":3}');raise exception 'Bad decision accepted';exception when check_violation then null;end;
 begin update public.sales_outlook_mail set triage_revision=99 where id=mid;raise exception 'Revision forged';exception when check_violation then null;end;
 begin update public.sales_outlook_mail set original='{}' where id=mid;raise exception 'Original mutable';exception when insufficient_privilege then null;end;
 if public.sales_link_outlook(mid,jsonb_build_object('registration',registration))<>iid then raise exception 'Restored source did not link';end if;
 begin perform public.sales_triage_outlook(mid,'{"excluded":true,"revision":3}');raise exception 'Linked mail excluded';exception when check_violation then null;end;
 p:=p||jsonb_build_object('id',hid,'source_key',repeat('8',64),'payload_hash',repeat('9',64),'body_length',100001,'original_json',(m||jsonb_build_object('source_key',repeat('8',64),'body',null))::text);
 receipt:=public.sales_ingest_outlook(p);
 perform public.sales_triage_outlook(hid,'{"excluded":true,"revision":1}');
 if receipt<>public.sales_ingest_outlook(p) then raise exception 'Held receipt changed';end if;
 perform public.sales_triage_outlook(hid,'{"excluded":false,"revision":2}');
 if not exists(select 1 from public.sales_outlook_mail where id=hid and state='held' and not excluded and original->'body'='null'::jsonb) then raise exception 'Held policy changed';end if;
 begin perform public.sales_link_outlook(hid,jsonb_build_object('inquiry_id',iid));raise exception 'Held linked';exception when check_violation then null;end;
end $tests$;
reset role;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000084');
insert into public.sales_access(user_id) values('00000000-0000-4000-8000-000000000084');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000084',true);
set local role authenticated;
do $foreign$ begin
 if exists(select 1 from public.sales_outlook_mail) then raise exception 'Foreign mail visible';end if;
 begin perform public.sales_triage_outlook('00000000-0000-4000-8000-000000000081','{"excluded":true,"revision":3}');raise exception 'Foreign triage accepted';exception when insufficient_privilege then null;end;
end $foreign$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000085',true);
set local role authenticated;
do $unapproved$ begin
 begin perform public.sales_triage_outlook('00000000-0000-4000-8000-000000000081','{"excluded":false,"revision":3}');raise exception 'Unapproved triage accepted';exception when insufficient_privilege then null;end;
end $unapproved$;
reset role;
set local role anon;
do $anonymous$ begin
 begin perform public.sales_triage_outlook('00000000-0000-4000-8000-000000000081','{"excluded":false,"revision":3}');raise exception 'Anonymous triage accepted';exception when insufficient_privilege then null;end;
end $anonymous$;
reset role;
rollback;
select 'outlook_triage_rollback_passed' result,
 (select count(*) from public.sales_outlook_mail) real_total,
 (select count(*) from public.sales_outlook_mail where id in ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000082')) remaining_fixtures,
 (select count(*) from auth.users where id='00000000-0000-4000-8000-000000000084') remaining_test_users,
 not (select prosecdef from pg_proc where oid='public.sales_triage_outlook(uuid,jsonb)'::regprocedure) invoker;
