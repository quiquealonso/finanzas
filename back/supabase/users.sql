-- Users. Every table with personal data belongs to one user, directly ("userId") or through its asset, bank,
-- section or betting house. Row level security shows each user only their rows; the app switches to the role
-- finanzas_app and sets app.user_id in every query (back/src/prisma.ts). The database owner (postgres: nightly
-- price jobs, scripts) bypasses it and sees everybody: prices are shared, one sync updates every user's assets.
-- Shared tables (asset types, FX rates, price sync runs, magic formula) are readable and writable by everybody.
-- Re-runnable: every statement is idempotent.

set statement_timeout = 0;
set lock_timeout = '60s';

create table if not exists public.users (
  id          text        primary key,
  name        text        not null,
  "createdAt" timestamptz not null default now()
);
alter table public.users enable row level security;
insert into public.users (id, name) values ('user1', 'Usuario 1'), ('user2', 'Usuario 2') on conflict (id) do nothing;

-- The user of the current query (set by the app); existing rows and jobs without it belong to user1.
create or replace function public.app_user() returns text
language sql stable
as $$ select coalesce(nullif(current_setting('app.user_id', true), ''), 'user1') $$;

-- Role the app works as: no login of its own, postgres switches to it inside each query's transaction.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'finanzas_app') then
    create role finanzas_app nologin;
  end if;
end $$;
grant finanzas_app to postgres;
grant usage on schema public to finanzas_app;
grant select, insert, update, delete on all tables in schema public to finanzas_app;
grant usage, select on all sequences in schema public to finanzas_app;
grant execute on all functions in schema public to finanzas_app;
alter default privileges in schema public grant select, insert, update, delete on tables to finanzas_app;
alter default privileges in schema public grant usage, select on sequences to finanzas_app;
alter default privileges in schema public grant execute on functions to finanzas_app;
-- Downloads prices through the http extension: run as its owner.
alter function public.yahoo_daily_closes(text, date) security definer set search_path = public, extensions, pg_temp;

-- Owner column on the tables that don't hang from another user table.
do $$
declare t text;
begin
  foreach t in array array['banks', 'assets', 'betting_houses', 'goals', 'closing_sections', 'allocation_targets',
                           'news_items', 'news_digests', 'perp_accounts', 'wallet_accounts', 'wallet_tokens',
                           'wallet_balances', 'monthly_portfolio_snapshots', 'weekly_portfolio_snapshots'] loop
    execute format('alter table public.%I add column if not exists "userId" text not null default public.app_user() references public.users(id)', t);
    execute format('create index if not exists %I on public.%I ("userId")', t || '_user_idx', t);
  end loop;
end $$;

-- Names unique per user, not globally.
alter table public.banks drop constraint if exists banks_name_key;
drop index if exists public.banks_name_key;
create unique index if not exists banks_user_name_key on public.banks ("userId", name);
drop index if exists public.betting_houses_name_key;
create unique index if not exists betting_houses_user_name_key on public.betting_houses ("userId", name);
alter table public.news_items drop constraint if exists news_items_url_key;
create unique index if not exists news_items_user_url_key on public.news_items ("userId", url);
alter table public.news_digests drop constraint if exists "news_digests_weekStart_key";
create unique index if not exists news_digests_user_week_key on public.news_digests ("userId", "weekStart");

-- Policies for finanzas_app. (Supabase's anon/authenticated roles still get nothing: no policy for them.)
do $$
declare
  t text;
  owned text[] := array['banks', 'assets', 'betting_houses', 'goals', 'closing_sections', 'allocation_targets',
                        'news_items', 'news_digests', 'perp_accounts', 'wallet_accounts', 'wallet_tokens',
                        'wallet_balances', 'monthly_portfolio_snapshots', 'weekly_portfolio_snapshots'];
  by_asset text[] := array['asset_operations', 'asset_price_history', 'asset_price_sync_logs', 'daily_asset_snapshots',
                           'intraday_asset_prices', 'real_estate_details', 'recurring_contributions', 'yield_anchors',
                           'external_operations', 'perp_costs', 'perp_positions'];
  shared text[] := array['asset_types', 'fx_rates', 'price_sync_runs', 'magic_formula_runs', 'magic_formula_picks'];
  rule text;
begin
  foreach t in array owned || by_asset || shared || array['transfers', 'closing_rows', 'betting_transactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists app_user_rows on public.%I', t);
    rule := case
      when t = any(owned) then '"userId" = public.app_user()'
      when t = any(by_asset) then '"assetId" in (select id from public.assets)'
      when t = 'transfers' then '"sourceAssetId" in (select id from public.assets)'
      when t = 'closing_rows' then '"sectionId" in (select id from public.closing_sections)'
      when t = 'betting_transactions' then '"bettingHouseId" in (select id from public.betting_houses)'
      else 'true'
    end;
    execute format('create policy app_user_rows on public.%I for all to finanzas_app using (%s) with check (%s)', t, rule, rule);
  end loop;
end $$;

-- users: the app only sees its own row (name for the mail import), and never writes it. Login, registration and
-- passwords go through the owner connection (src/auth.ts, scripts/set-password.js).
alter table public.users enable row level security;
drop policy if exists app_user_rows on public.users;
create policy app_user_rows on public.users for select to finanzas_app using (id = public.app_user());
revoke insert, update, delete on public.users from finanzas_app;

-- Copies every row of a user to another one (the second user starts with the same investments). New ids are the
-- old ones with a prefix ("user2_..."), so links between tables keep working. Crypto wallets and Hyperliquid
-- accounts are not copied: they read real addresses and would sync twice. Run once; it refuses if the target
-- already has banks.
create or replace function public.clone_user_data(p_from text, p_to text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  pre text := p_to || '_';
  spec record;
  cols text;
  vals text;
begin
  if exists (select 1 from banks where "userId" = p_to) then
    raise exception 'El usuario % ya tiene datos', p_to;
  end if;
  for spec in
    select * from (values
      -- table, id-like columns to prefix, rows of the source user
      (1,  'banks',                       array['id'],                                    '"userId" = $1'),
      (2,  'assets',                      array['id', 'bankId'],                          '"userId" = $1'),
      (3,  'real_estate_details',         array['assetId'],                               '"assetId" in (select id from assets where "userId" = $1)'),
      (4,  'recurring_contributions',     array['id', 'assetId'],                         '"assetId" in (select id from assets where "userId" = $1)'),
      (5,  'asset_operations',            array['id', 'assetId', 'groupId', 'recurringId'], '"assetId" in (select id from assets where "userId" = $1)'),
      (6,  'daily_asset_snapshots',       array['assetId'],                               '"assetId" in (select id from assets where "userId" = $1)'),
      (7,  'intraday_asset_prices',       array['assetId'],                               '"assetId" in (select id from assets where "userId" = $1)'),
      (8,  'asset_price_history',         array['id', 'assetId'],                         '"assetId" in (select id from assets where "userId" = $1)'),
      (9,  'asset_price_sync_logs',       array['id', 'assetId'],                         '"assetId" in (select id from assets where "userId" = $1)'),
      (10, 'yield_anchors',               array['id', 'assetId'],                         '"assetId" in (select id from assets where "userId" = $1)'),
      (11, 'transfers',                   array['id', 'sourceAssetId', 'targetAssetId'],  '"sourceAssetId" in (select id from assets where "userId" = $1)'),
      (12, 'external_operations',         array['externalId', 'operationId', 'assetId'],  '"assetId" in (select id from assets where "userId" = $1)'),
      (13, 'perp_positions',              array['assetId'],                               '"assetId" in (select id from assets where "userId" = $1)'),
      (14, 'perp_costs',                  array['externalId', 'assetId'],                 '"assetId" in (select id from assets where "userId" = $1)'),
      (15, 'betting_houses',              array['id'],                                    '"userId" = $1'),
      (16, 'betting_transactions',        array['id', 'bettingHouseId'],                  '"bettingHouseId" in (select id from betting_houses where "userId" = $1)'),
      (17, 'goals',                       array['id'],                                    '"userId" = $1'),
      (18, 'closing_sections',            array['id', 'bankId'],                          '"userId" = $1'),
      (19, 'closing_rows',                array['id', 'sectionId', 'assetId', 'bankId'],  '"sectionId" in (select id from closing_sections where "userId" = $1)'),
      (20, 'allocation_targets',          array['id', 'assetId'],                         '"userId" = $1'),
      (21, 'news_digests',                array['id'],                                    '"userId" = $1'),
      (22, 'news_items',                  array['id', 'assetId'],                         '"userId" = $1'),
      (23, 'monthly_portfolio_snapshots', array['id', 'bankId'],                          '"userId" = $1'),
      (24, 'weekly_portfolio_snapshots',  array['id', 'bankId'],                          '"userId" = $1')
    ) as s(pos, tbl, ids, src)
    order by pos
  loop
    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position),
           string_agg(case
                        when c.column_name = 'userId' then '$2'
                        when c.column_name = any(spec.ids) then format('case when %1$I is null then null else $3 || %1$I end', c.column_name)
                        else format('%I', c.column_name)
                      end, ', ' order by c.ordinal_position)
      into cols, vals
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = spec.tbl;
    execute format('insert into public.%I (%s) select %s from public.%I where %s', spec.tbl, cols, vals, spec.tbl, spec.src)
      using p_from, p_to, pre;
  end loop;
end $$;
revoke all on function public.clone_user_data(text, text) from public, anon, authenticated, finanzas_app;

-- Deletes every row of a user (the user itself stays, empty). Children first. Refuses user1 (the real data).
create or replace function public.delete_user_data(p_user text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  assets_of text := 'select id from assets where "userId" = $1';
  t text;
begin
  if p_user = 'user1' then
    raise exception 'user1 tiene los datos reales: no se borra';
  end if;
  delete from pending_orders where "userId" = p_user;
  delete from investment_theses where "userId" = p_user;
  delete from mail_import_state where "userId" = p_user;
  delete from risk_profiles where "userId" = p_user;
  delete from saved_funds where "userId" = p_user;
  delete from news_items where "userId" = p_user;
  delete from news_digests where "userId" = p_user;
  delete from closing_rows where "sectionId" in (select id from closing_sections where "userId" = p_user);
  delete from closing_sections where "userId" = p_user;
  delete from allocation_targets where "userId" = p_user;
  delete from goals where "userId" = p_user;
  delete from betting_transactions where "bettingHouseId" in (select id from betting_houses where "userId" = p_user);
  delete from betting_houses where "userId" = p_user;
  execute 'delete from transfers where "sourceAssetId" in (' || assets_of || ') or "targetAssetId" in (' || assets_of || ')' using p_user;
  foreach t in array array['perp_costs', 'perp_positions', 'external_operations', 'yield_anchors', 'asset_price_sync_logs',
                           'asset_price_history', 'intraday_asset_prices', 'daily_asset_snapshots', 'asset_operations',
                           'recurring_contributions', 'real_estate_details'] loop
    execute format('delete from %I where "assetId" in (%s)', t, assets_of) using p_user;
  end loop;
  delete from wallet_balances where "userId" = p_user;
  delete from wallet_tokens where "userId" = p_user;
  delete from wallet_accounts where "userId" = p_user;
  delete from perp_accounts where "userId" = p_user;
  delete from monthly_portfolio_snapshots where "userId" = p_user;
  delete from weekly_portfolio_snapshots where "userId" = p_user;
  delete from assets where "userId" = p_user;
  delete from banks where "userId" = p_user;
end $$;
revoke all on function public.delete_user_data(text) from public, anon, authenticated, finanzas_app;
