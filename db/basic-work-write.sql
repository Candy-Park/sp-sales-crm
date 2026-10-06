-- NEW sp-sales-crm only: glscckjmlwvxilzneqdf. No legacy CRM changes.
-- Rules/functions only. Client write grants are deliberately in a separate file.
begin;
alter table public.sales_inquiry add column resolved_confirmed boolean not null default false;
alter table public.sales_inquiry add column registration_fingerprint text;
alter table public.sales_inquiry add constraint sales_inquiry_resolved check(status<>'closed' or resolved_confirmed);
alter table public.sales_action add column registration_fingerprint text;
alter table public.sales_action add constraint sales_action_waiting_pair check
  ((nullif(btrim(waiting_target),'') is null) = (waiting_since is null));

create function public.sales_guard_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_status text;
begin
  if TG_OP='UPDATE' then
    if new.id<>old.id or new.owner_id<>old.owner_id or new.created_at<>old.created_at then
      raise exception using errcode='23514',message='Immutable identity';
    end if;
    if TG_TABLE_NAME in ('sales_inquiry','sales_action') then
      if new.revision<>old.revision then raise exception using errcode='40001',message='Revision conflict';end if;
      new.revision:=old.revision+1;
      if new.registration_fingerprint is distinct from old.registration_fingerprint then
        raise exception using errcode='23514',message='Immutable registration';
      end if;
    end if;
  elsif TG_TABLE_NAME in ('sales_inquiry','sales_action') then
    new.revision:=1;new.created_at:=clock_timestamp();
  end if;
  new.updated_at:=clock_timestamp();
  if TG_TABLE_NAME='sales_inquiry' then
    if TG_OP='INSERT' and (new.status<>'new' or new.closed_at is not null or new.resolved_confirmed) then
      raise exception using errcode='23514',message='New inquiry required';
    end if;
    if TG_OP='UPDATE' then
      if old.status='closed' then raise exception using errcode='23514',message='Inquiry already closed';end if;
      if new.original_text<>old.original_text or new.channel<>old.channel or new.received_at<>old.received_at then
        raise exception using errcode='23514',message='Preserve original source';
      end if;
      if new.status='closed' then
        if not new.resolved_confirmed then raise exception using errcode='23514',message='Resolution confirmation required';end if;
        if exists(select 1 from public.sales_action where inquiry_id=new.id and owner_id=new.owner_id and mandatory and status='open') then
          raise exception using errcode='23514',message='Open mandatory action';
        end if;
        new.closed_at:=clock_timestamp();
      end if;
    end if;
  elsif TG_TABLE_NAME='sales_action' then
    if TG_OP='UPDATE' and new.inquiry_id<>old.inquiry_id then raise exception using errcode='23514',message='Immutable action parent';end if;
    -- All action writes and inquiry closure serialize on the same parent row.
    select status into parent_status from public.sales_inquiry
      where id=new.inquiry_id and owner_id=new.owner_id for update;
    if not found then raise exception using errcode='23503',message='Inquiry not available';end if;
    if parent_status='closed' then raise exception using errcode='23514',message='Inquiry already closed';end if;
    if TG_OP='INSERT' and new.status<>'open' then raise exception using errcode='23514',message='New action must be open';end if;
    if TG_OP='UPDATE' and old.status<>'open' then raise exception using errcode='23514',message='Finished action is immutable';end if;
    new.completed_at:=case when new.status='completed' then clock_timestamp() else null end;
    if new.status<>'cancelled' then new.cancel_reason:=null;end if;
  end if;
  return new;
end $$;
revoke all on function public.sales_guard_write() from public,anon,authenticated;
create trigger sales_inquiry_write_guard before insert or update on public.sales_inquiry for each row execute function public.sales_guard_write();
create trigger sales_action_write_guard before insert or update on public.sales_action for each row execute function public.sales_guard_write();
create trigger sales_customer_write_guard before update on public.sales_customer for each row execute function public.sales_guard_write();
create trigger sales_contact_write_guard before update on public.sales_contact for each row execute function public.sales_guard_write();
create trigger sales_project_write_guard before update on public.sales_project for each row execute function public.sales_guard_write();

create function public.sales_register_inquiry(p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare iid uuid:=(p_data->>'id')::uuid; cid uuid; contact uuid; project uuid; existing public.sales_inquiry;
begin
  if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then
    raise exception using errcode='42501',message='Not allowed';end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||iid::text,0));
  select * into existing from public.sales_inquiry where id=iid and owner_id=auth.uid();
  if found then
    if existing.registration_fingerprint=md5(p_data::text) then return iid;end if;
    raise exception using errcode='40001',message='Registration differs; reload saved inquiry';
  end if;
  cid:=nullif(p_data->>'customer_id','')::uuid;
  if cid is null then
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||lower(btrim(p_data->>'customer_name')),2));
    if exists(select 1 from public.sales_customer where owner_id=auth.uid() and lower(btrim(name))=lower(btrim(p_data->>'customer_name'))) then
      raise exception using errcode='23505',message='Customer exists; select existing customer';end if;
    insert into public.sales_customer(owner_id,name) values(auth.uid(),btrim(p_data->>'customer_name')) returning id into cid;
  end if;
  contact:=nullif(p_data->>'contact_id','')::uuid;
  if contact is null and length(btrim(coalesce(p_data->>'contact_name','')))>0 then
    insert into public.sales_contact(owner_id,customer_id,name) values(auth.uid(),cid,btrim(p_data->>'contact_name')) returning id into contact;
  end if;
  project:=nullif(p_data->>'project_id','')::uuid;
  if project is null and length(btrim(coalesce(p_data->>'project_name','')))>0 then
    insert into public.sales_project(owner_id,customer_id,name) values(auth.uid(),cid,btrim(p_data->>'project_name')) returning id into project;
  end if;
  insert into public.sales_inquiry(id,owner_id,customer_id,contact_id,project_id,title,channel,received_at,original_text,next_action,registration_fingerprint)
    values(iid,auth.uid(),cid,contact,project,p_data->>'title',p_data->>'channel',(p_data->>'received_at')::timestamptz,
      p_data->>'original_text',coalesce(p_data->>'next_action',''),md5(p_data::text));
  return iid;
end $$;

create function public.sales_add_action(p_inquiry_id uuid,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare aid uuid:=(p_data->>'id')::uuid; existing public.sales_action;
begin
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||aid::text,1));
  select * into existing from public.sales_action where id=aid and owner_id=auth.uid();
  if found then
    if existing.inquiry_id=p_inquiry_id and existing.registration_fingerprint=md5(p_data::text) then return aid;end if;
    raise exception using errcode='40001',message='Registration differs';
  end if;
  insert into public.sales_action(id,owner_id,inquiry_id,kind,description,due_date,mandatory,waiting_target,waiting_since,registration_fingerprint)
  values(aid,auth.uid(),p_inquiry_id,p_data->>'kind',p_data->>'description',nullif(p_data->>'due_date','')::date,
    (p_data->>'mandatory')::boolean,nullif(btrim(p_data->>'waiting_target'),''),nullif(p_data->>'waiting_since','')::timestamptz,md5(p_data::text));
  return aid;
end $$;

create function public.sales_edit_action(p_id uuid,p_data jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare rev integer; parent uuid;
begin
  select inquiry_id into parent from public.sales_action where id=p_id and owner_id=auth.uid();
  -- Parent first, then Action: same lock order as closure and action creation.
  perform 1 from public.sales_inquiry where id=parent and owner_id=auth.uid() for update;
  update public.sales_action set kind=p_data->>'kind',description=p_data->>'description',due_date=nullif(p_data->>'due_date','')::date,
    mandatory=(p_data->>'mandatory')::boolean,waiting_target=nullif(btrim(p_data->>'waiting_target'),''),
    waiting_since=nullif(p_data->>'waiting_since','')::timestamptz,status=p_data->>'status',cancel_reason=p_data->>'cancel_reason'
    where id=p_id and owner_id=auth.uid() and revision=(p_data->>'revision')::integer returning revision into rev;
  if not found then raise exception using errcode='40001',message='Revision conflict or unavailable';end if;
  return rev;
end $$;

create function public.sales_edit_inquiry(p_id uuid,p_data jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare rev integer;
begin
  update public.sales_inquiry set title=p_data->>'title',next_action=coalesce(p_data->>'next_action','')
    where id=p_id and owner_id=auth.uid() and revision=(p_data->>'revision')::integer returning revision into rev;
  if not found then raise exception using errcode='40001',message='Revision conflict or unavailable';end if;return rev;
end $$;

create function public.sales_close_inquiry(p_id uuid,p_data jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare rev integer;
begin
  if (p_data->>'resolved')::boolean is distinct from true then raise exception using errcode='23514',message='Resolution confirmation required';end if;
  update public.sales_inquiry set status='closed',resolved_confirmed=true
    where id=p_id and owner_id=auth.uid() and revision=(p_data->>'revision')::integer returning revision into rev;
  if not found then raise exception using errcode='40001',message='Revision conflict or unavailable';end if;return rev;
end $$;

create function public.sales_edit_party(p_data jsonb) returns timestamptz
language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz;
begin
  case p_data->>'kind'
    when 'customer' then update public.sales_customer set name=btrim(p_data->>'name') where id=(p_data->>'id')::uuid and owner_id=auth.uid() and updated_at=(p_data->>'expected_updated_at')::timestamptz returning updated_at into stamp;
    when 'contact' then update public.sales_contact set name=btrim(p_data->>'name'),contact_note=coalesce(p_data->>'note','') where id=(p_data->>'id')::uuid and owner_id=auth.uid() and updated_at=(p_data->>'expected_updated_at')::timestamptz returning updated_at into stamp;
    when 'project' then update public.sales_project set name=btrim(p_data->>'name'),description=coalesce(p_data->>'note','') where id=(p_data->>'id')::uuid and owner_id=auth.uid() and updated_at=(p_data->>'expected_updated_at')::timestamptz returning updated_at into stamp;
    else raise exception using errcode='23514',message='Invalid party kind';
  end case;
  if stamp is null then raise exception using errcode='40001',message='Revision conflict or unavailable';end if;return stamp;
end $$;
revoke all on function public.sales_register_inquiry(jsonb),public.sales_add_action(uuid,jsonb),public.sales_edit_action(uuid,jsonb),
  public.sales_edit_inquiry(uuid,jsonb),public.sales_close_inquiry(uuid,jsonb),public.sales_edit_party(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
