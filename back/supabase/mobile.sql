-- Read-only API for the mobile app (Capacitor), called with supabase-js as RPC.
-- Only the owner's Supabase Auth user can call them; tables stay closed (RLS, no policies).
-- Figures follow GET /api/v2/overview of the local backend (back/src/portfolio.ts).
-- Re-runnable: every statement is idempotent. Run after portfolio_v2.sql and intraday.sql.

create or replace function public.mobile_owner_check()
returns void
language plpgsql
stable
set search_path = public
as $$
begin
  if auth.uid() is distinct from '74e4baaa-2e25-4839-8c3d-7724aebbe0f5'::uuid then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

-- Net worth now, today's change on the last close, total result and money pending reinvestment.
create or replace function public.mobile_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_total numeric;
  v_cost numeric;
  v_pending numeric;
  v_realized numeric;
  v_day numeric;
  v_close date;
begin
  perform mobile_owner_check();

  select coalesce(sum(round(a.quantity * a."marketPriceEur", 2)), 0),
         coalesce(sum(round(a."investedCostEur", 2)), 0),
         coalesce(sum(round(a.quantity * a."marketPriceEur", 2)) filter (where t."isLiquidity"), 0)
    into v_total, v_cost, v_pending
    from assets a join asset_types t on t.id = a."assetTypeId";

  select coalesce(sum(o."realizedPnlEur"), 0) into v_realized
    from asset_operations o
    join assets a on a.id = o."assetId"
    join asset_types t on t.id = a."assetTypeId"
   where o."operationType" = 'SELL' and not t."isLiquidity";

  -- Daily change per asset: latest price against the previous different one (non-trading days repeat
  -- the close). The latest close is the oldest day that already shows the latest price.
  with recent as (
    select s."assetId", s.date, s."priceLocal",
           row_number() over (partition by s."assetId" order by s.date desc) as rn,
           first_value(s."priceLocal") over (partition by s."assetId" order by s.date desc) as last_px
      from daily_asset_snapshots s
     where s.date >= current_date - 15 and s.source in ('yahoo', 'accrual')
  ), prev as (
    select distinct on ("assetId") "assetId", rn, "priceLocal" as prev_px, last_px
      from recent
     where abs("priceLocal" - last_px) > 1e-12
     order by "assetId", rn
  ), moves as (
    select p."assetId", p.last_px / p.prev_px - 1 as pct,
           (select r.date from recent r where r."assetId" = p."assetId" and r.rn = p.rn - 1) as close_day
      from prev p
     where p.prev_px <> 0
  )
  select coalesce(sum(case when m.pct <> 0
                           then round(round(a.quantity * a."marketPriceEur", 2) * (1 - 1 / (1 + m.pct)), 2) end), 0),
         max(m.close_day) filter (where t.code in ('STOCK', 'ETF', 'FUND'))
    into v_day, v_close
    from moves m
    join assets a on a.id = m."assetId"
    join asset_types t on t.id = a."assetTypeId";

  return jsonb_build_object(
    'asOf', (now() at time zone 'Europe/Madrid')::date,
    'lastCloseDay', v_close,
    'totalEur', v_total,
    'dayChangeEur', v_day,
    'dayChangePct', case when v_total - v_day > 0 then v_day / (v_total - v_day) else 0 end,
    'pnlEur', round(v_total - v_cost + v_realized, 2),
    'pnlPct', case when v_cost - v_realized > 0 then (v_total - v_cost + v_realized) / (v_cost - v_realized) else 0 end,
    'pendingEur', v_pending,
    'updatedAt', (select max("finishedAt") from price_sync_runs)
  );
end;
$$;

-- Chart points. p_range: '1D' (hourly points of the latest day, from the close before), '1S' (7 days),
-- '1M' (30 days), 'YTD' (since 1 January). realized = cumulative result of sales up to each point.
create or replace function public.mobile_series(p_range text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last date;
  v_from date;
  v_day date;
  v_realized numeric;
  v_prev_realized numeric;
  v_points jsonb;
  v_prev jsonb;
begin
  perform mobile_owner_check();

  if p_range = '1D' then
    select max((ts at time zone 'Europe/Madrid')::date) into v_day from intraday_asset_prices;
    -- Sales realized up to that day, and up to the close before it (the first point of the chart).
    select coalesce(sum(o."realizedPnlEur") filter (where o."occurredAt"::date <= v_day), 0),
           coalesce(sum(o."realizedPnlEur") filter (where o."occurredAt"::date < v_day), 0)
      into v_realized, v_prev_realized
      from asset_operations o join assets a on a.id = o."assetId" join asset_types t on t.id = a."assetTypeId"
     where o."operationType" = 'SELL' and not t."isLiquidity";
    if v_day is not null then
      select coalesce(jsonb_agg(jsonb_build_object('t', ts, 'value', round(value, 2), 'cost', round(cost, 2), 'realized', v_realized) order by ts), '[]')
        into v_points
        from (select ts, sum("valueEur") as value, sum("costEur") as cost
                from intraday_asset_prices
               where (ts at time zone 'Europe/Madrid')::date = v_day
               group by ts) h;
      select jsonb_build_object('t', date, 'value', round(value, 2), 'cost', round(cost, 2), 'realized', v_prev_realized, 'close', true)
        into v_prev
        from (select date, sum("valueEur") as value, sum("costEur") as cost
                from daily_asset_snapshots where date < v_day
               group by date order by date desc limit 1) c;
      return jsonb_build_object('range', p_range, 'points',
        case when v_prev is null then v_points else jsonb_build_array(v_prev) || v_points end);
    end if;
    -- No hourly points yet: fall back to the last week of closes.
    p_range := '1S';
  end if;

  select max(date) into v_last from daily_asset_snapshots;
  v_from := case p_range
              when '1S' then v_last - 7
              when '1M' then v_last - 30
              when 'YTD' then date_trunc('year', v_last)::date
              else v_last - 7
            end;

  with d as (
    select date, sum("valueEur") as value, sum("costEur") as cost
      from daily_asset_snapshots where date >= v_from group by date
  ), sales as (
    select o."occurredAt"::date as day, sum(o."realizedPnlEur") as pnl
      from asset_operations o
      join assets a on a.id = o."assetId"
      join asset_types t on t.id = a."assetTypeId"
     where o."operationType" = 'SELL' and not t."isLiquidity"
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           't', d.date, 'value', round(d.value, 2), 'cost', round(d.cost, 2),
           'realized', coalesce((select sum(s.pnl) from sales s where s.day <= d.date), 0)
         ) order by d.date), '[]')
    into v_points
    from d;

  return jsonb_build_object('range', p_range, 'points', v_points);
end;
$$;

revoke all on function public.mobile_owner_check() from public, anon;
revoke all on function public.mobile_summary() from public, anon;
revoke all on function public.mobile_series(text) from public, anon;
grant execute on function public.mobile_owner_check() to authenticated;
grant execute on function public.mobile_summary() to authenticated;
grant execute on function public.mobile_series(text) to authenticated;
