-- FCA Stock Room: tables
-- Every write goes through the functions in 0002_functions.sql, which check
-- the user's role. Tables are read-only for signed-in users (see 0003_rls.sql).

create extension if not exists pgcrypto;

create type public.fca_role as enum ('admin', 'boss', 'manager', 'staff', 'viewer');

create table public.members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  email      text not null default '',
  photo      text not null default '',
  role       public.fca_role not null default 'staff',
  last_seen  timestamptz,
  created_at timestamptz not null default now()
);

create table public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  size       text not null default '' check (length(size) <= 40),
  category   text not null check (category in ('Print Media', 'Flexi Banner', 'Stands & Frames', 'Ink & Solvent')),
  unit       text not null check (unit in ('Rolls', 'Sheets', 'Pcs', 'Boxes', 'Bags', 'Litres', 'Metres')),
  qty        numeric(12, 3) not null default 0 check (qty >= 0),
  min_level  numeric(12, 3) not null default 0 check (min_level >= 0),
  note       text not null default '' check (length(note) <= 500),
  sort       integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Weekly stock-take history (one count per item per day).
create table public.counts (
  item_id uuid not null references public.items (id) on delete cascade,
  date    date not null,
  qty     numeric(12, 3) not null check (qty >= 0),
  primary key (item_id, date)
);

-- Movement log. Never deleted; mistakes are voided.
-- id is generated on the device so a change queued offline is saved exactly once.
create table public.moves (
  id         uuid primary key,
  at         timestamptz not null default now(),
  type       text not null check (type in ('in', 'out', 'adjust', 'count', 'created', 'removed', 'edit', 'void')),
  item_id    uuid references public.items (id),
  item_name  text not null default '',
  unit       text not null default '',
  delta      numeric(12, 3) not null default 0,
  metres     numeric(12, 2),
  balance    numeric(12, 3),
  client     text not null default '' check (length(client) <= 120),
  job        text not null default '' check (length(job) <= 120),
  note       text not null default '' check (length(note) <= 500),
  user_id    uuid references auth.users (id),
  user_name  text not null default '',
  voided     boolean not null default false,
  voided_by  uuid references auth.users (id),
  voided_at  timestamptz,
  void_of    uuid references public.moves (id)
);
create index moves_at_idx on public.moves (at desc);
create index moves_item_idx on public.moves (item_id, at desc);

create table public.requests (
  id                uuid primary key,
  created_at        timestamptz not null default now(),
  item_id           uuid not null references public.items (id),
  item_name         text not null default '',
  qty               numeric(12, 3) not null check (qty > 0),
  unit              text not null default '',
  client            text not null default '' check (length(client) <= 120),
  job               text not null default '' check (length(job) <= 120),
  note              text not null default '' check (length(note) <= 500),
  requested_by      uuid references auth.users (id),
  requested_by_name text not null default '',
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by        uuid references auth.users (id),
  decided_by_name   text not null default '',
  decided_at        timestamptz,
  move_id           uuid references public.moves (id)
);
create index requests_status_idx on public.requests (status, created_at desc);

create table public.reports (
  id         text primary key, -- YYYY-MM-DD in Africa/Kigali
  date       date not null,
  text       text not null,
  created_at timestamptz not null default now(),
  source     text not null check (source in ('scheduled', 'manual'))
);

-- One row per saved stock take, so a stock take sent twice (offline retry) is applied once.
create table public.stock_takes (
  id         uuid primary key,
  date       date not null,
  changed    integer not null default 0,
  user_id    uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- Browser push subscriptions (phones and desktop browsers).
create table public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- AI assistant rate limiting.
create table public.ai_usage (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index ai_usage_user_at_idx on public.ai_usage (user_id, at desc);

-- Live updates for every open device.
alter publication supabase_realtime add table public.items, public.counts, public.moves, public.requests, public.reports, public.members;
