-- VaakFlow — Supabase schema for the work-order store, escalation alerts,
-- and activity feed.
--
-- HOW TO USE: open the Supabase dashboard -> SQL Editor -> New query, paste
-- this whole file, and Run. It is idempotent (IF NOT EXISTS / OR REPLACE), so
-- you can re-run it safely. After running, set SUPABASE_URL + SUPABASE_KEY
-- (use the *service_role* key for the backend so writes bypass RLS) in
-- backend/.env, and the backend will switch from the in-memory mock to this DB.
--
-- The column names mirror the dicts the app already passes around (see
-- app/db/store.py / app/schemas.py) so SupabaseStore can read/write rows
-- without reshaping. Mock mode stays the default; this is only used when
-- both Supabase env vars are present and FORCE_MOCK is unset.

-- --------------------------------------------------------------------------- --
-- work_orders — the structured extraction target (one row per logged WO)
-- --------------------------------------------------------------------------- --
create table if not exists public.work_orders (
    work_order_id     text primary key,          -- e.g. "WO-1042" (app-generated)
    worker_id         text,
    asset_id          text,
    site_id           text,
    inspection_result text,                       -- pass | fail | partial
    fault_code        text,
    location          text,
    severity          text,                       -- low | medium | high | critical
    action_taken      text,
    parts_required    text[] default '{}',
    status            text default 'open',         -- open | in_progress | closed
    source_transcript text,
    confidence        double precision default 0,
    created_at        timestamptz default now(),
    updated_at        timestamptz
);

create index if not exists work_orders_created_at_idx on public.work_orders (created_at desc);
create index if not exists work_orders_status_idx     on public.work_orders (status);
create index if not exists work_orders_severity_idx   on public.work_orders (severity);
create index if not exists work_orders_site_idx       on public.work_orders (site_id);
create index if not exists work_orders_worker_idx     on public.work_orders (worker_id);

-- --------------------------------------------------------------------------- --
-- alerts — escalation alerts raised for high/critical faults
-- --------------------------------------------------------------------------- --
create table if not exists public.alerts (
    id            text primary key,               -- e.g. "AL-1" (app-generated)
    work_order_id text,
    asset_id      text,
    severity      text,
    message       text,
    created_at    timestamptz default now()
);

create index if not exists alerts_created_at_idx on public.alerts (created_at desc);

-- --------------------------------------------------------------------------- --
-- activity — the rolling activity feed (one row per turn/event)
-- --------------------------------------------------------------------------- --
create table if not exists public.activity (
    id         text primary key,                  -- e.g. "EV-1" (app-generated)
    worker_id  text,
    kind       text,                              -- inspection | query | action | escalation | clarify
    summary    text,
    transcript text,
    created_at timestamptz default now()
);

create index if not exists activity_created_at_idx on public.activity (created_at desc);

-- --------------------------------------------------------------------------- --
-- Realtime — let the dashboard subscribe to live inserts/updates.
-- The supabase_realtime publication already exists on a Supabase project;
-- adding a table that's already a member errors, so guard each add.
-- --------------------------------------------------------------------------- --
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'work_orders'
    ) then
        alter publication supabase_realtime add table public.work_orders;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'alerts'
    ) then
        alter publication supabase_realtime add table public.alerts;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'activity'
    ) then
        alter publication supabase_realtime add table public.activity;
    end if;
end $$;

-- --------------------------------------------------------------------------- --
-- Row Level Security
--   * anon (the dashboard's public key) may SELECT — read-only.
--   * writes go through the backend using the service_role key, which bypasses
--     RLS entirely, so no INSERT/UPDATE policy is granted to anon on purpose.
-- --------------------------------------------------------------------------- --
alter table public.work_orders enable row level security;
alter table public.alerts      enable row level security;
alter table public.activity    enable row level security;

drop policy if exists "anon read work_orders" on public.work_orders;
create policy "anon read work_orders" on public.work_orders
    for select to anon using (true);

drop policy if exists "anon read alerts" on public.alerts;
create policy "anon read alerts" on public.alerts
    for select to anon using (true);

drop policy if exists "anon read activity" on public.activity;
create policy "anon read activity" on public.activity
    for select to anon using (true);
