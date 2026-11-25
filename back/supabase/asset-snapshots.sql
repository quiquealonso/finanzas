-- Per-asset version of sync_daily_snapshots (daily_snapshots.sql): fetches Yahoo prices and writes the daily
-- snapshots of SOME assets from p_from on, without touching the rest. Used by the back (portfolio.ts →
-- refreshSnapshots) when a movement goes further back than the stored history of its assets, and by the demo seed
-- (scripts/demo-seed.js). Before, those cases re-synced every asset of every user from that day.
-- Generated from sync_daily_snapshots by hand-checked replacements; keep both in step. Re-runnable.
create or replace function public.sync_asset_snapshots(p_assets text[], p_from date)
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
  -- Only these assets, from p_from: their price history starts there.
  v_start := p_from;
  v_from := least(p_from, v_today);

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
      and id = any(p_assets)
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
    and a.id = any(p_assets)
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
    source       = excluded.source
  -- Assets without a market price (perps, manual prices): a past day keeps the price it had that day. Without this,
  -- every run (hourly) wrote today's price on the last days too, and last week's result kept changing (2026-11-25).
  where not (excluded.source = 'manual' and s.source = 'manual' and s.date < v_today);
  get diagnostics v_rows = row_count;

  -- Assets with registered operations take their holdings from them (see portfolio_v2.sql).
  if to_regprocedure('public.apply_operation_holdings(text, date)') is not null then
    perform apply_operation_holdings(x, v_from) from unnest(p_assets) as x;
  end if;

  -- Loan platforms: estimated price from their anchors (see yield.sql).
  if to_regprocedure('public.apply_yield_prices(text, date)') is not null then
    perform apply_yield_prices(x, v_from) from unnest(p_assets) as x;
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
  where s."assetId" = a.id and s.date = v_today and s.source in ('yahoo', 'accrual') and a.id = any(p_assets);

  -- Latest rate of every currency, in both directions.
  insert into fx_rates (id, date, "fromCurrency", "toCurrency", rate, provider)
  select gen_random_uuid()::text, v_today::timestamp, x.from_cur::"Currency", x.to_cur::"Currency", x.rate, 'yahoo'
  from (select distinct on (f.cur) f.cur, f.per_eur from _sync_fx f order by f.cur, f.d desc) l
  cross join lateral (values ('EUR', l.cur, l.per_eur), (l.cur, 'EUR', 1 / l.per_eur)) as x(from_cur, to_cur, rate)
  on conflict (date, "fromCurrency", "toCurrency") do update set rate = excluded.rate, provider = excluded.provider;


  return jsonb_build_object(
    'from', v_from, 'to', v_today, 'rows', v_rows,
    'assetsOk', v_ok, 'assetsFailed', v_fail, 'errors', nullif(v_errors, '')
  );
end;
$$;

revoke all on function public.sync_asset_snapshots(text[], date) from public, anon, authenticated;
