-- Foundation only. Apply to the NEW sp-sales-crm project, never legacy sp-crm.
-- No real data, Auth-user creation, client grants, keys or credentials.
begin;

create table public.sales_access (
    user_id uuid primary key references auth.users(id),
    enabled boolean not null default true,
    created_at timestamptz not null default now()
);
create table public.sales_customer (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id),
    name text not null check (length(btrim(name)) > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, owner_id)
);
create table public.sales_contact (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id),
    customer_id uuid not null,
    name text not null check (length(btrim(name)) > 0),
    contact_note text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (customer_id, owner_id) references public.sales_customer(id, owner_id),
    unique (id, customer_id, owner_id)
);
create table public.sales_project (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id),
    customer_id uuid not null,
    name text not null check (length(btrim(name)) > 0),
    description text not null default '',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (customer_id, owner_id) references public.sales_customer(id, owner_id),
    unique (id, customer_id, owner_id)
);
create table public.sales_inquiry (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id),
    customer_id uuid not null,
    contact_id uuid,
    project_id uuid,
    title text not null check (length(btrim(title)) > 0),
    channel text not null check (length(btrim(channel)) > 0),
    received_at timestamptz not null,
    original_text text not null check (length(btrim(original_text)) > 0),
    status text not null default 'new' check (status in (
      'new','product_search','need_hq_confirmation','waiting_for_hq',
      'customer_reply_needed','waiting_for_customer','closed'
    )),
    next_action text not null default '',
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    closed_at timestamptz,
    foreign key (customer_id, owner_id) references public.sales_customer(id, owner_id),
    foreign key (contact_id, customer_id, owner_id) references public.sales_contact(id, customer_id, owner_id),
    foreign key (project_id, customer_id, owner_id) references public.sales_project(id, customer_id, owner_id),
    check ((status='closed') = (closed_at is not null)),
    unique (id, owner_id)
);
create table public.sales_action (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id),
    inquiry_id uuid not null,
    kind text not null check (kind in (
      'customer_reply','hq_inquiry','hq_followup','customer_followup','other'
    )),
    description text not null check (length(btrim(description)) > 0),
    due_date date,
    status text not null default 'open' check (status in ('open','completed','cancelled')),
    mandatory boolean not null default true,
    waiting_target text,
    waiting_since timestamptz,
    completed_at timestamptz,
    cancel_reason text,
    revision integer not null default 1 check (revision > 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (inquiry_id, owner_id) references public.sales_inquiry(id, owner_id),
    check ((status='completed') = (completed_at is not null)),
    check (status <> 'cancelled' or coalesce(length(btrim(cancel_reason)),0) > 0)
);

create index sales_contact_customer on public.sales_contact(owner_id, customer_id);
create index sales_project_customer on public.sales_project(owner_id, customer_id);
create index sales_inquiry_dashboard on public.sales_inquiry(owner_id, status, received_at);
create index sales_inquiry_contact on public.sales_inquiry(owner_id, contact_id);
create index sales_inquiry_project on public.sales_inquiry(owner_id, project_id);
create index sales_action_inquiry on public.sales_action(owner_id, inquiry_id);
create index sales_action_due on public.sales_action(owner_id, due_date) where status='open';

alter table public.sales_access enable row level security;
revoke all on public.sales_access from public, anon, authenticated;
create policy sales_access_self_read on public.sales_access for select to authenticated
  using (user_id=(select auth.uid()) and enabled);

do $policies$
declare
    t text;
    predicate text := 'owner_id=(select auth.uid()) and exists (select 1 from public.sales_access a where a.user_id=(select auth.uid()) and a.enabled)';
begin
    foreach t in array array['sales_customer','sales_contact','sales_project','sales_inquiry','sales_action'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from public, anon, authenticated', t);
        execute format('create policy %I on public.%I for select to authenticated using (%s)', t||'_read', t, predicate);
        execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t||'_create', t, predicate);
        execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t||'_edit', t, predicate, predicate);
    end loop;
end
$policies$;

-- Keep client roles blocked until Auth provisioning and allow/deny tests pass.
-- Closure/action race rules and revision increments are subsequent work.
commit;
