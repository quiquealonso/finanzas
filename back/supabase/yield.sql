-- Loan platforms (Mintos Core Loans...): the balance grows every day with an expected annual return
-- (compound, interest reinvested) and is corrected now and then with the real balance of the platform.
-- One unit starts worth 1 €: buying 3000 € = 3000 units; the unit price then grows with the return.
-- Each anchor fixes the unit price on a day ("saldo real" / start) and the rate used from then on.
-- Re-runnable: every statement is idempotent. Apply before re-running daily_snapshots.sql.

insert into public.asset_types (id, code, slug, name, "isLiquidity", "sortOrder", "createdAt", "updatedAt")
values ('atype_loans', 'LOANS', 'prestamos', 'Préstamos', false, 8, now(), now())
on conflict (code) do nothing;

create table if not exists public.yield_anchors (
  id              text    primary key default gen_random_uuid()::text,
  "assetId"       text    not null references public.assets(id) on delete cascade,
  date            date    not null,
  -- Value in EUR of one unit that day.
  price           numeric not null check (price > 0),
  -- Expected annual return from that day on, e.g. 8 = 8 %.
  "annualRatePct" numeric not null,
  unique ("assetId", date)
);
alter table public.yield_anchors enable row level security;

-- Unit price on a day: the latest anchor grown with its rate (null before the first anchor).
create or replace function public.yield_price(p_asset text, p_day date)
returns numeric
language sql
stable
set search_path = public
as $$
  select a.price * power(1 + a."annualRatePct" / 100, (p_day - a.date)::numeric / 365)
    from yield_anchors a
   where a."assetId" = p_asset and a.date <= p_day
   order by a.date desc
   limit 1
$$;

-- Writes the estimated price into the daily snapshots (and today's into the asset) of the assets with anchors.
create or replace function public.apply_yield_prices(p_asset text default null, p_from date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows  int;
  v_today date := (now() at time zone 'Europe/Madrid')::date;
begin
  update daily_asset_snapshots s
     set "priceLocal" = p.px,
         "priceEur"   = p.px,
         currency     = 'EUR',
         "fxToEur"    = 1,
         "valueEur"   = s.quantity * p.px,
         source       = 'accrual'
    from (
      select s2."assetId", s2.date, yield_price(s2."assetId", s2.date) as px
        from daily_asset_snapshots s2
       where s2."assetId" in (select distinct "assetId" from yield_anchors)
         and (p_asset is null or s2."assetId" = p_asset)
         and (p_from is null or s2.date >= p_from)
    ) p
   where s."assetId" = p."assetId" and s.date = p.date and p.px is not null;
  get diagnostics v_rows = row_count;

  update assets a
     set "marketPriceLocal" = yield_price(a.id, v_today),
         "marketPriceEur"   = yield_price(a.id, v_today),
         "lastPriceSyncAt"  = now()
   where a.id in (select distinct "assetId" from yield_anchors)
     and (p_asset is null or a.id = p_asset)
     and yield_price(a.id, v_today) is not null;

  return v_rows;
end;
$$;

revoke all on function public.apply_yield_prices(text, date) from public, anon, authenticated;
