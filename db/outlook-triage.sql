-- Incremental change for NEW glscckjmlwvxilzneqdf. Preserve originals and receipts.
begin;
alter table public.sales_outlook_mail add column excluded boolean not null default false;
alter table public.sales_outlook_mail add column triage_revision integer not null default 1 check(triage_revision>0);
alter table public.sales_outlook_mail add constraint sales_outlook_excluded_unlinked check(not excluded or state<>'linked');
grant update(excluded,triage_revision) on public.sales_outlook_mail to authenticated;
create or replace function public.sales_guard_outlook() returns trigger language plpgsql security invoker set search_path='' as $$
declare parent_state text;
begin
 if TG_OP='INSERT' then
  if new.state not in ('pending','held') or new.inquiry_id is not null or new.excluded or new.triage_revision<>1 then raise exception using errcode='23514',message='Review required';end if;
 elsif new.excluded is distinct from old.excluded then
  if old.state='linked' or new.triage_revision<>old.triage_revision+1 or (to_jsonb(new)-'excluded'-'triage_revision')<>(to_jsonb(old)-'excluded'-'triage_revision') then raise exception using errcode='23514',message='Preserve original and link';end if;
 else
  if old.state<>'pending' or old.excluded or new.state<>'linked' or new.inquiry_id is null then raise exception using errcode='23514',message='Restore before linking';end if;
  if (to_jsonb(new)-'state'-'inquiry_id')<>(to_jsonb(old)-'state'-'inquiry_id') then raise exception using errcode='23514',message='Preserve mail original';end if;
  select status into parent_state from public.sales_inquiry where id=new.inquiry_id and owner_id=new.owner_id for update;
  if not found or parent_state='closed' then raise exception using errcode='23514',message='Open owned inquiry required';end if;
 end if;
 return new;
end $$;
create function public.sales_triage_outlook(p_id uuid,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.sales_outlook_mail; target boolean; expected integer;
begin
 if auth.uid() is null or not exists(select 1 from public.sales_access where user_id=auth.uid() and enabled) then raise exception using errcode='42501',message='Not allowed';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_data))<>2 or not(p_data ?& array['excluded','revision']) or jsonb_typeof(p_data->'excluded') is distinct from 'boolean' or jsonb_typeof(p_data->'revision') is distinct from 'number' or (p_data->>'revision')!~'^[1-9][0-9]{0,9}$' then raise exception using errcode='23514',message='Explicit decision and revision required';end if;
 target:=(p_data->>'excluded')::boolean;
 if (p_data->>'revision')::numeric>2147483646 then raise exception using errcode='23514',message='Invalid revision';end if;
 expected:=(p_data->>'revision')::integer;
 select * into m from public.sales_outlook_mail where id=p_id and owner_id=auth.uid() for update;
 if not found then raise exception using errcode='42501',message='Mail unavailable';end if;
 if m.state='linked' then raise exception using errcode='23514',message='Linked mail preserved';end if;
 if m.excluded<>target then
  if m.triage_revision<>expected then raise exception using errcode='40001',message='Review decision changed';end if;
  update public.sales_outlook_mail set excluded=target,triage_revision=triage_revision+1 where id=m.id returning * into m;
 end if;
 return jsonb_build_object('id',m.id,'excluded',m.excluded,'triage_revision',m.triage_revision);
end $$;
revoke all on function public.sales_triage_outlook(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.sales_triage_outlook(uuid,jsonb) to authenticated;
commit;
