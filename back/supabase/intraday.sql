-- Hourly prices during market hours (Mon-Fri), kept for 7 days for the intraday "1D" chart.
-- Re-runnable: every statement is idempotent. Run after daily_snapshots.sql.

create table if not exists public.intraday_asset_prices (
  "assetId"   text        not null references public.assets(id) on delete cascade,
  ts          timestamptz not null,           -- start of the hour the price was taken
  "priceLocal" numeric    not null,
  currency    text        not null,
  "fxToEur"   numeric     not null,
  "priceEur"  numeric     not null,
  quantity    numeric     not null,
  "valueEur"  numeric     not null,
  "costEur"   numeric     not null,
  primary key ("assetId", ts)
);
create index if not exists intraday_asset_prices_ts_idx on public.intraday_asset_prices (ts);
alter table public.intraday_asset_prices enable row level security;

-- Refreshes today's prices (the regular daily job) and stores them as this hour's point.
create or replace function public.sync_intraday()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  v_hour  timestamptz := date_trunc('hour', now());
  v_sync  jsonb;
  v_rows  int;
begin
  v_sync := sync_daily_snapshots();

  insert into intraday_asset_prices as i
    ("assetId", ts, "priceLocal", currency, "fxToEur", "priceEur", quantity, "valueEur", "costEur")
  select s."assetId", v_hour, s."priceLocal", s.currency, s."fxToEur", s."priceEur", s.quantity, s."valueEur", s."costEur"
    from daily_asset_snapshots s
   where s.date = v_today
  on conflict ("assetId", ts) do update set
    "priceLocal" = excluded."priceLocal",
    currency     = excluded.currency,
    "fxToEur"    = excluded."fxToEur",
    "priceEur"   = excluded."priceEur",
    quantity     = excluded.quantity,
    "valueEur"   = excluded."valueEur",
    "costEur"    = excluded."costEur";
  get diagnostics v_rows = row_count;

  delete from intraday_asset_prices where ts < now() - interval '7 days';

  return v_sync || jsonb_build_object('intradayRows', v_rows, 'hour', v_hour);
end;
$$;

revoke all on function public.sync_intraday() from public, anon, authenticated;

-- Every hour from 06:00 to 21:00 UTC, Monday to Friday: 08:00-23:00 Madrid in summer,
-- 07:00-22:00 in winter. Covers the Spanish open to the US close.
select cron.unschedule('sync-intraday-prices') where exists (select 1 from cron.job where jobname = 'sync-intraday-prices');
select cron.schedule('sync-intraday-prices', '0 6-21 * * 1-5', 'select public.sync_intraday()');
