-- Synthetic fixtures and provisional grants are all rolled back.
-- Only execute in NEW sp-sales-crm, not legacy sp-crm.
begin;
do $guard$
begin
  if not exists(select 1 from auth.users where id='a11803c8-01ef-4563-95bb-c0024541be2c') then
    raise exception 'Expected app user missing; abort';
  end if;
end $guard$;

grant select on public.sales_access,public.sales_customer,public.sales_contact,
  public.sales_project,public.sales_inquiry,public.sales_action to authenticated;
insert into public.sales_access(user_id,enabled) values ('a11803c8-01ef-4563-95bb-c0024541be2c',true)
  on conflict(user_id) do update set enabled=true;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000099');
insert into public.sales_customer(id,owner_id,name) values
 ('00000000-0000-4000-8000-000000000001','a11803c8-01ef-4563-95bb-c0024541be2c','SYNTHETIC own customer'),
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000099','SYNTHETIC foreign customer');

insert into public.sales_contact(id,owner_id,customer_id,name)
select id,owner_id,id,'SYNTHETIC contact' from public.sales_customer where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into public.sales_project(id,owner_id,customer_id,name)
select id,owner_id,id,'SYNTHETIC project' from public.sales_customer where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into public.sales_inquiry(id,owner_id,customer_id,title,channel,received_at,original_text)
select id,owner_id,id,'SYNTHETIC inquiry','manual',now(),'SYNTHETIC text' from public.sales_customer where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into public.sales_action(id,owner_id,inquiry_id,kind,description)
select id,owner_id,id,'other','SYNTHETIC action' from public.sales_customer where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','a11803c8-01ef-4563-95bb-c0024541be2c',true);
select set_config('request.jwt.claims','{"sub":"a11803c8-01ef-4563-95bb-c0024541be2c","role":"authenticated"}',true);
do $allowed$
declare t text; n integer;
begin
  foreach t in array array['sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    execute format('select count(*) from public.%I where id=%L',t,'00000000-0000-4000-8000-000000000001') into n;
    if n<>1 then raise exception 'Own fixture not readable: %',t;end if;
    execute format('select count(*) from public.%I where id=%L',t,'00000000-0000-4000-8000-000000000002') into n;
    if n<>0 then raise exception 'Foreign fixture exposed: %',t;end if;
  end loop;
  if (select count(*) from public.sales_customer where id='00000000-0000-4000-8000-000000000001')<>1 then raise exception 'Own row not readable';end if;
  if exists(select 1 from public.sales_customer where id='00000000-0000-4000-8000-000000000002') then raise exception 'Foreign owner exposed';end if;
  if not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception 'Allowlist not readable';end if;
  begin
    update public.sales_access set enabled=false where user_id=auth.uid();
    raise exception 'Self permission edit unexpectedly allowed';
  exception when insufficient_privilege then null;end;
  begin
    insert into public.sales_customer(owner_id,name) values(auth.uid(),'SYNTHETIC write attempt');
    raise exception 'Write unexpectedly allowed in read-only slice';
  exception when insufficient_privilege then null;end;
end $allowed$;
reset role;

update public.sales_access set enabled=false where user_id='a11803c8-01ef-4563-95bb-c0024541be2c';
set local role authenticated;
do $disabled$
declare t text; n integer;
begin
  foreach t in array array['sales_access','sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    execute format('select count(*) from public.%I',t) into n;
    if n<>0 then raise exception 'Disabled account exposed: %',t;end if;
  end loop;
  if exists(select 1 from public.sales_access) or exists(select 1 from public.sales_customer) then
    raise exception 'Disabled user can read data';
  end if;
end $disabled$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000099',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000099","role":"authenticated"}',true);
do $unapproved$
declare t text; n integer;
begin
  foreach t in array array['sales_access','sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    execute format('select count(*) from public.%I',t) into n;
    if n<>0 then raise exception 'Unapproved account exposed: %',t;end if;
  end loop;
  if exists(select 1 from public.sales_access) or exists(select 1 from public.sales_customer) then
    raise exception 'Unapproved user can read data';
  end if;
end $unapproved$;
reset role;

set local role anon;
do $anonymous$
declare t text;
begin
  foreach t in array array['sales_access','sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
    begin
      execute format('select 1 from public.%I',t);
      raise exception 'Anonymous read allowed: %',t;
    exception when insufficient_privilege then null;end;
  end loop;
  begin
    perform 1 from public.sales_customer;
    raise exception 'Anonymous data read unexpectedly allowed';
  exception when insufficient_privilege then null;end;
end $anonymous$;
reset role;

do $relationships$
begin
  begin
    insert into public.sales_inquiry(owner_id,customer_id,title,channel,received_at,original_text)
    values('a11803c8-01ef-4563-95bb-c0024541be2c','00000000-0000-4000-8000-000000000002','SYNTHETIC','manual',now(),'SYNTHETIC');
    raise exception 'Cross-owner relationship accepted';
  exception when foreign_key_violation then null;end;
end $relationships$;
rollback;
select 'login_access_rollback_tests_passed' as result;
