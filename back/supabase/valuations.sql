-- Valuations ("Valoraciones"): a weekly photo of the usual valuation metrics of every US listed company with
-- a market cap of 1,000 M$ or more, from SEC XBRL frames + Nasdaq screener (no API key). Written by
-- back/src/valuations.ts (weekly while the backend runs, or the "Actualizar" button).
-- Plus the user's own investment theses (per user).
-- Re-runnable: every statement is idempotent.

-- One row per photo.
create table if not exists public.valuation_runs (
  id          text        primary key default gen_random_uuid()::text,
  -- Day of the photo (Europe/Madrid). One per day: a re-run replaces it.
  "runDate"   date        not null unique,
  -- Latest complete quarter of the SEC data, e.g. 'CY2026Q3'.
  period      text        not null,
  companies   int         not null,
  "createdAt" timestamptz not null default now()
);

-- Every company of one photo. metrics = { pe, divYield, payout, pb, ps, evEbitda, fcfYield, roe, roic,
-- opMargin, netMargin, netDebtEbitda, revGrowth, epsGrowth, earningsYield, mom12 } (fractions, not %),
-- raw = the figures they come from (USD).
create table if not exists public.valuation_rows (
  "runId"       text    not null references public.valuation_runs(id) on delete cascade,
  symbol        text    not null,
  name          text    not null,
  sector        text,
  industry      text,
  "priceUsd"    numeric,
  "marketCapUsd" numeric not null,
  metrics       jsonb   not null,
  raw           jsonb   not null,
  primary key ("runId", symbol)
);
create index if not exists valuation_rows_symbol on public.valuation_rows (symbol);

-- The user's investment thesis on a company: why, bullish or bearish, target price, and the price when written.
create table if not exists public.investment_theses (
  id             text        primary key default gen_random_uuid()::text,
  "userId"       text        not null default public.app_user(),
  symbol         text        not null,
  name           text        not null,
  -- 1 bullish, -1 bearish, 0 watching.
  stance         smallint    not null default 1,
  thesis         text        not null default '',
  "targetPrice"  numeric,
  "priceAtWrite" numeric,
  "createdAt"    timestamptz not null default now(),
  "updatedAt"    timestamptz not null default now(),
  unique ("userId", symbol)
);

do $$
declare t text;
begin
  foreach t in array array['valuation_runs', 'valuation_rows'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists app_user_rows on public.%I', t);
    execute format('create policy app_user_rows on public.%I for all to finanzas_app using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to finanzas_app', t);
  end loop;
end $$;

alter table public.investment_theses enable row level security;
drop policy if exists app_user_rows on public.investment_theses;
create policy app_user_rows on public.investment_theses for all to finanzas_app
  using ("userId" = public.app_user()) with check ("userId" = public.app_user());
grant select, insert, update, delete on public.investment_theses to finanzas_app;
