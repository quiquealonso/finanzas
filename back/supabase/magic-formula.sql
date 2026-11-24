-- Magic Formula screen (Joel Greenblatt, "The Little Book That Still Beats the Market").
-- Written by back/scripts/magic-formula.js (weekly, in the Thursday news task), read by GET /api/v2/magic-formula.
-- Re-runnable: every statement is idempotent.

-- One row per run of the screen.
create table if not exists public.magic_formula_runs (
  id            text        primary key default gen_random_uuid()::text,
  -- Day the screen ran (Europe/Madrid). One run per day: a re-run replaces it.
  "runDate"     date        not null unique,
  -- Smallest market cap allowed in the universe, in USD.
  "minCapUsd"   numeric     not null,
  -- Companies that had all the data and entered the ranking.
  "universe"    int         not null,
  -- Latest quarter of the earnings used, e.g. 'CY2026Q3'.
  "period"      text        not null,
  "createdAt"   timestamptz not null default now()
);
alter table public.magic_formula_runs enable row level security;

-- The top companies of one run, best first.
create table if not exists public.magic_formula_picks (
  id              text    primary key default gen_random_uuid()::text,
  "runId"         text    not null references public.magic_formula_runs(id) on delete cascade,
  -- 1 = best (lowest sum of the two ranks).
  rank            int     not null,
  symbol          text    not null,
  name            text    not null,
  sector          text,
  industry        text,
  "marketCapUsd"  numeric not null,
  "priceUsd"      numeric,
  -- Trailing twelve months operating income (EBIT), USD.
  "ebitUsd"       numeric not null,
  -- Enterprise value: market cap + debt - cash, USD.
  "evUsd"         numeric not null,
  -- EBIT / EV.
  "earningsYield" numeric not null,
  -- EBIT / (net working capital + net fixed assets).
  "roc"           numeric not null,
  "rankEy"        int     not null,
  "rankRoc"       int     not null,
  -- true = EBIT from the last full year only (no recent quarters found).
  "annualOnly"    boolean not null default false,
  unique ("runId", symbol)
);
create index if not exists magic_formula_picks_run on public.magic_formula_picks ("runId", rank);
alter table public.magic_formula_picks enable row level security;
