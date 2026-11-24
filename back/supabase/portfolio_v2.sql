-- Operations become the source of truth for holdings, plus recurring monthly contributions.
-- Re-runnable: every statement is idempotent. Run after daily_snapshots.sql.

-- London listed shares (Wizz Air...) are booked in pounds.
alter type public."Currency" add value if not exists 'GBP';

-- kind: what the user did (buy, sell, deposit, withdraw, transfer_out, transfer_in, adjust, opening, recurring)
-- groupId links the legs of a single movement (e.g. a buy and the cash it took from the bank).
alter table public.asset_operations add column if not exists kind text;
alter table public.asset_operations add column if not exists "groupId" text;
alter table public.asset_operations add column if not exists "recurringId" text;
alter table public.asset_operations add column if not exists period text;
create index if not exists asset_operations_group_idx on public.asset_operations ("groupId");
create unique index if not exists asset_operations_recurring_period_key
  on public.asset_operations ("recurringId", period)
  where "recurringId" is not null;

create table if not exists public.recurring_contributions (
  id           text      primary key default gen_random_uuid()::text,
  "assetId"    text      not null references public.assets(id) on delete cascade,
  "amountEur"  numeric   not null check ("amountEur" > 0),
  "dayOfMonth" int       not null default 1 check ("dayOfMonth" between 1 and 28),
  "fromCash"   boolean   not null default false,
  "startMonth" text      not null,          -- YYYY-MM, first month it applies
  active       boolean   not null default true,
  note         text,
  "createdAt"  timestamp not null default now(),
  "updatedAt"  timestamp not null default now()
);
alter table public.recurring_contributions enable row level security;

-- Recomputes quantity / cost / value of the daily snapshots from the operations of
-- every asset that has operations. Assets without operations keep their stored quantity.
create or replace function public.apply_operation_holdings(p_asset text default null, p_from date default null)
returns int
language sql
security definer
set search_path = public
as $$
  with h as (
    select
      s."assetId",
      s.date,
      coalesce(sum(case when o."operationType" = 'BUY' then o.quantity else -o.quantity end), 0) as qty,
      coalesce(sum(case when o."operationType" = 'BUY' then o."netEur" else -o."costBasisEur" end), 0) as cost
    from daily_asset_snapshots s
    left join asset_operations o
      on o."assetId" = s."assetId" and o."occurredAt"::date <= s.date
    where s."assetId" in (select distinct "assetId" from asset_operations)
      and (p_asset is null or s."assetId" = p_asset)
      and (p_from is null or s.date >= p_from)
    group by s."assetId", s.date
  ), upd as (
    update daily_asset_snapshots s
       set quantity = h.qty,
           "costEur" = h.cost,
           "valueEur" = h.qty * s."priceEur"
      from h
     where s."assetId" = h."assetId" and s.date = h.date
    returning 1
  )
  select count(*)::int from upd;
$$;

revoke all on function public.apply_operation_holdings(text, date) from public, anon, authenticated;

-- Geographic split of each asset, e.g. {"US": 60, "EU": 17, "DEV": 23}. Null = derived from its type.
alter table public.assets add column if not exists regions jsonb;

-- Real estate crowdfunding tickets: value grows with simple interest from startDate until it matures.
alter table public.real_estate_details add column if not exists "startDate" date;
alter table public.real_estate_details add column if not exists "termMonths" int;

-- Months of a plan the user chose to skip (e.g. a month without saveback): they stop showing as pending.
alter table public.recurring_contributions add column if not exists "skippedPeriods" text[] not null default '{}';
