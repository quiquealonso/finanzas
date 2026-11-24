-- Perpetual futures (perps) read from Hyperliquid with the public wallet address. No keys: read only.
-- MetaMask Perps runs on Hyperliquid, so the MetaMask address is the Hyperliquid account.
--
-- How a perp is held in the portfolio:
--   - One asset per coin (e.g. "BTC Perp"), type CRYPTO, bank "Cripto", currency USD, no market symbol.
--   - 1 unit = 1 USD of margin put in. Opening fills are BUYs of margin units (fees as the fee), closing fills
--     SELL units at (margin released + closed PnL) / margin released. So invested = margin + fees and the
--     realized result of a close is its closed PnL minus fees, with the existing FIFO logic.
--   - Value = margin + unrealized PnL (NOT the notional): marketPriceLocal = value / units.
--   - Funding and fees are also kept in perp_costs, to see the real cost of holding the position.
--
-- Written by back/src/hyperliquid.ts (button "Sincronizar") and by public.sync_hyperliquid_values() (pg_cron).
-- Leaves asset_operations unchanged: the external ids of imported operations live in external_operations.
-- Re-runnable: every statement is idempotent.

-- Accounts to read. Today one Hyperliquid address.
create table if not exists public.perp_accounts (
  address      text        primary key,
  source       text        not null default 'hyperliquid',
  -- Bank the perp assets are created in.
  "bankId"     text        not null references public.banks(id),
  "lastSyncAt" timestamptz,
  "lastError"  text,
  "createdAt"  timestamptz not null default now()
);
alter table public.perp_accounts enable row level security;

-- Dedupe of imported operations: one row per external id (source + externalId), pointing at the operation it created.
create table if not exists public.external_operations (
  source        text        not null,
  "externalId"  text        not null,
  "operationId" text        not null references public.asset_operations(id) on delete cascade,
  "assetId"     text        not null references public.assets(id) on delete cascade,
  "createdAt"   timestamptz not null default now(),
  primary key (source, "externalId")
);
create index if not exists external_operations_asset on public.external_operations ("assetId");
alter table public.external_operations enable row level security;

-- Live state of each perp asset (informative data; the value that counts is on the asset).
create table if not exists public.perp_positions (
  "assetId"          text        primary key references public.assets(id) on delete cascade,
  address            text        not null,
  coin               text        not null,
  -- 'long' | 'short' | 'closed'
  side               text        not null check (side in ('long', 'short', 'closed')),
  size               numeric     not null default 0,
  "notionalUsd"      numeric     not null default 0,
  "entryPx"          numeric,
  "markPx"           numeric,
  leverage           numeric,
  -- 'isolated' | 'cross'
  "leverageType"     text,
  "liquidationPx"    numeric,
  "marginUsd"        numeric     not null default 0,
  "unrealizedPnlUsd" numeric     not null default 0,
  -- margin + unrealized PnL: what the position adds to the net worth.
  "valueUsd"         numeric     not null default 0,
  "fundingSinceOpenUsd" numeric  not null default 0,
  "syncedAt"         timestamptz not null default now()
);
alter table public.perp_positions enable row level security;

-- Funding payments and fees, one row each. amountUsd < 0 = paid by you, > 0 = received.
create table if not exists public.perp_costs (
  source        text        not null,
  "externalId"  text        not null,
  "assetId"     text        references public.assets(id) on delete set null,
  coin          text        not null,
  -- 'funding' | 'fee' (exchange fee) | 'builder_fee' (fee of the app, e.g. MetaMask)
  kind          text        not null check (kind in ('funding', 'fee', 'builder_fee')),
  "amountUsd"   numeric     not null,
  "occurredAt"  timestamptz not null,
  primary key (source, "externalId")
);
create index if not exists perp_costs_asset on public.perp_costs ("assetId", "occurredAt");
alter table public.perp_costs enable row level security;

-- Periodic value refresh inside Supabase (no app needed): reads clearinghouseState of every account and updates
-- the live state and the unit price of the open perp assets. New fills (new positions, partial closes) are
-- imported by the app's sync (button, or the API call at start-up); this only keeps the value current.
create or replace function public.sync_hyperliquid_values()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acc record;
  v_res extensions.http_response;
  v_body jsonb;
  v_pos jsonb;
  v_coin text;
  v_asset text;
  v_size numeric;
  v_margin numeric;
  v_upnl numeric;
  v_value numeric;
  -- EUR per 1 USD, latest stored rate.
  v_fx numeric := (select rate from fx_rates where "fromCurrency" = 'USD' and "toCurrency" = 'EUR' order by date desc limit 1);
  v_updated int := 0;
  v_errors text := '';
begin
  for v_acc in select * from perp_accounts where source = 'hyperliquid' loop
    begin
      perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '20');
      select * into v_res from extensions.http((
        'POST', 'https://api.hyperliquid.xyz/info',
        array[extensions.http_header('Accept', 'application/json')],
        'application/json',
        jsonb_build_object('type', 'clearinghouseState', 'user', v_acc.address)::text
      )::extensions.http_request);
      if v_res.status <> 200 then raise exception 'HTTP %', v_res.status; end if;
      v_body := v_res.content::jsonb;

      -- Positions that are no longer open: value 0 until the app imports the closing fills.
      update perp_positions p set side = 'closed', size = 0, "notionalUsd" = 0, "marginUsd" = 0,
             "unrealizedPnlUsd" = 0, "valueUsd" = 0, "liquidationPx" = null, "syncedAt" = now()
       where p.address = v_acc.address and p.side <> 'closed'
         and not exists (select 1 from jsonb_array_elements(v_body -> 'assetPositions') x where x -> 'position' ->> 'coin' = p.coin);

      for v_pos in select x -> 'position' from jsonb_array_elements(v_body -> 'assetPositions') x loop
        v_coin := v_pos ->> 'coin';
        select "assetId" into v_asset from perp_positions where address = v_acc.address and coin = v_coin;
        continue when v_asset is null; -- new coin: the app sync creates its asset
        v_size := (v_pos ->> 'szi')::numeric;
        v_upnl := (v_pos ->> 'unrealizedPnl')::numeric;
        -- Isolated margin already includes the unrealized PnL; cross margin does not.
        v_margin := (v_pos ->> 'marginUsed')::numeric;
        v_value := case when v_pos -> 'leverage' ->> 'type' = 'isolated' then v_margin else v_margin + v_upnl end;
        update perp_positions set
          side = case when v_size > 0 then 'long' else 'short' end,
          size = abs(v_size),
          "notionalUsd" = (v_pos ->> 'positionValue')::numeric,
          "entryPx" = (v_pos ->> 'entryPx')::numeric,
          "markPx" = (v_pos ->> 'positionValue')::numeric / nullif(abs(v_size), 0),
          leverage = (v_pos -> 'leverage' ->> 'value')::numeric,
          "leverageType" = v_pos -> 'leverage' ->> 'type',
          "liquidationPx" = nullif(v_pos ->> 'liquidationPx', '')::numeric,
          "marginUsd" = case when v_pos -> 'leverage' ->> 'type' = 'isolated' then v_margin - v_upnl else v_margin end,
          "unrealizedPnlUsd" = v_upnl,
          "valueUsd" = v_value,
          "fundingSinceOpenUsd" = -coalesce((v_pos -> 'cumFunding' ->> 'sinceOpen')::numeric, 0),
          "syncedAt" = now()
        where "assetId" = v_asset;
        -- Unit price = value / units held.
        update assets set "marketPriceLocal" = v_value / quantity, "marketPriceEur" = v_value / quantity * v_fx,
               "lastPriceSyncAt" = now()
         where id = v_asset and quantity > 0;
        -- Today's snapshot follows the live value.
        update daily_asset_snapshots s set "priceLocal" = a."marketPriceLocal", "fxToEur" = v_fx,
               "priceEur" = a."marketPriceEur", "valueEur" = s.quantity * a."marketPriceEur"
          from assets a
         where s."assetId" = a.id and a.id = v_asset and s.date = (now() at time zone 'Europe/Madrid')::date;
        v_updated := v_updated + 1;
      end loop;
      update perp_accounts set "lastError" = null where address = v_acc.address;
    exception when others then
      v_errors := v_errors || v_acc.address || ': ' || sqlerrm || E'\n';
      update perp_accounts set "lastError" = sqlerrm where address = v_acc.address;
    end;
  end loop;
  return jsonb_build_object('updated', v_updated, 'errors', nullif(v_errors, ''));
end;
$$;
revoke all on function public.sync_hyperliquid_values() from public, anon, authenticated;

-- Every hour, and right before the nightly price job (22:30 UTC) so the daily snapshot has the fresh value.
select cron.unschedule('sync-hyperliquid-values') where exists (select 1 from cron.job where jobname = 'sync-hyperliquid-values');
select cron.schedule('sync-hyperliquid-values', '25 * * * *', 'select public.sync_hyperliquid_values()');
