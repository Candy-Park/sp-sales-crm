-- Additive memo provenance. Existing business records and B remain unchanged.
begin;
alter table public.sales_remote_memo add column if not exists origin jsonb;
alter table public.sales_remote_memo add column if not exists home_task boolean not null default false;
create unique index if not exists sales_remote_memo_origin_unique on public.sales_remote_memo(owner_id,(origin->>'projectRef'),(origin->>'ownerId'),(origin->>'entity'),(origin->>'id')) where origin is not null;
create or replace function public.sales_remote_memo_write(p_request_id uuid,p_memo_id uuid,p_revision bigint,p_patch jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid:=auth.uid(); previous public.sales_remote_receipt; item public.sales_remote_memo;
 incoming jsonb:=jsonb_build_object('kind','memo','id',p_memo_id,'revision',p_revision,'patch',p_patch);
 result jsonb; d date; o jsonb; snap jsonb; existing_import boolean:=false;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception 'access denied' using errcode='42501';end if;
 -- Serialize same-owner writes so a lost response can safely repeat the request.
 perform 1 from public.sales_access where user_id=uid for update;
 select * into previous from public.sales_remote_receipt where owner_id=uid and request_id=p_request_id;
 if found then
  if previous.input<>incoming then raise exception 'request conflict' using errcode='40001';end if;
  if p_memo_id is null and p_patch?'origin' then
   select * into item from public.sales_remote_memo where owner_id=uid and id=(previous.response->>'id')::uuid;
   if not found then raise exception 'memo unavailable' using errcode='42501';end if;
   return jsonb_build_object('id',item.id,'content',item.content,'category',item.category,'dueDate',item.due_date,'completedAt',item.completed_at,'revision',item.revision,'createdAt',item.created_at,'updatedAt',item.updated_at,'origin',item.origin,'homeTask',item.home_task);
  end if;
  return previous.response;
 end if;
 if p_request_id is null or p_revision is null or p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb
 or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('content','category','dueDate','completed','origin','homeTask')) then raise exception 'invalid memo input' using errcode='22023';end if;
 if p_patch?'content' and (jsonb_typeof(p_patch->'content')<>'string' or length(btrim(p_patch->>'content')) not between 1 and 10000 or p_patch->>'content' ~ '^\s*$') then raise exception 'invalid content' using errcode='22023';end if;
 if p_patch?'category' and (jsonb_typeof(p_patch->'category')<>'string' or p_patch->>'category' not in ('personal','work')) then raise exception 'invalid category' using errcode='22023';end if;
 if p_patch?'completed' and jsonb_typeof(p_patch->'completed')<>'boolean' then raise exception 'invalid completion' using errcode='22023';end if;
 if p_patch?'dueDate' and p_patch->'dueDate'<>'null'::jsonb then
  if jsonb_typeof(p_patch->'dueDate')<>'string' or p_patch->>'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid due date' using errcode='22023';end if;
  d:=(p_patch->>'dueDate')::date;if to_char(d,'YYYY-MM-DD')<>p_patch->>'dueDate' then raise exception 'invalid due date' using errcode='22023';end if;
 end if;
 if p_patch?'origin' or p_patch?'homeTask' then
  if p_memo_id is not null then raise exception 'immutable origin' using errcode='22023';end if;
  begin
   o:=p_patch->'origin';
   if jsonb_typeof(o)<>'object' or o is null or jsonb_typeof(p_patch->'homeTask') is distinct from 'boolean' or (select count(*) from jsonb_object_keys(p_patch))<>5 then raise exception 'invalid origin';end if;
   if (select array_agg(k order by k) from jsonb_object_keys(o) k)<>array['capturedAt','createdAt','entity','id','ownerId','projectRef','revision','sha256','snapshot','updatedAt'] then raise exception 'invalid origin fields';end if;
   if exists(select 1 from jsonb_each(o) e where e.key<>'revision' and jsonb_typeof(e.value)<>'string') or jsonb_typeof(o->'revision')<>'number' or (o->>'revision') !~ '^[1-9][0-9]*$'
    or o->>'entity'<>'crm_memo' or o->>'projectRef' !~ '^[a-zA-Z0-9_]{1,64}$'
    or o->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or o->>'ownerId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or length(o->>'snapshot')>20000 or o->>'sha256' !~ '^[a-f0-9]{64}$'
    or encode(sha256(convert_to(o->>'snapshot','UTF8')),'hex')<>o->>'sha256' then raise exception 'invalid origin values';end if;
   perform (o->>'createdAt')::timestamptz,(o->>'updatedAt')::timestamptz,(o->>'capturedAt')::timestamptz;
   snap:=(o->>'snapshot')::jsonb;
   if jsonb_typeof(snap)<>'object' then raise exception 'invalid snapshot';end if;
   if (select array_agg(k order by k) from jsonb_object_keys(snap) k)<>array['category','completed_at','content','created_at','due_date','id','owner_id','revision','updated_at']
    or not coalesce(snap->>'id'=o->>'id' and snap->>'owner_id'=o->>'ownerId' and snap->'revision'=o->'revision'
    and snap->>'created_at'=o->>'createdAt' and snap->>'updated_at'=o->>'updatedAt'
    and jsonb_typeof(snap->'content')='string' and length(snap->>'content') between 1 and 10000
    and btrim(snap->>'content',E' \t\n\r\f' || chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=p_patch->>'content' and snap->'category'=p_patch->'category'
    and snap->'due_date'='null'::jsonb and snap->'completed_at'='null'::jsonb and p_patch->'dueDate'='null'::jsonb
    and (not (p_patch->>'homeTask')::boolean or p_patch->>'category'='work'),false) then raise exception 'invalid snapshot identity';end if;
  exception when others then raise exception 'invalid origin snapshot' using errcode='22023';end;
 end if;
 if p_memo_id is null then
  if p_revision<>0 or not(p_patch ?& array['content','category','dueDate']) or p_patch?'completed' then raise exception 'invalid create' using errcode='22023';end if;
  if o is not null then
   select * into item from public.sales_remote_memo where owner_id=uid and origin->>'projectRef'=o->>'projectRef' and origin->>'ownerId'=o->>'ownerId' and origin->>'entity'=o->>'entity' and origin->>'id'=o->>'id';
   if found then
    if item.origin->>'sha256'<>o->>'sha256' then raise exception 'source conflict' using errcode='40001';end if;
    existing_import:=true;
   end if;
  end if;
  if not existing_import then
   insert into public.sales_remote_memo(owner_id,id,content,category,due_date,revision,origin,home_task) values(uid,p_request_id,btrim(p_patch->>'content'),p_patch->>'category',d,1,o,coalesce((p_patch->>'homeTask')::boolean,false)) returning * into item;
  end if;
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
 result:=jsonb_build_object('id',item.id,'content',item.content,'category',item.category,'dueDate',item.due_date,'completedAt',item.completed_at,'revision',item.revision,'createdAt',item.created_at,'updatedAt',item.updated_at,'origin',item.origin,'homeTask',item.home_task);
 if not existing_import then insert into public.sales_remote_memo_history values(uid,item.id,item.revision,result);end if;
 insert into public.sales_remote_receipt(owner_id,request_id,input,response) values(uid,p_request_id,incoming,result);
 return result;
end;$$;

revoke all on function public.sales_remote_memo_write(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.sales_remote_memo_write(uuid,uuid,bigint,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
