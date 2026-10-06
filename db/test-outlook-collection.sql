-- Synthetic cases only; ALL fixtures, users and grants roll back.
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000079');
insert into public.sales_access(user_id) values('00000000-0000-4000-8000-000000000079');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000079',true);
do $foreign$
declare m jsonb; p jsonb;
begin
 m:=jsonb_build_object('source_key',repeat('d',64),'identity_method','internet_message_id','direction','received','subject','SYNTHETIC foreign','body','foreign source','sender','synthetic@example.test','recipients','synthetic@example.test','occurred_at','2026-10-06T12:00:00Z','conversation_key',null,'attachments','[]'::jsonb);
 p:=jsonb_build_object('id','00000000-0000-4000-8000-000000000078','scope_key',repeat('a',64),'source_key',repeat('d',64),'payload_hash',encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),'body_length',length(m->>'body'),'original_json',m::text);
 perform public.sales_ingest_outlook(p);
end $foreign$;
select set_config('request.jwt.claim.sub','a11803c8-01ef-4563-95bb-c0024541be2c',true);
do $tests$
declare m jsonb;p jsonb;held jsonb;r jsonb;receipt jsonb;iid uuid:='00000000-0000-4000-8000-000000000074';mid uuid:='00000000-0000-4000-8000-000000000071';hid uuid:='00000000-0000-4000-8000-000000000072';rev integer;
begin
 if exists(select 1 from public.sales_outlook_mail where id='00000000-0000-4000-8000-000000000078') then raise exception 'Foreign mail visible';end if;
 if has_table_privilege('anon','public.sales_outlook_mail','SELECT') or has_table_privilege('authenticated','public.sales_outlook_mail','DELETE') then raise exception 'Unexpected grants';end if;
 if not (select relrowsecurity from pg_class where oid='public.sales_outlook_mail'::regclass) or (select prosecdef from pg_proc where oid='public.sales_ingest_outlook(jsonb)'::regprocedure) then raise exception 'RLS/invoker missing';end if;
 m:=jsonb_build_object('source_key',repeat('b',64),'identity_method','internet_message_id','direction','received','subject','SYNTHETIC source','body','SYNTHETIC original','sender','synthetic@example.test','recipients','synthetic@example.test','occurred_at','2026-10-06T12:00:00Z','conversation_key',null,'attachments','[]'::jsonb);
 p:=jsonb_build_object('id',mid,'scope_key',repeat('a',64),'source_key',repeat('b',64),'payload_hash',encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),'body_length',length(m->>'body'),'original_json',m::text);
 receipt:=public.sales_ingest_outlook(p);
 if receipt<>public.sales_ingest_outlook(p) or receipt<>public.sales_ingest_outlook(p||jsonb_build_object('id',gen_random_uuid())) then raise exception 'Lost response retry differs';end if;
 if (select count(*) from public.sales_outlook_mail where source_key=repeat('b',64))<>1 then raise exception 'Duplicate imported';end if;
 begin perform public.sales_ingest_outlook(p||jsonb_build_object('body_length',1));raise exception 'Conflicting original accepted';exception when serialization_failure then null;end;
 begin perform public.sales_ingest_outlook(p||jsonb_build_object('payload_hash',repeat('e',64)));raise exception 'Bad hash accepted';exception when check_violation then null;end;
 begin update public.sales_outlook_mail set original='{}' where id=mid;raise exception 'Original update allowed';exception when insufficient_privilege then null;end;
 begin delete from public.sales_outlook_mail where id=mid;raise exception 'Original delete allowed';exception when insufficient_privilege then null;end;
 held:=p||jsonb_build_object('id',hid,'source_key',repeat('c',64),'payload_hash',repeat('f',64),'body_length',100001,'original_json',(m||jsonb_build_object('source_key',repeat('c',64),'body',null))::text);
 perform public.sales_ingest_outlook(held);
 if not exists(select 1 from public.sales_outlook_mail where id=hid and state='held' and original->'body'='null'::jsonb) then raise exception 'Held original transmitted';end if;
 r:=jsonb_build_object('id',iid,'customer_name','SYNTHETIC Outlook rollback','title','SYNTHETIC email inquiry','channel','email','received_at',m->>'occurred_at','original_text',m->>'body');
 begin perform public.sales_link_outlook(mid,jsonb_build_object('registration',r||jsonb_build_object('original_text','changed')));raise exception 'Inquiry source changed';exception when check_violation then null;end;
 if public.sales_link_outlook(mid,jsonb_build_object('registration',r))<>iid or public.sales_link_outlook(mid,jsonb_build_object('registration',r))<>iid then raise exception 'New link retry failed';end if;
 if not exists(select 1 from public.sales_inquiry where id=iid and original_text=m->>'body' and status='new') then raise exception 'New inquiry source/state lost';end if;
 begin perform public.sales_link_outlook(mid,jsonb_build_object('registration',r||jsonb_build_object('title','changed')));raise exception 'Changed retry accepted';exception when serialization_failure then null;end;
 begin perform public.sales_link_outlook(hid,jsonb_build_object('inquiry_id',iid));raise exception 'Held linked';exception when check_violation then null;end;
 begin perform public.sales_link_outlook('00000000-0000-4000-8000-000000000078',jsonb_build_object('inquiry_id',iid));raise exception 'Foreign linked';exception when insufficient_privilege then null;end;
 m:=m||jsonb_build_object('source_key',repeat('e',64),'direction','sent');
 p:=p||jsonb_build_object('id','00000000-0000-4000-8000-000000000073','source_key',repeat('e',64),'payload_hash',encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),'original_json',m::text);
 perform public.sales_ingest_outlook(p);
 perform public.sales_link_outlook('00000000-0000-4000-8000-000000000073',jsonb_build_object('inquiry_id',iid));
 if (select status from public.sales_inquiry where id=iid)<>'new' or exists(select 1 from public.sales_message where inquiry_id=iid) then raise exception 'Imported sent mail auto changed workflow';end if;
 select revision into rev from public.sales_inquiry where id=iid;
 perform public.sales_close_inquiry(iid,jsonb_build_object('revision',rev,'resolved',true));
 if public.sales_link_outlook(mid,jsonb_build_object('registration',r))<>iid or (select count(*) from public.sales_outlook_mail where inquiry_id=iid)<>2 then raise exception 'Closed linked history lost';end if;
 m:=m||jsonb_build_object('source_key',repeat('f',64));
 p:=p||jsonb_build_object('id','00000000-0000-4000-8000-000000000075','source_key',repeat('f',64),'payload_hash',encode(extensions.digest(convert_to(m::text,'UTF8'),'sha256'),'hex'),'original_json',m::text);
 perform public.sales_ingest_outlook(p);
 begin perform public.sales_link_outlook('00000000-0000-4000-8000-000000000075',jsonb_build_object('inquiry_id',iid));raise exception 'Closed link accepted';exception when check_violation then null;end;
end $tests$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000076',true);
do $denied$ begin
 if exists(select 1 from public.sales_outlook_mail) then raise exception 'Unapproved sees mail';end if;
 begin perform public.sales_ingest_outlook('{}');raise exception 'Unapproved ingested';exception when insufficient_privilege then null;end;
end $denied$;
reset role;
set local role anon;
do $anonymous$ begin
 begin perform count(*) from public.sales_outlook_mail;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform public.sales_ingest_outlook('{}');raise exception 'Anonymous ingest allowed';exception when insufficient_privilege then null;end;
end $anonymous$;
reset role;
rollback;
select 'outlook_rollback_passed' result,
 (select count(*) from public.sales_access where enabled) enabled_accounts,
 (select count(*) from public.sales_outlook_mail where id in ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000078')) remaining_fixtures,
 (select count(*) from auth.users where id='00000000-0000-4000-8000-000000000079') remaining_test_users;
