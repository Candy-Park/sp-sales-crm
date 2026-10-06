-- Rules only; NEW sp-sales-crm (glscckjmlwvxilzneqdf). No client grants here.
begin;
alter table public.sales_inquiry add column waiting_target text;
alter table public.sales_inquiry add column waiting_since timestamptz;
alter table public.sales_inquiry add constraint sales_inquiry_waiting_pair check
 ((nullif(btrim(waiting_target),'') is null)=(waiting_since is null));

create table public.sales_message (
 id uuid primary key, owner_id uuid not null references auth.users(id), inquiry_id uuid not null,
 kind text not null check(kind in ('hq_draft','customer_draft','hq_sent','customer_sent','hq_received','customer_received')),
 target text not null check(length(btrim(target)) between 1 and 200), subject text not null default '' check(length(subject)<=300),
 body text not null check(length(btrim(body))>0 and length(body)<=100000),
 occurred_at timestamptz, actual_confirmed boolean not null default false,
 source_id uuid, action_id uuid, question_ids uuid[] not null default '{}', question_snapshot jsonb not null default '[]',
 translation text not null default '' check(length(translation)<=100000), summary text not null default '' check(length(summary)<=10000),
 registration_fingerprint text not null, created_at timestamptz not null default clock_timestamp(),
 unique(id,inquiry_id,owner_id), foreign key(inquiry_id,owner_id) references public.sales_inquiry(id,owner_id),
 foreign key(source_id,inquiry_id,owner_id) references public.sales_message(id,inquiry_id,owner_id),
 foreign key(action_id) references public.sales_action(id),
 check((kind in ('hq_draft','customer_draft'))=(occurred_at is null)),
 check(actual_confirmed=(kind in ('hq_sent','customer_sent'))),
 check(action_id is null or kind in ('hq_sent','customer_sent')),
 check(cardinality(question_ids)<=100 and (cardinality(question_ids)=0 or kind in ('hq_draft','hq_sent')))
);
create table public.sales_hq_question (
 id uuid primary key, owner_id uuid not null references auth.users(id), inquiry_id uuid not null,
 question text not null check(length(btrim(question))>0 and length(question)<=2000),
 registration_fingerprint text not null, created_at timestamptz not null default clock_timestamp(),
 unique(id,inquiry_id,owner_id), foreign key(inquiry_id,owner_id) references public.sales_inquiry(id,owner_id)
);
create table public.sales_hq_review (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id), inquiry_id uuid not null,
 question_id uuid not null, revision integer not null check(revision>1),
 status text not null check(status in ('open','partial','answered','cancelled')), response_message_id uuid,
 note text not null default '' check(length(note)<=2000 and (status='open' or length(btrim(note))>0)),
 created_at timestamptz not null default clock_timestamp(), unique(question_id,revision),
 foreign key(question_id,inquiry_id,owner_id) references public.sales_hq_question(id,inquiry_id,owner_id),
 foreign key(response_message_id,inquiry_id,owner_id) references public.sales_message(id,inquiry_id,owner_id),
 check(status not in ('partial','answered') or response_message_id is not null),
 check(status<>'cancelled' or response_message_id is null)
);
create index sales_message_inquiry on public.sales_message(owner_id,inquiry_id,created_at desc,id desc);
create index sales_hq_question_inquiry on public.sales_hq_question(owner_id,inquiry_id,created_at,id);
create index sales_hq_review_question on public.sales_hq_review(owner_id,inquiry_id,question_id,revision desc);
create index sales_message_source on public.sales_message(source_id,inquiry_id,owner_id);
create index sales_message_action on public.sales_message(action_id);
create index sales_hq_review_response on public.sales_hq_review(response_message_id,inquiry_id,owner_id);
do $policies$
declare t text; predicate text:='owner_id=(select auth.uid()) and exists(select 1 from public.sales_access a where a.user_id=(select auth.uid()) and a.enabled)';
begin
 foreach t in array array['sales_message','sales_hq_question','sales_hq_review'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('create policy %I on public.%I for select to authenticated using (%s)',t||'_read',t,predicate);
  execute format('create policy %I on public.%I for insert to authenticated with check (%s)',t||'_create',t,predicate);
 end loop;
end $policies$;

create function public.sales_guard_communication() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_state text; source_kind text; qcount integer; previous integer;
begin
 if TG_OP<>'INSERT' then raise exception using errcode='23514',message='Communication history is immutable';end if;
 select status into parent_state from public.sales_inquiry where id=new.inquiry_id and owner_id=new.owner_id for update;
 if not found then raise exception using errcode='23503',message='Inquiry unavailable';end if;
 if parent_state='closed' then raise exception using errcode='23514',message='Inquiry closed';end if;
 new.created_at:=clock_timestamp();
 if TG_TABLE_NAME='sales_message' then
  if new.occurred_at>clock_timestamp()+interval '1 minute' then raise exception using errcode='23514',message='Future event';end if;
  if new.source_id is not null then
   select kind into source_kind from public.sales_message where id=new.source_id and owner_id=new.owner_id and inquiry_id=new.inquiry_id;
   if not found or not (
    (new.kind='hq_sent' and source_kind='hq_draft') or (new.kind='customer_sent' and source_kind='customer_draft') or
    (new.kind='hq_received' and source_kind='hq_sent') or (new.kind='customer_received' and source_kind='customer_sent') or
    (new.kind in ('hq_draft','customer_draft') and source_kind in ('hq_received','customer_received'))
   ) then raise exception using errcode='23514',message='Invalid source message';end if;
  end if;
  if new.action_id is not null and not exists(select 1 from public.sales_action a where a.id=new.action_id and a.owner_id=new.owner_id and a.inquiry_id=new.inquiry_id and a.status='open' and a.kind=case new.kind when 'hq_sent' then 'hq_inquiry' when 'customer_sent' then 'customer_reply' else '' end) then
   raise exception using errcode='23514',message='Invalid sending Action';end if;
  select count(*) into qcount from public.sales_hq_question q where q.id=any(new.question_ids) and q.owner_id=new.owner_id and q.inquiry_id=new.inquiry_id;
  if qcount<>cardinality(new.question_ids) then raise exception using errcode='23514',message='Invalid or duplicate questions';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'question',q.question) order by q.created_at,q.id),'[]'::jsonb) into new.question_snapshot
   from public.sales_hq_question q where q.id=any(new.question_ids) and q.owner_id=new.owner_id and q.inquiry_id=new.inquiry_id;
 elsif TG_TABLE_NAME='sales_hq_review' then
  if not exists(select 1 from public.sales_hq_question where id=new.question_id and owner_id=new.owner_id and inquiry_id=new.inquiry_id) then raise exception using errcode='23503',message='Question unavailable';end if;
  select coalesce(max(revision),1) into previous from public.sales_hq_review where question_id=new.question_id and owner_id=new.owner_id;
  if new.revision<>previous+1 then raise exception using errcode='40001',message='Question revision conflict';end if;
  if new.response_message_id is not null and not exists(select 1 from public.sales_message where id=new.response_message_id and inquiry_id=new.inquiry_id and owner_id=new.owner_id and kind='hq_received') then
   raise exception using errcode='23514',message='HQ response evidence required';end if;
 end if;
 return new;
end $$;
create trigger sales_message_guard before insert or update or delete on public.sales_message for each row execute function public.sales_guard_communication();
create trigger sales_hq_question_guard before insert or update or delete on public.sales_hq_question for each row execute function public.sales_guard_communication();
create trigger sales_hq_review_guard before insert or update or delete on public.sales_hq_review for each row execute function public.sales_guard_communication();
revoke all on function public.sales_guard_communication() from public,anon,authenticated;

create function public.sales_communication_inquiry_guard() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.status='closed' and exists(select 1 from public.sales_hq_question q where q.inquiry_id=new.id and q.owner_id=new.owner_id and
  coalesce((select r.status from public.sales_hq_review r where r.question_id=q.id and r.owner_id=q.owner_id order by r.revision desc limit 1),'open') in ('open','partial')) then
  raise exception using errcode='23514',message='Unanswered HQ questions';end if;
 if new.status in ('waiting_for_hq','waiting_for_customer') then
  if new.waiting_target is null or new.waiting_since is null or not exists(select 1 from public.sales_message m where m.inquiry_id=new.id and m.owner_id=new.owner_id and m.actual_confirmed and
    m.kind=case new.status when 'waiting_for_hq' then 'hq_sent' else 'customer_sent' end and m.target=new.waiting_target and m.occurred_at=new.waiting_since) then
   raise exception using errcode='23514',message='Actual sending evidence required';end if;
 elsif new.waiting_target is not null or new.waiting_since is not null then
  new.waiting_target:=null;new.waiting_since:=null;
 end if;
 return new;
end $$;
create trigger sales_communication_inquiry_guard before insert or update on public.sales_inquiry for each row execute function public.sales_communication_inquiry_guard();
revoke all on function public.sales_communication_inquiry_guard() from public,anon,authenticated;

create function public.sales_message_effects() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.action_id is not null then update public.sales_action set status='completed' where id=new.action_id and owner_id=new.owner_id;end if;
 -- Historical imports do not move the present workflow behind a more recent event.
 if new.occurred_at is not null and not exists(select 1 from public.sales_message m where m.inquiry_id=new.inquiry_id and m.owner_id=new.owner_id and m.occurred_at>new.occurred_at) then
  update public.sales_inquiry set
   status=case new.kind when 'hq_sent' then 'waiting_for_hq' when 'customer_sent' then 'waiting_for_customer' else 'customer_reply_needed' end,
   waiting_target=case when new.actual_confirmed then new.target else null end,
   waiting_since=case when new.actual_confirmed then new.occurred_at else null end
   where id=new.inquiry_id and owner_id=new.owner_id;
 end if;
 return new;
end $$;
create trigger sales_message_effects after insert on public.sales_message for each row execute function public.sales_message_effects();
revoke all on function public.sales_message_effects() from public,anon,authenticated;

create function public.sales_record_message(p_inquiry_id uuid,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare mid uuid:=(p_data->>'id')::uuid; existing public.sales_message; qids uuid[];
begin
 if jsonb_typeof(p_data)<>'object' or (p_data-array['id','kind','target','subject','body','occurred_at','actual_confirmed','source_id','action_id','question_ids','translation','summary'])<>'{}'::jsonb then raise exception using errcode='23514',message='Unexpected message fields';end if;
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||mid::text,4));
 select * into existing from public.sales_message where id=mid and owner_id=auth.uid();
 if found then
  if existing.inquiry_id=p_inquiry_id and existing.registration_fingerprint=md5(p_data::text) then return mid;end if;
  raise exception using errcode='40001',message='Message retry differs';
 end if;
 select coalesce(array_agg(value::uuid),'{}'::uuid[]) into qids from jsonb_array_elements_text(coalesce(p_data->'question_ids','[]'));
 insert into public.sales_message(id,owner_id,inquiry_id,kind,target,subject,body,occurred_at,actual_confirmed,source_id,action_id,question_ids,translation,summary,registration_fingerprint)
 values(mid,auth.uid(),p_inquiry_id,p_data->>'kind',p_data->>'target',coalesce(p_data->>'subject',''),p_data->>'body',nullif(p_data->>'occurred_at','')::timestamptz,
  coalesce((p_data->>'actual_confirmed')::boolean,false),nullif(p_data->>'source_id','')::uuid,nullif(p_data->>'action_id','')::uuid,qids,
  coalesce(p_data->>'translation',''),coalesce(p_data->>'summary',''),md5(p_data::text));
 return mid;
end $$;
create function public.sales_add_hq_question(p_inquiry_id uuid,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare qid uuid:=(p_data->>'id')::uuid; existing public.sales_hq_question;
begin
 if jsonb_typeof(p_data)<>'object' or (p_data-array['id','question'])<>'{}'::jsonb then raise exception using errcode='23514',message='Unexpected question fields';end if;
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||qid::text,5));
 select * into existing from public.sales_hq_question where id=qid and owner_id=auth.uid();
 if found then
  if existing.inquiry_id=p_inquiry_id and existing.registration_fingerprint=md5(p_data::text) then return qid;end if;
  raise exception using errcode='40001',message='Question retry differs';end if;
 insert into public.sales_hq_question(id,owner_id,inquiry_id,question,registration_fingerprint) values(qid,auth.uid(),p_inquiry_id,p_data->>'question',md5(p_data::text));
 return qid;
end $$;
create function public.sales_review_hq_question(p_id uuid,p_data jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare parent uuid; expected integer:=(p_data->>'revision')::integer; latest public.sales_hq_review;
begin
 if jsonb_typeof(p_data)<>'object' or (p_data-array['revision','status','response_message_id','note'])<>'{}'::jsonb then raise exception using errcode='23514',message='Unexpected review fields';end if;
 select inquiry_id into parent from public.sales_hq_question where id=p_id and owner_id=auth.uid();
 if not found then raise exception using errcode='42501',message='Question unavailable';end if;
 perform 1 from public.sales_inquiry where id=parent and owner_id=auth.uid() for update;
 select * into latest from public.sales_hq_review where question_id=p_id and owner_id=auth.uid() order by revision desc limit 1;
 -- Exact retry after response loss returns the saved result, including after closure.
 if latest.revision=expected+1 and latest.status=p_data->>'status' and latest.response_message_id is not distinct from nullif(p_data->>'response_message_id','')::uuid and latest.note=coalesce(p_data->>'note','') then return latest.revision;end if;
 if coalesce(latest.revision,1)<>expected then raise exception using errcode='40001',message='Review conflict';end if;
 insert into public.sales_hq_review(owner_id,inquiry_id,question_id,revision,status,response_message_id,note)
 values(auth.uid(),parent,p_id,expected+1,p_data->>'status',nullif(p_data->>'response_message_id','')::uuid,coalesce(p_data->>'note',''));
 return expected+1;
end $$;
revoke all on function public.sales_record_message(uuid,jsonb),public.sales_add_hq_question(uuid,jsonb),public.sales_review_hq_question(uuid,jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
