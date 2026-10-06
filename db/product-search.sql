-- NEW sp-sales-crm only. Owner-isolated, versioned read-only catalogue and append-only review history.
begin;
create table public.sales_product (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 batch_id uuid not null, pn text not null, spec jsonb not null,
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 reviewed_on date not null, enabled boolean not null default true,
 created_at timestamptz not null default clock_timestamp(),
 unique(id,owner_id), unique(owner_id,batch_id,pn),
 check(spec->>'pn'=pn), check(jsonb_typeof(spec)='object')
);
create table public.sales_inquiry_product (
 id uuid primary key, owner_id uuid not null references auth.users(id),
 inquiry_id uuid not null, product_id uuid not null,
 disposition text not null check(disposition in ('candidate','selected','needs_confirmation','excluded')),
 reason text not null check(length(btrim(reason)) between 1 and 2000),
 snapshot jsonb not null, created_at timestamptz not null default clock_timestamp(),
 foreign key(inquiry_id,owner_id) references public.sales_inquiry(id,owner_id),
 foreign key(product_id,owner_id) references public.sales_product(id,owner_id)
);
create index sales_product_owner on public.sales_product(owner_id,enabled,pn);
create index sales_inquiry_product_history on public.sales_inquiry_product(owner_id,inquiry_id,created_at desc);
create index sales_inquiry_product_catalog on public.sales_inquiry_product(product_id,owner_id);
alter table public.sales_product enable row level security;
alter table public.sales_inquiry_product enable row level security;
revoke all on public.sales_product,public.sales_inquiry_product from public,anon,authenticated;
create policy sales_product_read on public.sales_product for select to authenticated using
 (owner_id=(select auth.uid()) and exists(select 1 from public.sales_access a where a.user_id=(select auth.uid()) and a.enabled));
create policy sales_inquiry_product_read on public.sales_inquiry_product for select to authenticated using
 (owner_id=(select auth.uid()) and exists(select 1 from public.sales_access a where a.user_id=(select auth.uid()) and a.enabled));
create policy sales_inquiry_product_create on public.sales_inquiry_product for insert to authenticated with check
 (owner_id=(select auth.uid()) and exists(select 1 from public.sales_access a where a.user_id=(select auth.uid()) and a.enabled));

create function public.sales_guard_product_link() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_state text; product public.sales_product;
begin
 if TG_OP<>'INSERT' then raise exception using errcode='23514',message='Append-only product review history';end if;
 select status into parent_state from public.sales_inquiry where id=new.inquiry_id and owner_id=new.owner_id for update;
 if not found then raise exception using errcode='42501',message='Inquiry access denied';end if;
 if parent_state='closed' then raise exception using errcode='23514',message='Inquiry already closed';end if;
 select * into product from public.sales_product where id=new.product_id and owner_id=new.owner_id and enabled;
 if not found then raise exception using errcode='42501',message='Product access denied';end if;
 new.snapshot:=jsonb_build_object('spec',product.spec,'batch_id',product.batch_id,'source_sha256',product.source_sha256,'reviewed_on',product.reviewed_on);
 new.created_at:=clock_timestamp();return new;
end $$;
create trigger sales_inquiry_product_guard before insert or update or delete on public.sales_inquiry_product for each row execute function public.sales_guard_product_link();

create function public.sales_link_product(p_inquiry_id uuid,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare uid uuid:=auth.uid(); rid uuid:=(p_data->>'id')::uuid; existing public.sales_inquiry_product;
begin
 if uid is null or not exists(select 1 from public.sales_access where user_id=uid and enabled) then raise exception using errcode='42501',message='Account access denied';end if;
 if jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('id','product_id','disposition','reason')) then raise exception using errcode='23514',message='Unknown product review fields';end if;
 perform 1 from public.sales_inquiry where id=p_inquiry_id and owner_id=uid for update;
 if not found then raise exception using errcode='42501',message='Inquiry access denied';end if;
 select * into existing from public.sales_inquiry_product where id=rid and owner_id=uid;
 if found then
  if existing.inquiry_id is distinct from p_inquiry_id or existing.product_id is distinct from (p_data->>'product_id')::uuid or existing.disposition is distinct from p_data->>'disposition' or existing.reason is distinct from p_data->>'reason' then raise exception using errcode='40001',message='Product review request conflict';end if;
  return rid;
 end if;
 insert into public.sales_inquiry_product(id,owner_id,inquiry_id,product_id,disposition,reason,snapshot)
 values(rid,uid,p_inquiry_id,(p_data->>'product_id')::uuid,p_data->>'disposition',p_data->>'reason','{}');
 return rid;
end $$;
revoke all on function public.sales_guard_product_link(),public.sales_link_product(uuid,jsonb) from public,anon,authenticated;
-- No grants here; final reviewed application file supplies them after confirmation.
commit;
