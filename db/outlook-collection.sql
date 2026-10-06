-- NEW glscckjmlwvxilzneqdf only. Preserve existing product/communication rules.
begin;
create table public.sales_outlook_mail (
 id uuid primary key,owner_id uuid not null references auth.users(id),
 scope_key text not null check(scope_key ~ '^[0-9a-f]{64}$'),source_key text not null check(source_key ~ '^[0-9a-f]{64}$'),
 payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),fingerprint text not null,
 direction text not null check(direction in ('received','sent')),subject text not null check(length(subject)<=1000),
 occurred_at timestamptz not null,body_length integer not null check(body_length between 0 and 10000000),
 original jsonb not null,state text not null check(state in ('pending','held','linked')),
 inquiry_id uuid,created_at timestamptz not null default clock_timestamp(),
 unique(owner_id,scope_key,source_key),foreign key(inquiry_id,owner_id) references public.sales_inquiry(id,owner_id),
 check((state='linked')=(inquiry_id is not null)),
 check(case when body_length>100000 then state='held' and original->'body'='null'::jsonb
 else state<>'held' and jsonb_typeof(original->'body')='string' and length(original->>'body')=body_length end)
);
create index sales_outlook_queue on public.sales_outlook_mail(owner_id,occurred_at desc,id);
create index sales_outlook_inquiry on public.sales_outlook_mail(owner_id,inquiry_id);
alter table public.sales_outlook_mail enable row level security;
revoke all on public.sales_outlook_mail from public,anon,authenticated;
grant select,insert on public.sales_outlook_mail to authenticated;
grant update(state,inquiry_id) on public.sales_outlook_mail to authenticated;
create policy sales_outlook_read on public.sales_outlook_mail for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled));
create policy sales_outlook_insert on public.sales_outlook_mail for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled));
create policy sales_outlook_update on public.sales_outlook_mail for update to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled))
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled));
create function public.sales_guard_outlook() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent_state text;
begin
 if TG_OP='INSERT' then
  if new.state not in ('pending','held') or new.inquiry_id is not null then raise exception using errcode='23514',message='Review required';end if;
 else
  if old.state<>'pending' or new.state<>'linked' or new.inquiry_id is null then raise exception using errcode='23514',message='Immutable mail link';end if;
  if (to_jsonb(new)-'state'-'inquiry_id')<>(to_jsonb(old)-'state'-'inquiry_id') then raise exception using errcode='23514',message='Preserve mail original';end if;
  select status into parent_state from public.sales_inquiry where id=new.inquiry_id and owner_id=new.owner_id for update;
  if not found or parent_state='closed' then raise exception using errcode='23514',message='Open owned inquiry required';end if;
 end if;
 return new;
end $$;
revoke all on function public.sales_guard_outlook() from public,anon,authenticated;
create trigger sales_outlook_guard before insert or update on public.sales_outlook_mail for each row execute function public.sales_guard_outlook();
create function public.sales_ingest_outlook(p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m jsonb; old public.sales_outlook_mail; n integer; fp text;
begin
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 if (select count(*) from jsonb_object_keys(p_data))<>6 or not(p_data ?& array['id','scope_key','source_key','payload_hash','body_length','original_json']) then raise exception using errcode='23514',message='Invalid envelope';end if;
 m:=(p_data->>'original_json')::jsonb;n:=(p_data->>'body_length')::integer;
 if jsonb_typeof(m)<>'object' or (select count(*) from jsonb_object_keys(m))<>10 or not(m ?& array['source_key','identity_method','direction','subject','body','sender','recipients','occurred_at','conversation_key','attachments'])
 or m->>'source_key'<>p_data->>'source_key' or m->>'identity_method' not in ('internet_message_id','entry_id_fallback')
 or jsonb_typeof(m->'subject')<>'string' or jsonb_typeof(m->'sender')<>'string' or jsonb_typeof(m->'recipients')<>'string'
 or length(m->>'sender')>2000 or length(m->>'recipients')>10000 or jsonb_typeof(m->'attachments')<>'array' or jsonb_array_length(m->'attachments')>100
 then raise exception using errcode='23514',message='Invalid mail';end if;
 if n<=100000 and encode(extensions.digest(convert_to(p_data->>'original_json','UTF8'),'sha256'),'hex')<>p_data->>'payload_hash' then raise exception using errcode='23514',message='Original hash mismatch';end if;
 fp:=md5((p_data-'id')::text);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||(p_data->>'scope_key')||(p_data->>'source_key'),71));
 select * into old from public.sales_outlook_mail where owner_id=auth.uid() and scope_key=p_data->>'scope_key' and source_key=p_data->>'source_key';
 if found then
  if old.fingerprint<>fp then raise exception using errcode='40001',message='Original differs';end if;
 else
  insert into public.sales_outlook_mail(id,owner_id,scope_key,source_key,payload_hash,fingerprint,direction,subject,occurred_at,body_length,original,state)
  values((p_data->>'id')::uuid,auth.uid(),p_data->>'scope_key',p_data->>'source_key',p_data->>'payload_hash',fp,m->>'direction',m->>'subject',(m->>'occurred_at')::timestamptz,n,m,case when n>100000 then 'held' else 'pending' end) returning * into old;
 end if;
 return jsonb_build_object('id',old.id,'source_key',old.source_key,'payload_hash',old.payload_hash);
end $$;
create function public.sales_link_outlook(p_id uuid,p_data jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare m public.sales_outlook_mail;iid uuid;r jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 select * into m from public.sales_outlook_mail where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='Mail unavailable';end if;
 if (select count(*) from jsonb_object_keys(p_data))<>1 or not(p_data ? 'inquiry_id' or p_data ? 'registration') then raise exception using errcode='23514',message='Explicit link required';end if;
 iid:=case when p_data ? 'inquiry_id' then (p_data->>'inquiry_id')::uuid else (p_data->'registration'->>'id')::uuid end;
 if m.state='linked' then
  if m.inquiry_id=iid then
   if p_data ? 'registration' and not exists(select 1 from public.sales_inquiry where id=iid and owner_id=auth.uid() and registration_fingerprint=md5((p_data->'registration')::text)) then raise exception using errcode='40001',message='Registration differs';end if;
   return iid;
  end if;
  raise exception using errcode='40001',message='Already linked';
 end if;
 if m.state='held' then raise exception using errcode='23514',message='Local original held';end if;
 if p_data ? 'registration' then
  r:=p_data->'registration';
  if r->>'original_text' is distinct from m.original->>'body' or r->>'channel'<>'email' or (r->>'received_at')::timestamptz<>m.occurred_at then raise exception using errcode='23514',message='Preserve email source';end if;
  iid:=public.sales_register_inquiry(r);
 end if;
 update public.sales_outlook_mail set state='linked',inquiry_id=iid where id=m.id;
 return iid;
end $$;
revoke all on function public.sales_ingest_outlook(jsonb),public.sales_link_outlook(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_ingest_outlook(jsonb),public.sales_link_outlook(uuid,jsonb) to authenticated;
commit;
