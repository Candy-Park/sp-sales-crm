-- Appended inside a transaction by tools/prepare-write-validation.mjs.
-- Synthetic-only fixtures; never commit this script.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000099');
insert into public.sales_customer(id,owner_id,name) values
 ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000099','SYNTHETIC foreign customer');
insert into public.sales_inquiry(id,owner_id,customer_id,title,channel,received_at,original_text)
 values('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000090','SYNTHETIC foreign inquiry','manual',now(),'SYNTHETIC foreign source');
set local role authenticated;
select set_config('request.jwt.claim.sub','a11803c8-01ef-4563-95bb-c0024541be2c',true);
select set_config('request.jwt.claims','{"sub":"a11803c8-01ef-4563-95bb-c0024541be2c","role":"authenticated"}',true);
do $tests$
declare
  iid uuid:='00000000-0000-4000-8000-000000000081';
  aid uuid:='00000000-0000-4000-8000-000000000082';
  optional_id uuid:='00000000-0000-4000-8000-000000000083';
  cid uuid; n integer; rev integer; stamp timestamptz;
  draft jsonb:=jsonb_build_object('id','00000000-0000-4000-8000-000000000081','customer_name','SYNTHETIC write customer',
    'contact_name','SYNTHETIC contact','project_name','SYNTHETIC project','title','SYNTHETIC inquiry','channel','manual',
    'received_at','2026-10-06T12:00:00+09:00','original_text','SYNTHETIC source 100G / 10 km','next_action','SYNTHETIC next');
  task jsonb:=jsonb_build_object('id','00000000-0000-4000-8000-000000000082','kind','hq_inquiry',
    'description','SYNTHETIC mandatory action','due_date','2026-10-06','mandatory',true,'waiting_target',null,'waiting_since',null);
begin
  if public.sales_register_inquiry(draft)<>iid then raise exception 'Registration result';end if;
  if public.sales_register_inquiry(draft)<>iid then raise exception 'Retry failed';end if;
  if (select count(*) from public.sales_customer where name='SYNTHETIC write customer')<>1 then raise exception 'Duplicate customer on retry';end if;
  select customer_id into cid from public.sales_inquiry where id=iid;
  if not exists(select 1 from public.sales_inquiry where id=iid and contact_id is not null and project_id is not null and original_text='SYNTHETIC source 100G / 10 km') then raise exception 'Original or linked parties lost';end if;
  begin
    perform public.sales_register_inquiry(draft||'{"title":"changed after uncertain response"}'::jsonb);
    raise exception 'Changed retry accepted';exception when serialization_failure then null;end;
  begin
    perform public.sales_register_inquiry(draft||jsonb_build_object('id',gen_random_uuid(),'received_at','invalid'));
    raise exception 'Invalid draft accepted';exception when invalid_datetime_format or unique_violation then null;end;
  -- Failure after inline inserts must roll back ALL parties in the subtransaction.
  begin
    perform public.sales_register_inquiry(draft||jsonb_build_object('id',gen_random_uuid(),'customer_name','SYNTHETIC rollback customer','title',''));
    raise exception 'Invalid title accepted';exception when check_violation then null;end;
  if exists(select 1 from public.sales_customer where name='SYNTHETIC rollback customer') then raise exception 'Partial registration persisted';end if;
  begin
    insert into public.sales_customer(owner_id,name) values('00000000-0000-4000-8000-000000000099','SYNTHETIC forged owner');
    raise exception 'Forged owner accepted';exception when insufficient_privilege then null;end;
  begin
    insert into public.sales_inquiry(owner_id,customer_id,title,channel,received_at,original_text)
      values(auth.uid(),'00000000-0000-4000-8000-000000000090','SYNTHETIC cross-owner','manual',now(),'SYNTHETIC');
    raise exception 'Foreign customer linked';exception when foreign_key_violation then null;end;
  update public.sales_customer set name='SYNTHETIC changed foreign' where id='00000000-0000-4000-8000-000000000090';
  get diagnostics n=row_count;if n<>0 then raise exception 'Foreign customer updated';end if;
  begin
    perform public.sales_add_action('00000000-0000-4000-8000-000000000090',task);
    raise exception 'Foreign inquiry action accepted';exception when foreign_key_violation then null;end;
  begin update public.sales_access set enabled=false where user_id=auth.uid();raise exception 'Allowlist writable';exception when insufficient_privilege then null;end;
  begin delete from public.sales_customer where id=cid;raise exception 'DELETE allowed';exception when insufficient_privilege then null;end;
  if public.sales_add_action(iid,task)<>aid or public.sales_add_action(iid,task)<>aid then raise exception 'Action retry failed';end if;
  begin
    perform public.sales_close_inquiry(iid,'{"revision":1,"resolved":true}');raise exception 'Open mandatory closure';exception when check_violation then null;end;
  begin
    update public.sales_inquiry set status='closed',resolved_confirmed=true where id=iid;
    raise exception 'Direct update bypassed closure';exception when check_violation then null;end;
  begin
    perform public.sales_edit_action(aid,task||'{"revision":1,"status":"cancelled","cancel_reason":" "}');
    raise exception 'Missing cancellation reason accepted';exception when check_violation then null;end;
  rev:=public.sales_edit_action(aid,task||'{"revision":1,"status":"completed"}');
  if rev<>2 or not exists(select 1 from public.sales_action where id=aid and completed_at is not null and status='completed') then raise exception 'Completion evidence missing';end if;
  begin
    perform public.sales_edit_action(aid,task||'{"revision":1,"status":"open"}');raise exception 'Stale action write';exception when serialization_failure then null;end;
  begin
    perform public.sales_edit_action(aid,task||'{"revision":2,"status":"open"}');raise exception 'Finished action edited';exception when check_violation then null;end;
  perform public.sales_add_action(iid,task||jsonb_build_object('id',optional_id,'mandatory',false));
  perform public.sales_edit_action(optional_id,task||'{"revision":1,"status":"cancelled","cancel_reason":"SYNTHETIC unnecessary"}');
  if not exists(select 1 from public.sales_action where id=optional_id and cancel_reason='SYNTHETIC unnecessary') then raise exception 'Cancellation reason lost';end if;
  perform public.sales_add_action(iid,task||jsonb_build_object('id','00000000-0000-4000-8000-000000000084','mandatory',false));
  select updated_at into stamp from public.sales_customer where id=cid;
  perform public.sales_edit_party(jsonb_build_object('kind','customer','id',cid,'expected_updated_at',stamp,'name','SYNTHETIC renamed customer'));
  begin
    perform public.sales_edit_party(jsonb_build_object('kind','customer','id',cid,'expected_updated_at',stamp,'name','SYNTHETIC stale'));
    raise exception 'Stale customer update';exception when serialization_failure then null;end;
  rev:=public.sales_edit_inquiry(iid,'{"revision":1,"title":"SYNTHETIC updated title","next_action":"SYNTHETIC updated next"}');
  if rev<>2 then raise exception 'Inquiry revision increment';end if;
  begin perform public.sales_edit_inquiry(iid,'{"revision":1,"title":"stale"}');raise exception 'Stale inquiry write';exception when serialization_failure then null;end;
  begin update public.sales_inquiry set original_text='overwritten' where id=iid;raise exception 'Original overwritten';exception when check_violation then null;end;
  begin perform public.sales_close_inquiry(iid,'{"revision":2,"resolved":false}');raise exception 'Unresolved closure';exception when check_violation then null;end;
  rev:=public.sales_close_inquiry(iid,'{"revision":2,"resolved":true}');
  if rev<>3 or not exists(select 1 from public.sales_inquiry where id=iid and status='closed' and closed_at is not null and original_text='SYNTHETIC source 100G / 10 km') then raise exception 'Closed history missing';end if;
  if not exists(select 1 from public.sales_action where id='00000000-0000-4000-8000-000000000084' and status='open' and not mandatory) then raise exception 'Optional history lost';end if;
  begin perform public.sales_add_action(iid,task||jsonb_build_object('id',gen_random_uuid()));raise exception 'Action added to closed inquiry';exception when check_violation then null;end;
  begin perform public.sales_edit_inquiry(iid,'{"revision":3,"title":"reopened"}');raise exception 'Closed inquiry edited';exception when check_violation then null;end;
end $tests$;
reset role;
update public.sales_access set enabled=false where user_id='a11803c8-01ef-4563-95bb-c0024541be2c';
set local role authenticated;
do $disabled$
begin
  if exists(select 1 from public.sales_inquiry) then raise exception 'Disabled read';end if;
  begin insert into public.sales_customer(owner_id,name) values(auth.uid(),'SYNTHETIC disabled');raise exception 'Disabled write';exception when insufficient_privilege then null;end;
end $disabled$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
do $unapproved$
begin
  if exists(select 1 from public.sales_customer) then raise exception 'Unapproved read';end if;
  begin perform public.sales_register_inquiry('{"id":"00000000-0000-4000-8000-000000000071"}');raise exception 'Unapproved write';exception when insufficient_privilege then null;end;
end $unapproved$;
reset role;
set local role anon;
do $anon$
begin
  begin perform public.sales_register_inquiry('{}');raise exception 'Anon RPC';exception when insufficient_privilege then null;end;
  begin insert into public.sales_customer(owner_id,name) values('00000000-0000-4000-8000-000000000099','SYNTHETIC anon');raise exception 'Anon write';exception when insufficient_privilege then null;end;
end $anon$;
reset role;
