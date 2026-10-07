-- Synthetic fixtures only, transaction fully rolls back. No actual originals output.
begin;
select set_config('request.jwt.claim.sub',(select user_id::text from public.sales_access where enabled limit 1),true);
set local role authenticated;
do $tests$
declare mid uuid:='00000000-0000-4000-8000-000000000091';hid uuid:='00000000-0000-4000-8000-000000000092';m jsonb;p jsonb;q jsonb;r jsonb;a jsonb;b jsonb;before_original jsonb;
begin
 m:=jsonb_build_object('source_key',repeat('d',64),'identity_method','internet_message_id','direction','received','subject','SYNTHETIC classification','body','SYNTHETIC original 😀','sender','synthetic@example.test','recipients','synthetic@example.test','occurred_at','2026-10-06T12:00:00Z','conversation_key',null,'attachments','[]'::jsonb);
 p:=jsonb_build_object('id',mid,'scope_key',repeat('c',64),'source_key',repeat('d',64),'payload_hash',encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),'body_length',length(m->>'body'),'original_json',m::text);
 perform public.sales_ingest_outlook(p);
 select to_jsonb(t) into before_original from public.sales_outlook_mail t where id=mid;
 q:=jsonb_build_object('id','00000000-0000-4000-8000-000000000093','scope_key',repeat('c',64),'source_key',repeat('d',64),'role','HQ 후보','category','HQ 업무 후보','confidence','중간','evidence','["SYNTHETIC domain signal"]'::jsonb,'customer_ref',null,'rule_version','synthetic:v1');
 r:=public.sales_propose_outlook(q);
 if r<>public.sales_propose_outlook(q) or (select count(*) from public.sales_outlook_proposal where mail_id=mid)<>1 then raise exception 'Proposal retry duplicated';end if;
 begin perform public.sales_propose_outlook(q||'{"category":"판단 보류"}');raise exception 'Proposal payload overwritten';exception when serialization_failure then null;end;
 if not exists(select 1 from public.sales_outlook_classified where id=mid and classification_state='proposed' and category_group='HQ 업무' and label is null) then raise exception 'Candidate shown as confirmed';end if;
 a:='{"id":"00000000-0000-4000-8000-000000000094","revision":0,"role":"미확인","category":"스팸"}';
 r:=public.sales_classify_outlook(mid,a);
 if r<>public.sales_classify_outlook(mid,a) or r->>'revision'<>'1' then raise exception 'Lost acknowledgement retry failed';end if;
 b:='{"id":"00000000-0000-4000-8000-000000000095","revision":1,"role":"HQ","category":"HQ 업무"}';
 perform public.sales_classify_outlook(mid,b);
 perform public.sales_classify_outlook(mid,a);
 if not exists(select 1 from public.sales_outlook_classified where id=mid and classification_state='confirmed' and classification_revision=2 and category_group='HQ 업무' and label->>'role'='HQ') then raise exception 'Old retry restored stale label';end if;
 begin perform public.sales_classify_outlook(mid,a||'{"id":"00000000-0000-4000-8000-000000000096"}');raise exception 'Stale classification accepted';exception when serialization_failure then null;end;
 begin perform public.sales_classify_outlook(mid,a||'{"category":"HQ 업무"}');raise exception 'Same ID different decision accepted';exception when serialization_failure then null;end;
 q:=q||'{"id":"00000000-0000-4000-8000-000000000097","category":"판단 보류","rule_version":"synthetic:v2"}';
 perform public.sales_propose_outlook(q);
 if (select category_group from public.sales_outlook_classified where id=mid)<>'HQ 업무' then raise exception 'Proposal overwrote gold';end if;
 if before_original<>(select to_jsonb(t) from public.sales_outlook_mail t where id=mid) then raise exception 'Original/link/exclusion changed';end if;
 if (select count(*) from public.sales_outlook_label where mail_id=mid)<>2 then raise exception 'History missing';end if;
 begin update public.sales_outlook_label set category='스팸' where mail_id=mid;raise exception 'Label mutable';exception when insufficient_privilege then null;end;
 begin delete from public.sales_outlook_proposal where mail_id=mid;raise exception 'Proposal deletable';exception when insufficient_privilege then null;end;
 begin insert into public.sales_outlook_label(id,mail_id,owner_id,revision,role,category) values('00000000-0000-4000-8000-000000000098',mid,auth.uid(),99,'HQ','HQ 업무');raise exception 'Direct revision forged';exception when serialization_failure then null;end;
 begin perform public.sales_classify_outlook(mid,'{"id":"00000000-0000-4000-8000-000000000098","revision":2,"role":"HQ","category":"invented"}');raise exception 'Invalid category accepted';exception when check_violation then null;end;
 p:=p||jsonb_build_object('id',hid,'source_key',repeat('e',64),'payload_hash',repeat('f',64),'body_length',100001,'original_json',(m||jsonb_build_object('source_key',repeat('e',64),'body',null))::text);
 perform public.sales_ingest_outlook(p);
 perform public.sales_classify_outlook(hid,a||'{"id":"00000000-0000-4000-8000-000000000099"}');
 if not exists(select 1 from public.sales_outlook_mail where id=hid and state='held' and not excluded and original->'body'='null'::jsonb) then raise exception 'Held policy changed';end if;
end $tests$;
reset role;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000090');
insert into public.sales_access(user_id) values('00000000-0000-4000-8000-000000000090');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000090',true);
set local role authenticated;
do $foreign$ begin
 if exists(select 1 from public.sales_outlook_classified) or exists(select 1 from public.sales_outlook_label) or exists(select 1 from public.sales_outlook_proposal) then raise exception 'Foreign data visible';end if;
 begin perform public.sales_classify_outlook('00000000-0000-4000-8000-000000000091','{"id":"00000000-0000-4000-8000-000000000098","revision":2,"role":"HQ","category":"HQ 업무"}');raise exception 'Foreign classification accepted';exception when insufficient_privilege then null;end;
 begin perform public.sales_propose_outlook('{"id":"00000000-0000-4000-8000-000000000098","scope_key":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","source_key":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","role":"HQ 후보","category":"HQ 업무 후보","confidence":"중간","evidence":[],"customer_ref":null,"rule_version":"v1"}');raise exception 'Foreign proposal accepted';exception when insufficient_privilege then null;end;
 begin insert into public.sales_outlook_label(id,mail_id,owner_id,revision,role,category) values('00000000-0000-4000-8000-000000000098','00000000-0000-4000-8000-000000000091',auth.uid(),3,'HQ','HQ 업무');raise exception 'Foreign insert accepted';exception when insufficient_privilege then null;end;
end $foreign$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000089',true);
set local role authenticated;
do $unapproved$ begin
 if exists(select 1 from public.sales_outlook_classified) then raise exception 'Unapproved view visible';end if;
 begin perform public.sales_classify_outlook('00000000-0000-4000-8000-000000000091','{}');raise exception 'Unapproved accepted';exception when insufficient_privilege then null;end;
end $unapproved$;
reset role;
set local role anon;
do $anon$ begin
 begin perform 1 from public.sales_outlook_classified;raise exception 'Anonymous view visible';exception when insufficient_privilege then null;end;
 begin perform public.sales_classify_outlook('00000000-0000-4000-8000-000000000091','{}');raise exception 'Anonymous accepted';exception when insufficient_privilege then null;end;
end $anon$;
reset role;
rollback;
select 'outlook_classification_rollback_passed' result,
 (select count(*) from public.sales_outlook_mail) real_total,
 (select count(*) from public.sales_outlook_mail where id in ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000092')) remaining_fixtures,
 (select count(*) from auth.users where id='00000000-0000-4000-8000-000000000090') remaining_test_users,
 not exists(select 1 from pg_proc where oid in ('public.sales_propose_outlook(jsonb)'::regprocedure,'public.sales_classify_outlook(uuid,jsonb)'::regprocedure,'public.sales_guard_outlook_label()'::regprocedure) and prosecdef) invoker,
 (select 'security_invoker=true'=any(reloptions) from pg_class where oid='public.sales_outlook_classified'::regclass) view_invoker;
