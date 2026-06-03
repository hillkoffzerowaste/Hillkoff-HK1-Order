create table if not exists public.hk_app_store (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  synced_at timestamptz not null default now()
);

create table if not exists public.hk_orders (
  id text primary key,
  queue text,
  status text,
  created_at bigint,
  done_at bigint,
  canceled_at bigint,
  name text,
  size integer,
  qty integer,
  grind text,
  customer text,
  payload jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  synced_at timestamptz not null default now()
);

create table if not exists public.hk_products (
  name text primary key,
  size integer,
  payload jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  synced_at timestamptz not null default now()
);

create table if not exists public.hk_issues (
  id text primary key,
  created_at bigint,
  message text,
  payload jsonb not null default '{}'::jsonb,
  updated_at bigint not null default 0,
  synced_at timestamptz not null default now()
);

create index if not exists hk_orders_created_at_idx on public.hk_orders (created_at desc);
create index if not exists hk_orders_status_idx on public.hk_orders (status);
create index if not exists hk_issues_created_at_idx on public.hk_issues (created_at desc);

alter table public.hk_app_store enable row level security;
alter table public.hk_orders enable row level security;
alter table public.hk_products enable row level security;
alter table public.hk_issues enable row level security;

drop policy if exists hk_app_store_public_all on public.hk_app_store;
drop policy if exists hk_orders_public_all on public.hk_orders;
drop policy if exists hk_products_public_all on public.hk_products;
drop policy if exists hk_issues_public_all on public.hk_issues;
drop policy if exists hk_app_store_public_select on public.hk_app_store;
drop policy if exists hk_app_store_public_insert on public.hk_app_store;
drop policy if exists hk_app_store_public_update on public.hk_app_store;
drop policy if exists hk_orders_public_select on public.hk_orders;
drop policy if exists hk_orders_public_insert on public.hk_orders;
drop policy if exists hk_orders_public_update on public.hk_orders;
drop policy if exists hk_products_public_select on public.hk_products;
drop policy if exists hk_products_public_insert on public.hk_products;
drop policy if exists hk_products_public_update on public.hk_products;
drop policy if exists hk_issues_public_select on public.hk_issues;
drop policy if exists hk_issues_public_insert on public.hk_issues;
drop policy if exists hk_issues_public_update on public.hk_issues;

create policy hk_app_store_public_select on public.hk_app_store for select to anon, authenticated using (true);
create policy hk_app_store_public_insert on public.hk_app_store for insert to anon, authenticated with check (true);
create policy hk_app_store_public_update on public.hk_app_store for update to anon, authenticated using (true) with check (true);

create policy hk_orders_public_select on public.hk_orders for select to anon, authenticated using (true);
create policy hk_orders_public_insert on public.hk_orders for insert to anon, authenticated with check (true);
create policy hk_orders_public_update on public.hk_orders for update to anon, authenticated using (true) with check (true);

create policy hk_products_public_select on public.hk_products for select to anon, authenticated using (true);
create policy hk_products_public_insert on public.hk_products for insert to anon, authenticated with check (true);
create policy hk_products_public_update on public.hk_products for update to anon, authenticated using (true) with check (true);

create policy hk_issues_public_select on public.hk_issues for select to anon, authenticated using (true);
create policy hk_issues_public_insert on public.hk_issues for insert to anon, authenticated with check (true);
create policy hk_issues_public_update on public.hk_issues for update to anon, authenticated using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hk_orders'
  ) then
    alter publication supabase_realtime add table public.hk_orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hk_issues'
  ) then
    alter publication supabase_realtime add table public.hk_issues;
  end if;
end $$;
