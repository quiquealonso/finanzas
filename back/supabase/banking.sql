-- Day-to-day banking (page Gastos, back/src/banking.ts): current accounts read with Open Banking (PSD2, read only)
-- through Enable Banking, their movements and how each one is classified. One user's rows are never seen by another
-- (row level security, like users.sql). Re-runnable. Nothing here can move money: the app only asks for account
-- information, never for payments.

-- A consent given in the bank's own app or web: an Enable Banking session, valid until "validUntil".
create table if not exists public.bank_links (
  id           text        primary key default gen_random_uuid()::text,
  "userId"     text        not null default public.app_user() references public.users(id) on delete cascade,
  aspsp        text        not null,              -- bank name in Enable Banking ("BBVA", "Trade Republic")
  country      text        not null,
  "sessionId"  text        not null unique,
  "validUntil" timestamptz not null,
  status       text        not null default 'active', -- active | expired | revoked
  "lastSyncAt" timestamptz,
  "lastError"  text,
  "createdAt"  timestamptz not null default now()
);

-- Accounts of a consent (an IBAN, a card account…). "uid" is the id Enable Banking gives for this session.
create table if not exists public.bank_accounts (
  id            text        primary key default gen_random_uuid()::text,
  "userId"      text        not null default public.app_user() references public.users(id) on delete cascade,
  "linkId"      text        not null references public.bank_links(id) on delete cascade,
  uid           text        not null,
  -- Account identity across consents (renewing the consent gives new uids): IBAN, or Enable Banking's hash.
  "accountKey"  text        not null,
  name          text        not null,
  iban          text,
  currency      text        not null default 'EUR',
  balance       numeric,
  "balanceAt"   timestamptz,
  hidden        boolean     not null default false,
  "createdAt"   timestamptz not null default now()
);
create unique index if not exists bank_accounts_user_key on public.bank_accounts ("userId", "accountKey");

-- Movements. amount < 0 = money out. "key" avoids duplicates when the same days are read again.
create table if not exists public.bank_transactions (
  id               text        primary key default gen_random_uuid()::text,
  "userId"         text        not null default public.app_user() references public.users(id) on delete cascade,
  "accountId"      text        not null references public.bank_accounts(id) on delete cascade,
  key              text        not null,
  "bookingDate"    date        not null,
  amount           numeric     not null,
  currency         text        not null default 'EUR',
  description      text        not null default '',
  counterparty     text,
  "counterpartyIban" text,
  mcc              text,
  status           text        not null default 'BOOK',
  -- Category code (banking.ts → CATEGORIES) and who set it: rule (built in), user, learned (a rule the user made), ai.
  category         text,
  "categorySource" text,
  -- Money between own accounts (or to invest): not income nor expense.
  internal         boolean     not null default false,
  note             text,
  "createdAt"      timestamptz not null default now()
);
create unique index if not exists bank_transactions_user_key on public.bank_transactions ("userId", key);
create index if not exists bank_transactions_user_date on public.bank_transactions ("userId", "bookingDate");

-- Rules the user teaches by correcting a movement: text found in the description or counterparty -> category.
create table if not exists public.spend_rules (
  id          text        primary key default gen_random_uuid()::text,
  "userId"    text        not null default public.app_user() references public.users(id) on delete cascade,
  pattern     text        not null,
  category    text        not null,
  internal    boolean     not null default false,
  "createdAt" timestamptz not null default now()
);
create unique index if not exists spend_rules_user_pattern on public.spend_rules ("userId", lower(pattern));

do $$
declare t text;
begin
  foreach t in array array['bank_links', 'bank_accounts', 'bank_transactions', 'spend_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists app_user_rows on public.%I', t);
    execute format('create policy app_user_rows on public.%I for all to finanzas_app using ("userId" = public.app_user()) with check ("userId" = public.app_user())', t);
    execute format('grant select, insert, update, delete on public.%I to finanzas_app', t);
  end loop;
end $$;
