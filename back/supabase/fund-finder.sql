-- Fund finder ("Analizar mejores opciones" in Perfil de riesgo): the universe of funds it chooses from.
-- Shared market data (not per user), refreshed by back/src/fund-finder.ts:
--   - source 'cnmv': every Spanish-registered fund class from the CNMV quarterly files (FONDTRIM + FONDREGISTRO +
--     FONDCART), one class per fund compartment (the biggest).
--   - source 'yahoo': a short list of popular international index funds and ETFs (Vanguard, iShares, Amundi…),
--     metrics computed from their Yahoo daily prices.
-- Re-runnable: every statement is idempotent.
create table if not exists public.fund_universe (
  isin         text        primary key,
  source       text        not null,               -- cnmv | yahoo
  name         text        not null,
  manager      text,
  category     text,                               -- CNMV "vocación inversora" or our own label
  "assetClass" text        not null,               -- equity | mixed | bond | money | guaranteed | other
  -- Share of the portfolio per region: ES, EU, US, JP, CN, APAC, EM, LATAM (0..1, from the holdings' ISIN country).
  regions      jsonb       not null default '{}',
  -- true when the regions come from the name/category, not from the holdings.
  "regionGuess" boolean    not null default false,
  "ret1y"      numeric,                            -- last 12 months, fraction
  "ret3y"      numeric,                            -- yearly, last 3 years (yahoo only)
  vol          numeric,                            -- yearly volatility, fraction
  "maxDrawdown" numeric,                           -- yahoo only
  risk         int,                                -- 1..7 from the volatility (SRRI scale)
  ter          numeric,                            -- yearly total expense ratio, fraction
  aum          numeric,                            -- assets, EUR
  holders      int,
  symbol       text,                               -- Yahoo ticker (yahoo source)
  period       text,                               -- CNMV quarter (e.g. 202606) or day of the prices
  "updatedAt"  timestamptz not null default now()
);
create index if not exists fund_universe_risk on public.fund_universe (risk);
alter table public.fund_universe enable row level security;
drop policy if exists app_user_rows on public.fund_universe;
create policy app_user_rows on public.fund_universe for all to finanzas_app using (true) with check (true);
grant select, insert, update, delete on public.fund_universe to finanzas_app;
