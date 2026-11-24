-- Broker orders read from e-mail that still need the user to say whether they were executed (BBVA only sends the
-- order document, never the execution). "Se ejecutó" turns one into a normal buy/sell; "No se ejecutó" closes it.
-- Owned by a user like the rest (see users.sql). Re-runnable: every statement is idempotent.

create table if not exists public.pending_orders (
  id            text        primary key default gen_random_uuid()::text,
  "userId"      text        not null default public.app_user() references public.users(id),
  broker        text        not null,
  -- Identifies the e-mail's order (broker + order number): the import never adds it twice.
  "mailKey"     text        not null,
  "orderNo"     text,
  kind          text        not null check (kind in ('buy', 'sell')),
  isin          text,
  name          text        not null,
  market        text,
  currency      text        not null default 'EUR',
  quantity      numeric     not null,
  "limitPrice"  numeric,
  modality      text,
  "validFrom"   date,
  "validTo"     date,
  "orderedAt"   timestamptz,
  modified      boolean     not null default false,
  status        text        not null default 'pending' check (status in ('pending', 'executed', 'cancelled')),
  "groupId"     text,
  "createdAt"   timestamptz not null default now()
);
create unique index if not exists pending_orders_user_key on public.pending_orders ("userId", "mailKey");
create index if not exists pending_orders_user_status on public.pending_orders ("userId", status);

alter table public.pending_orders enable row level security;
grant select, insert, update, delete on public.pending_orders to finanzas_app;
drop policy if exists app_user_rows on public.pending_orders;
create policy app_user_rows on public.pending_orders for all to finanzas_app
  using ("userId" = public.app_user()) with check ("userId" = public.app_user());
