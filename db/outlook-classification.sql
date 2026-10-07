-- Incremental, NEW glscckjmlwvxilzneqdf only. Never alter original mail or inquiry state.
begin;
create table public.sales_outlook_proposal (
 id uuid primary key, mail_id uuid not null references public.sales_outlook_mail(id),
 owner_id uuid not null references auth.users(id),
 role text not null check(role in ('고객사 후보','HQ 후보','HQ 자동 알림 후보','업무 시스템','시스템','외부·관계 미확인','외부 매체','미확인')),
 category text not null check(category in ('고객 업무 후보','HQ 업무 후보','업무 알림','보안 알림','뉴스레터 후보','스팸 의심·확인 필요','판단 보류')),
 confidence text not null check(confidence in ('낮음','중간','높음')),
 evidence jsonb not null check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)<=15 and length(evidence::text)<=4000),
 customer_ref text check(length(customer_ref)<=200),
 rule_version text not null check(length(rule_version) between 1 and 100),
 created_at timestamptz not null default clock_timestamp()
);
create table public.sales_outlook_label (
 id uuid primary key, mail_id uuid not null references public.sales_outlook_mail(id),
 owner_id uuid not null references auth.users(id), revision integer not null check(revision>0),
 role text not null check(role in ('고객사','HQ','시스템','업무 시스템','외부 협력사','외부','미확인')),
 category text not null check(category in ('고객 업무','HQ 업무','외부 협력 업무','보안 알림','업무 알림','뉴스레터','광고','스팸','판단 보류')),
 created_at timestamptz not null default clock_timestamp(), unique(mail_id,revision)
);
create index sales_outlook_proposal_latest on public.sales_outlook_proposal(mail_id,created_at desc,id desc);
create index sales_outlook_proposal_owner on public.sales_outlook_proposal(owner_id);
create index sales_outlook_label_owner on public.sales_outlook_label(owner_id);
alter table public.sales_outlook_proposal enable row level security;
alter table public.sales_outlook_label enable row level security;
revoke all on public.sales_outlook_proposal,public.sales_outlook_label from public,anon,authenticated;
grant select on public.sales_outlook_proposal,public.sales_outlook_label to authenticated;
grant insert(id,mail_id,owner_id,role,category,confidence,evidence,customer_ref,rule_version) on public.sales_outlook_proposal to authenticated;
grant insert(id,mail_id,owner_id,revision,role,category) on public.sales_outlook_label to authenticated;
create policy sales_outlook_proposal_read on public.sales_outlook_proposal for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled));
create policy sales_outlook_proposal_insert on public.sales_outlook_proposal for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled)
 and exists(select 1 from public.sales_outlook_mail where id=mail_id and owner_id=(select auth.uid())));
create policy sales_outlook_label_read on public.sales_outlook_label for select to authenticated
 using(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled));
create policy sales_outlook_label_insert on public.sales_outlook_label for insert to authenticated
 with check(owner_id=(select auth.uid()) and exists(select 1 from public.sales_access where user_id=(select auth.uid()) and enabled)
 and exists(select 1 from public.sales_outlook_mail where id=mail_id and owner_id=(select auth.uid())));
create function public.sales_guard_outlook_label() returns trigger language plpgsql security invoker set search_path='' as $$
declare latest integer;
begin
 if new.owner_id is distinct from auth.uid() or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 perform 1 from public.sales_outlook_mail where id=new.mail_id and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='Mail unavailable';end if;
 select coalesce(max(revision),0) into latest from public.sales_outlook_label where mail_id=new.mail_id;
 if new.revision<>latest+1 then raise exception using errcode='40001',message='Classification changed';end if;
 return new;
end $$;
revoke all on function public.sales_guard_outlook_label() from public,anon,authenticated;
create trigger sales_outlook_label_guard before insert on public.sales_outlook_label for each row execute function public.sales_guard_outlook_label();
create function public.sales_propose_outlook(p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.sales_outlook_mail; old public.sales_outlook_proposal; request_id uuid; expected jsonb;
begin
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data))<>9 or not(p_data ?& array['id','scope_key','source_key','role','category','confidence','evidence','customer_ref','rule_version']) then raise exception using errcode='23514',message='Invalid proposal';end if;
 if jsonb_typeof(p_data->'role') is distinct from 'string' or jsonb_typeof(p_data->'category') is distinct from 'string' or jsonb_typeof(p_data->'confidence') is distinct from 'string' or jsonb_typeof(p_data->'rule_version') is distinct from 'string'
 or jsonb_typeof(p_data->'evidence') is distinct from 'array' or jsonb_typeof(p_data->'customer_ref') not in ('string','null') then raise exception using errcode='23514',message='Invalid proposal types';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'evidence') e where jsonb_typeof(e) is distinct from 'string' or length(e#>>'{}')>500) then raise exception using errcode='23514',message='Metadata evidence required';end if;
 request_id:=(p_data->>'id')::uuid;
 select * into m from public.sales_outlook_mail where owner_id=auth.uid() and scope_key=p_data->>'scope_key' and source_key=p_data->>'source_key' for update;
 if not found then raise exception using errcode='42501',message='Mail unavailable';end if;
 expected:=(p_data-'id'-'scope_key'-'source_key');
 select * into old from public.sales_outlook_proposal where id=request_id and owner_id=auth.uid();
 if found then
  if old.mail_id<>m.id or jsonb_build_object('role',old.role,'category',old.category,'confidence',old.confidence,'evidence',old.evidence,'customer_ref',old.customer_ref,'rule_version',old.rule_version)<>expected then raise exception using errcode='40001',message='Proposal request differs';end if;
 else
  insert into public.sales_outlook_proposal(id,mail_id,owner_id,role,category,confidence,evidence,customer_ref,rule_version)
  values(request_id,m.id,auth.uid(),p_data->>'role',p_data->>'category',p_data->>'confidence',p_data->'evidence',p_data->>'customer_ref',p_data->>'rule_version');
 end if;
 return jsonb_build_object('id',request_id,'mail_id',m.id,'source_key',m.source_key);
end $$;
create function public.sales_classify_outlook(p_id uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare old public.sales_outlook_label; latest integer; expected integer; request_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data))<>4 or not(p_data ?& array['id','revision','role','category']) or jsonb_typeof(p_data->'role') is distinct from 'string' or jsonb_typeof(p_data->'category') is distinct from 'string'
 or jsonb_typeof(p_data->'revision') is distinct from 'number' or (p_data->>'revision')!~'^(0|[1-9][0-9]{0,9})$' then raise exception using errcode='23514',message='Explicit classification required';end if;
 if (p_data->>'revision')::numeric>2147483646 then raise exception using errcode='23514',message='Invalid revision';end if;
 expected:=(p_data->>'revision')::integer;request_id:=(p_data->>'id')::uuid;
 perform 1 from public.sales_outlook_mail where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='Mail unavailable';end if;
 select * into old from public.sales_outlook_label where id=request_id and owner_id=auth.uid();
 if found then
  if old.mail_id<>p_id or old.revision<>expected+1 or old.role<>p_data->>'role' or old.category<>p_data->>'category' then raise exception using errcode='40001',message='Classification request differs';end if;
 else
  select coalesce(max(revision),0) into latest from public.sales_outlook_label where mail_id=p_id;
  if latest<>expected then raise exception using errcode='40001',message='Classification changed';end if;
  insert into public.sales_outlook_label(id,mail_id,owner_id,revision,role,category) values(request_id,p_id,auth.uid(),expected+1,p_data->>'role',p_data->>'category') returning * into old;
 end if;
 return jsonb_build_object('id',old.id,'mail_id',old.mail_id,'revision',old.revision,'role',old.role,'category',old.category);
end $$;
revoke all on function public.sales_propose_outlook(jsonb),public.sales_classify_outlook(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_propose_outlook(jsonb),public.sales_classify_outlook(uuid,jsonb) to authenticated;
create view public.sales_outlook_classified with(security_invoker=true) as
select m.id,m.owner_id,m.direction,m.subject,m.occurred_at,m.state,m.inquiry_id,m.body_length,m.created_at,m.excluded,m.triage_revision,
 case when p.id is not null then jsonb_build_object('id',p.id,'role',p.role,'category',p.category,'confidence',p.confidence,'evidence',p.evidence,'customer_ref',p.customer_ref,'rule_version',p.rule_version) end proposal,
 case when l.id is not null then jsonb_build_object('id',l.id,'role',l.role,'category',l.category,'revision',l.revision) end label,
 coalesce(l.revision,0) classification_revision,
 case when l.id is not null then 'confirmed' when p.id is not null then 'proposed' else 'none' end classification_state,
 case when l.id is not null then l.category when p.category like '스팸%' then '스팸' when p.id is not null then replace(p.category,' 후보','') else '미분류' end category_group
from public.sales_outlook_mail m
left join lateral (select * from public.sales_outlook_proposal where mail_id=m.id and owner_id=m.owner_id order by created_at desc,id desc limit 1) p on true
left join lateral (select * from public.sales_outlook_label where mail_id=m.id and owner_id=m.owner_id order by revision desc limit 1) l on true;
revoke all on public.sales_outlook_classified from public,anon,authenticated;
grant select on public.sales_outlook_classified to authenticated;
commit;
