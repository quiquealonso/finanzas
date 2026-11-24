-- Daily price collection that runs inside Supabase (pg_cron + http extension).
-- Re-runnable: every statement is idempotent.

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- One row per asset per day. Values in EUR are what the evolution charts use.
create table if not exists public.daily_asset_snapshots (
  "assetId"   text      not null references public.assets(id) on delete cascade,
  date        date      not null,
  quantity    numeric   not null,
  "priceLocal" numeric  not null,          -- price in the quote currency
  currency    text      not null,          -- quote currency (EUR/USD)
  "fxToEur"   numeric   not null,
  "priceEur"  numeric   not null,
  "valueEur"  numeric   not null,
  "costEur"   numeric   not null,
  source      text      not null,          -- yahoo | cash | manual
  "createdAt" timestamp not null default now(),
  primary key ("assetId", date)
);
create index if not exists daily_asset_snapshots_date_idx on public.daily_asset_snapshots (date);
alter table public.daily_asset_snapshots enable row level security;

create table if not exists public.price_sync_runs (
  id            bigserial   primary key,
  "startedAt"   timestamptz not null default now(),
  "finishedAt"  timestamptz,
  "fromDate"    date,
  "toDate"      date,
  "assetsOk"    int         not null default 0,
  "assetsFailed" int        not null default 0,
  errors        text
);
alter table public.price_sync_runs enable row level security;

-- Daily closes for one Yahoo symbol since p_from.
create or replace function public.yahoo_daily_closes(p_symbol text, p_from date)
returns table(d date, px numeric, cur text)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_resp   extensions.http_response;
  v_result jsonb;
  v_offset int;
begin
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');

  select * into v_resp from extensions.http((
    'GET',
    format(
      'https://query1.finance.yahoo.com/v8/finance/chart/%s?period1=%s&period2=%s&interval=1d',
      replace(p_symbol, '^', '%5E'),
      extract(epoch from p_from::timestamp)::bigint,
      extract(epoch from now())::bigint + 86400
    ),
    array[extensions.http_header('User-Agent', 'Mozilla/5.0')],
    null,
    null
  )::extensions.http_request);

  if v_resp.status <> 200 then
    raise exception 'Yahoo respondio HTTP %', v_resp.status;
  end if;

  v_result := (v_resp.content::jsonb) -> 'chart' -> 'result' -> 0;
  if v_result is null then
    raise exception 'Yahoo no devolvio datos';
  end if;

  v_offset := coalesce((v_result -> 'meta' ->> 'gmtoffset')::int, 0);

  -- London quotes come in pence (GBp / GBX); return them in pounds.
  -- Yahoo often leaves the close of the latest session empty in the daily series for a while, but
  -- reports it as regularMarketPrice: that price fills the day of regularMarketTime when it has no close.
  return query
    with closes as (
      select
        (to_timestamp(t.ts::bigint + v_offset) at time zone 'UTC')::date as d,
        c.val::text::numeric as px,
        t.i as ord
      from jsonb_array_elements_text(v_result -> 'timestamp') with ordinality as t(ts, i)
      join jsonb_array_elements(v_result -> 'indicators' -> 'quote' -> 0 -> 'close') with ordinality as c(val, i)
        using (i)
      where jsonb_typeof(c.val) = 'number'
    ), live as (
      select
        coalesce(
          (to_timestamp((v_result -> 'meta' ->> 'regularMarketTime')::bigint + v_offset) at time zone 'UTC')::date,
          (now() at time zone 'Europe/Madrid')::date
        ) as d,
        (v_result -> 'meta' ->> 'regularMarketPrice')::numeric as px,
        0::bigint as ord
      where (v_result -> 'meta' ->> 'regularMarketPrice') is not null
    ), merged as (
      select * from closes
      union all
      select * from live where not exists (select 1 from closes c2 where c2.d = live.d)
    )
    select distinct on (m.d)
      m.d,
      case when v_result -> 'meta' ->> 'currency' in ('GBp', 'GBX') then m.px / 100 else m.px end,
      case when v_result -> 'meta' ->> 'currency' in ('GBp', 'GBX') then 'GBP' else v_result -> 'meta' ->> 'currency' end
    from merged m
    order by m.d, m.ord desc;
end;
$$;

-- Fetches prices and writes snapshots from p_from (default: a few days before the
-- last stored snapshot, so gaps after a pause are filled) up to today.
create or replace function public.sync_daily_snapshots(p_from date default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_today  date := (now() at time zone 'Europe/Madrid')::date;
  v_last   date;
  v_from   date;
  v_run    bigint;
  v_ok     int := 0;
  v_fail   int := 0;
  v_errors text := '';
  v_eurusd numeric;
  v_cur    text;
  v_rows   int;
  v_asset  record;
  v_start  date;   -- first day of the whole history
begin
  select max(date) into v_last from daily_asset_snapshots;
  v_start := least(
    (select min(coalesce("purchasedAt", "createdAt"))::date from assets),
    (select min("occurredAt")::date from asset_operations),
    (select min(date) from daily_asset_snapshots)
  );
  v_from := coalesce(
    p_from,
    case when v_last is null
      then least(
        (select min(coalesce("purchasedAt", "createdAt"))::date from assets),
        (select min("occurredAt")::date from asset_operations)
      )
      else least(v_last - 3, v_today)
    end,
    v_today
  );

  insert into price_sync_runs ("fromDate", "toDate") values (v_from, v_today) returning id into v_run;

  create temp table if not exists _sync_px (asset_id text, d date, px numeric, cur text) on commit drop;
  -- per_eur: units of the currency per 1 EUR (EURUSD=X, EURGBP=X...)
  create temp table if not exists _sync_fx (cur text, d date, per_eur numeric) on commit drop;
  truncate _sync_px;
  truncate _sync_fx;
  -- Every snapshot row looks up "last close on or before this day": index those lookups.
  create index if not exists _sync_px_lookup on _sync_px (asset_id, d desc);
  create index if not exists _sync_fx_lookup on _sync_fx (cur, d desc);

  foreach v_cur in array array['USD', 'GBP'] loop
    begin
      insert into _sync_fx select v_cur, y.d, y.px from yahoo_daily_closes('EUR' || v_cur || '=X', v_from - 10) y;
    exception when others then
      v_errors := v_errors || 'EUR/' || v_cur || ': ' || sqlerrm || E'\n';
    end;
  end loop;

  for v_asset in
    select id, name, "marketSymbol" as sym
    from assets
    where coalesce(trim("marketSymbol"), '') <> ''
      and coalesce("marketProvider", 'yahoo') = 'yahoo'
  loop
    begin
      insert into _sync_px select v_asset.id, y.d, y.px, y.cur from yahoo_daily_closes(v_asset.sym, v_from - 10) y;
      v_ok := v_ok + 1;
    exception when others then
      -- One retry after 2 seconds: Yahoo sometimes times out on a single symbol.
      begin
        perform pg_sleep(2);
        insert into _sync_px select v_asset.id, y.d, y.px, y.cur from yahoo_daily_closes(v_asset.sym, v_from - 10) y;
        v_ok := v_ok + 1;
      exception when others then
        v_fail := v_fail + 1;
        v_errors := v_errors || v_asset.name || ' (' || v_asset.sym || '): ' || sqlerrm || E'\n';
      end;
    end;
  end loop;

  insert into daily_asset_snapshots as s
    ("assetId", date, quantity, "priceLocal", currency, "fxToEur", "priceEur", "valueEur", "costEur", source)
  select
    a.id,
    g.d,
    case when g.d < g.held_from then 0 else a.quantity end,
    p.px,
    p.cur,
    fx.to_eur,
    p.px * fx.to_eur,
    case when g.d < g.held_from then 0 else a.quantity * p.px * fx.to_eur end,
    case when g.d < g.held_from then 0 else a."investedCostEur" end,
    p.src
  from assets a
  join asset_types t on t.id = a."assetTypeId"
  -- Quoted assets keep a price history for the whole period (quantity 0 before they were held),
  -- so the monthly table can compare prices even before the purchase.
  cross join lateral (
    select least(
      coalesce(a."purchasedAt", a."createdAt")::date,
      (select min(o."occurredAt")::date from asset_operations o where o."assetId" = a.id)
    ) as held_from
  ) h
  cross join lateral (
    select gs::date as d, h.held_from
    from generate_series(
      greatest(v_from, case when coalesce(trim(a."marketSymbol"), '') <> '' then coalesce(v_start, h.held_from) else h.held_from end),
      v_today,
      interval '1 day'
    ) gs
  ) g
  left join lateral (
    select x.px, x.cur from _sync_px x
    where x.asset_id = a.id and x.d <= g.d
    order by x.d desc
    limit 1
  ) y on true
  -- Crowdfunding tickets (one unit each): invested amount plus simple interest accrued up to maturity.
  left join real_estate_details red
    on red."assetId" = a.id and red."startDate" is not null and red."termMonths" is not null
  left join lateral (
    select red."investedAmountEur" * (
      1 + red."expectedAnnualReturnPct" / 100
        * greatest(0, least(g.d, (red."startDate" + make_interval(months => red."termMonths"))::date) - red."startDate")::numeric / 365
    ) as px
  ) acc on red."assetId" is not null
  cross join lateral (
    select
      case when t."isLiquidity" then 1::numeric when y.px is not null then y.px when acc.px is not null then acc.px else a."marketPriceLocal" end as px,
      case when t."isLiquidity" or y.px is null then a.currency::text else coalesce(y.cur, a.currency::text) end as cur,
      case when t."isLiquidity" then 'cash' when y.px is not null then 'yahoo' when acc.px is not null then 'accrual' else 'manual' end as src
  ) p
  cross join lateral (
    select case
      when p.cur = 'EUR' then 1::numeric
      else 1 / coalesce(
        (select f.per_eur from _sync_fx f where f.cur = p.cur and f.d <= g.d order by f.d desc limit 1),
        (select r.rate from fx_rates r where r."fromCurrency" = 'EUR' and r."toCurrency"::text = p.cur order by r.date desc limit 1)
      )
    end as to_eur
  ) fx
  where fx.to_eur is not null
    -- Fully sold positions stop getting rows after their last operation.
    and not coalesce(
      a.quantity <= 0 and g.d > (select max(o."occurredAt")::date from asset_operations o where o."assetId" = a.id),
      false
    )
  -- Assets without operations hold their current position from their purchase date on;
  -- assets with operations are recomputed from them right after.
  on conflict ("assetId", date) do update set
    quantity     = excluded.quantity,
    "costEur"    = excluded."costEur",
    "priceLocal" = excluded."priceLocal",
    currency     = excluded.currency,
    "fxToEur"    = excluded."fxToEur",
    "priceEur"   = excluded."priceEur",
    "valueEur"   = excluded."valueEur",
    source       = excluded.source;
  get diagnostics v_rows = row_count;

  -- Assets with registered operations take their holdings from them (see portfolio_v2.sql).
  if to_regprocedure('public.apply_operation_holdings(text, date)') is not null then
    perform apply_operation_holdings(null, v_from);
  end if;

  -- Loan platforms: estimated price from their anchors (see yield.sql).
  if to_regprocedure('public.apply_yield_prices(text, date)') is not null then
    perform apply_yield_prices(null, v_from);
  end if;

  -- Keep the live position prices in sync with today's snapshot.
  select f.per_eur into v_eurusd from _sync_fx f where f.cur = 'USD' order by f.d desc limit 1;
  update assets a set
    "marketPriceEur"   = s."priceEur",
    "marketPriceLocal" = case
      when a.currency::text = s.currency then s."priceLocal"
      when a.currency = 'EUR' then s."priceEur"
      else s."priceEur" * coalesce((select f.per_eur from _sync_fx f where f.cur = a.currency::text order by f.d desc limit 1), 1)
    end,
    "lastPriceSyncAt"  = now()
  from daily_asset_snapshots s
  where s."assetId" = a.id and s.date = v_today and s.source in ('yahoo', 'accrual');

  -- Latest rate of every currency, in both directions.
  insert into fx_rates (id, date, "fromCurrency", "toCurrency", rate, provider)
  select gen_random_uuid()::text, v_today::timestamp, x.from_cur::"Currency", x.to_cur::"Currency", x.rate, 'yahoo'
  from (select distinct on (f.cur) f.cur, f.per_eur from _sync_fx f order by f.cur, f.d desc) l
  cross join lateral (values ('EUR', l.cur, l.per_eur), (l.cur, 'EUR', 1 / l.per_eur)) as x(from_cur, to_cur, rate)
  on conflict (date, "fromCurrency", "toCurrency") do update set rate = excluded.rate, provider = excluded.provider;

  update price_sync_runs
     set "finishedAt" = now(), "assetsOk" = v_ok, "assetsFailed" = v_fail, errors = nullif(v_errors, '')
   where id = v_run;

  return jsonb_build_object(
    'from', v_from, 'to', v_today, 'rows', v_rows,
    'assetsOk', v_ok, 'assetsFailed', v_fail, 'errors', nullif(v_errors, '')
  );
end;
$$;

revoke all on function public.sync_daily_snapshots(date) from public, anon, authenticated;
revoke all on function public.yahoo_daily_closes(text, date) from public, anon, authenticated;

-- Every night at 22:30 UTC (00:30 Madrid in summer, 23:30 in winter), after US close.
select cron.unschedule('sync-daily-prices') where exists (select 1 from cron.job where jobname = 'sync-daily-prices');
select cron.schedule('sync-daily-prices', '30 22 * * *', 'select public.sync_daily_snapshots()');
