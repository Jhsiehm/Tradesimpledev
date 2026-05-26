-- TradeSimple — Supabase schema
-- Run this in your Supabase project: SQL Editor → New query → paste → Run

-- ── PROFILES ─────────────────────────────────────────────────────────────────
-- Stores every user who has logged in (demo, Google, Apple).
-- id matches the session user.id ("google:12345", "apple:abc", "demo-user")
create table if not exists public.profiles (
  id          text        primary key,
  name        text,
  email       text,
  picture     text,
  provider    text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── WAITLIST ──────────────────────────────────────────────────────────────────
create table if not exists public.waitlist (
  id          uuid        primary key default gen_random_uuid(),
  email       text        unique not null,
  source      text        default 'landing',
  user_agent  text,
  created_at  timestamptz default now()
);

-- ── PORTFOLIOS ────────────────────────────────────────────────────────────────
-- One row per user. positions is a JSON array of { symbol, qty, avg_price, side }.
create table if not exists public.portfolios (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        references public.profiles(id) on delete cascade,
  positions   jsonb       not null default '[]'::jsonb,
  cash        numeric     not null default 100000,
  updated_at  timestamptz default now(),
  unique (user_id)
);

-- ── WATCHLISTS ────────────────────────────────────────────────────────────────
-- One row per user. symbols is a text array e.g. {"AAPL","NVDA","LMT"}.
create table if not exists public.watchlists (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        references public.profiles(id) on delete cascade,
  symbols     text[]      not null default '{}',
  updated_at  timestamptz default now(),
  unique (user_id)
);

-- ── ROW-LEVEL SECURITY ────────────────────────────────────────────────────────
-- The server uses the service-role key which bypasses RLS.
-- Enable RLS on each table anyway so the anon key can never read data directly.
alter table public.profiles   enable row level security;
alter table public.waitlist   enable row level security;
alter table public.portfolios enable row level security;
alter table public.watchlists enable row level security;

-- ── HELPER: auto-update updated_at ───────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create or replace trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace trigger trg_portfolios_updated_at
  before update on public.portfolios
  for each row execute function public.set_updated_at();

create or replace trigger trg_watchlists_updated_at
  before update on public.watchlists
  for each row execute function public.set_updated_at();
