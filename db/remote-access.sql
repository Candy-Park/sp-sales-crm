-- Additive cloud state. Existing business tables and policies are untouched.
begin;
create table public.sales_remote_memo (
 owner_id uuid not null, id uuid not null, content text not null check(length(content) between 1 and 10000),
 category text not null check(category in ('personal','work')), due_date date, completed_at timestamptz,
 revision bigint not null check(revision>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 primary key(owner_id,id)
);
create table public.sales_remote_memo_history (
 owner_id uuid not null, memo_id uuid not null, revision bigint not null, snapshot jsonb not null,
 primary key(owner_id,memo_id,revision), foreign key(owner_id,memo_id) references public.sales_remote_memo(owner_id,id)
);
create table public.sales_remote_snapshot (
 owner_id uuid not null, kind text not null check(kind in ('handling','analysis','status','sources')),
 revision bigint not null check(revision>0), payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=800000),
 updated_at timestamptz not null default now(), primary key(owner_id,kind)
);
create table public.sales_remote_receipt (
 owner_id uuid not null, request_id uuid not null, input jsonb not null, response jsonb not null,
 created_at timestamptz not null default now(), primary key(owner_id,request_id)
);
alter table public.sales_remote_memo enable row level security;
alter table public.sales_remote_memo_history enable row level security;
alter table public.sales_remote_snapshot enable row level security;
alter table public.sales_remote_receipt enable row level security;
create policy remote_memo_owner on public.sales_remote_memo for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.sales_access a where a.user_id=auth.uid() and a.enabled));
create policy remote_history_owner on public.sales_remote_memo_history for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.sales_access a where a.user_id=auth.uid() and a.enabled));
create policy remote_snapshot_owner on public.sales_remote_snapshot for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.sales_access a where a.user_id=auth.uid() and a.enabled));
create policy remote_receipt_owner on public.sales_remote_receipt for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.sales_access a where a.user_id=auth.uid() and a.enabled));
revoke all on public.sales_remote_memo,public.sales_remote_memo_history,public.sales_remote_snapshot,public.sales_remote_receipt from public,anon,authenticated;
grant select on public.sales_remote_memo,public.sales_remote_memo_history,public.sales_remote_snapshot,public.sales_remote_receipt to authenticated;

create function public.sales_remote_memo_write(p_request_id uuid,p_memo_id uuid,p_revision bigint,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); previous public.sales_remote_receipt; item public.sales_remote_memo;
 incoming jsonb:=jsonb_build_object('kind','memo','id',p_memo_id,'revision',p_revision,'patch',p_patch);
 result jsonb; d date;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception 'access denied' using errcode='42501';end if;
 -- Serialize same-owner writes so a lost response can safely repeat the request.
 perform 1 from public.sales_access where user_id=uid for update;
 select * into previous from public.sales_remote_receipt where owner_id=uid and request_id=p_request_id;
 if found then if previous.input<>incoming then raise exception 'request conflict' using errcode='40001';end if;return previous.response;end if;
 if p_request_id is null or p_revision is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb
 or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('content','category','dueDate','completed')) then raise exception 'invalid memo input' using errcode='22023';end if;
 if p_patch?'content' and (jsonb_typeof(p_patch->'content')<>'string' or length(btrim(p_patch->>'content')) not between 1 and 10000 or p_patch->>'content' ~ '^\s*$') then raise exception 'invalid content' using errcode='22023';end if;
 if p_patch?'category' and (jsonb_typeof(p_patch->'category')<>'string' or p_patch->>'category' not in ('personal','work')) then raise exception 'invalid category' using errcode='22023';end if;
 if p_patch?'completed' and jsonb_typeof(p_patch->'completed')<>'boolean' then raise exception 'invalid completion' using errcode='22023';end if;
 if p_patch?'dueDate' and p_patch->'dueDate'<>'null'::jsonb then
  if jsonb_typeof(p_patch->'dueDate')<>'string' or p_patch->>'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid due date' using errcode='22023';end if;
  d:=(p_patch->>'dueDate')::date;if to_char(d,'YYYY-MM-DD')<>p_patch->>'dueDate' then raise exception 'invalid due date' using errcode='22023';end if;
 end if;
 if p_memo_id is null then
  if p_revision<>0 or not(p_patch ?& array['content','category','dueDate']) or p_patch?'completed' then raise exception 'invalid create' using errcode='22023';end if;
  insert into public.sales_remote_memo(owner_id,id,content,category,due_date,revision) values(uid,p_request_id,btrim(p_patch->>'content'),p_patch->>'category',d,1) returning * into item;
 else
  select * into item from public.sales_remote_memo where owner_id=uid and id=p_memo_id for update;
  if not found then raise exception 'memo unavailable' using errcode='42501';end if;
  if p_revision is null or p_revision<>item.revision then raise exception 'version conflict' using errcode='40001';end if;
  update public.sales_remote_memo set
   content=case when p_patch?'content' then btrim(p_patch->>'content') else item.content end,
   category=case when p_patch?'category' then p_patch->>'category' else item.category end,
   due_date=case when p_patch?'dueDate' then d else item.due_date end,
   completed_at=case when not(p_patch?'completed') then item.completed_at when (p_patch->>'completed')::boolean then coalesce(item.completed_at,now()) else null end,
   revision=item.revision+1,updated_at=now() where owner_id=uid and id=p_memo_id returning * into item;
 end if;
 result:=jsonb_build_object('id',item.id,'content',item.content,'category',item.category,'dueDate',item.due_date,'completedAt',item.completed_at,'revision',item.revision,'createdAt',item.created_at,'updatedAt',item.updated_at);
 insert into public.sales_remote_memo_history values(uid,item.id,item.revision,result);
 insert into public.sales_remote_receipt(owner_id,request_id,input,response) values(uid,p_request_id,incoming,result);
 return result;
end;$$;

create function public.sales_remote_snapshot_write(p_request_id uuid,p_kind text,p_revision bigint,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); previous public.sales_remote_receipt; item public.sales_remote_snapshot;
 incoming jsonb:=jsonb_build_object('kind','snapshot','type',p_kind,'revision',p_revision,'payload_hash',encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'));result jsonb;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception 'access denied' using errcode='42501';end if;
 perform 1 from public.sales_access where user_id=uid for update;
 select * into previous from public.sales_remote_receipt where owner_id=uid and request_id=p_request_id;
 if found then if previous.input<>incoming then raise exception 'request conflict' using errcode='40001';end if;return previous.response;end if;
 if p_request_id is null or p_revision is null or p_revision<0 or p_kind not in ('handling','analysis','status','sources') or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>800000 then raise exception 'invalid snapshot input' using errcode='22023';end if;
 select * into item from public.sales_remote_snapshot where owner_id=uid and kind=p_kind for update;
 if (found and item.revision<>p_revision) or (not found and p_revision<>0) then raise exception 'version conflict' using errcode='40001';end if;
 insert into public.sales_remote_snapshot(owner_id,kind,revision,payload) values(uid,p_kind,p_revision+1,p_payload)
 on conflict(owner_id,kind) do update set revision=excluded.revision,payload=excluded.payload,updated_at=now() returning * into item;
 result:=jsonb_build_object('kind',item.kind,'revision',item.revision,'updated_at',item.updated_at);
 insert into public.sales_remote_receipt(owner_id,request_id,input,response) values(uid,p_request_id,incoming,result);
 return result;
end;$$;
revoke all on function public.sales_remote_memo_write(uuid,uuid,bigint,jsonb),public.sales_remote_snapshot_write(uuid,text,bigint,jsonb) from public,anon;
grant execute on function public.sales_remote_memo_write(uuid,uuid,bigint,jsonb),public.sales_remote_snapshot_write(uuid,text,bigint,jsonb) to authenticated;
create table public.sales_remote_command (
 owner_id uuid not null, id uuid not null, input jsonb not null,
 state text not null default 'queued' check(state in ('queued','running','done')),
 lease uuid, lease_until timestamptz, result jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(owner_id,id)
);
alter table public.sales_remote_command enable row level security;
create policy remote_command_owner on public.sales_remote_command for select to authenticated using(owner_id=auth.uid() and exists(select 1 from public.sales_access a where a.user_id=auth.uid() and a.enabled));
revoke all on public.sales_remote_command from public,anon,authenticated;
grant select on public.sales_remote_command to authenticated;
create function public.sales_remote_enqueue(p_request_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); item public.sales_remote_command;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception 'access denied' using errcode='42501';end if;
 perform 1 from public.sales_access where user_id=uid for update;
 if p_request_id is null or p_input is null or jsonb_typeof(p_input)<>'object' or not coalesce((
 p_input='{"operation":"refresh"}'::jsonb or
 (p_input->>'operation'='choose' and (select count(*) from jsonb_object_keys(p_input))=3 and p_input ?& array['operation','source_key','customer_id'] and p_input->>'source_key' ~ '^[0-9a-f]{64}$' and p_input->>'customer_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),false) then raise exception 'invalid command' using errcode='22023';end if;
 select * into item from public.sales_remote_command where owner_id=uid and id=p_request_id;
 if found then if item.input<>p_input then raise exception 'request conflict' using errcode='40001';end if;return to_jsonb(item)-'owner_id';end if;
 if (select count(*) from public.sales_remote_command where owner_id=uid and state<>'done')>=20 then raise exception 'pending command limit' using errcode='22023';end if;
 insert into public.sales_remote_command(owner_id,id,input) values(uid,p_request_id,p_input) returning * into item;
 return to_jsonb(item)-'owner_id';
end;$$;
create function public.sales_remote_claim()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); item public.sales_remote_command;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception 'access denied' using errcode='42501';end if;
 perform 1 from public.sales_access where user_id=uid for update;
 select * into item from public.sales_remote_command where owner_id=uid and (state='queued' or (state='running' and lease_until<now())) order by created_at,id limit 1 for update;
 if not found then return null;end if;
 update public.sales_remote_command set state='running',lease=gen_random_uuid(),lease_until=now()+interval '10 minutes',updated_at=now() where owner_id=uid and id=item.id returning * into item;
 return to_jsonb(item)-'owner_id';
end;$$;
create function public.sales_remote_complete(p_id uuid,p_lease uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); item public.sales_remote_command;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception 'access denied' using errcode='42501';end if;
 perform 1 from public.sales_access where user_id=uid for update;
 select * into item from public.sales_remote_command where owner_id=uid and id=p_id for update;
 if not found or p_lease is null or item.lease<>p_lease or item.state='queued' then raise exception 'lease conflict' using errcode='40001';end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>16000 then raise exception 'invalid result' using errcode='22023';end if;
 if item.state='done' then if item.result<>p_result then raise exception 'result conflict' using errcode='40001';end if;return to_jsonb(item)-'owner_id';end if;
 if item.lease_until<now() then raise exception 'lease conflict' using errcode='40001';end if;
 update public.sales_remote_command set state='done',result=p_result,updated_at=now() where owner_id=uid and id=p_id returning * into item;
 return to_jsonb(item)-'owner_id';
end;$$;
revoke all on function public.sales_remote_enqueue(uuid,jsonb),public.sales_remote_claim(),public.sales_remote_complete(uuid,uuid,jsonb) from public,anon;
grant execute on function public.sales_remote_enqueue(uuid,jsonb),public.sales_remote_claim(),public.sales_remote_complete(uuid,uuid,jsonb) to authenticated;
commit;
