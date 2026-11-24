-- On-chain spot wallets read with their public addresses (no keys: read only).
-- Each wallet token is mapped to an asset; the sync reads the balances and brings the asset quantity in line:
--   - small differences (<= 2 %: staking rewards, fees) are adjusted automatically,
--   - bigger ones wait for the user to apply them (a sale elsewhere, a transfer to an exchange...).
-- Adjustments are normal "adjust" operations; their external ids go to external_operations (see perps.sql).
-- Written and read by back/src/wallets.ts. Re-runnable: every statement is idempotent.

-- One row per chain and address.
create table if not exists public.wallet_accounts (
  chain        text        not null check (chain in ('solana', 'sui', 'bsc', 'ethereum', 'arbitrum', 'base')),
  address      text        not null,
  -- Bank where new assets of this wallet go.
  "bankId"     text        not null references public.banks(id),
  "lastSyncAt" timestamptz,
  "lastError"  text,
  "createdAt"  timestamptz not null default now(),
  primary key (chain, address)
);
alter table public.wallet_accounts enable row level security;

-- Tokens of each chain: which asset they feed, or ignored (spam, dust).
create table if not exists public.wallet_tokens (
  chain      text    not null,
  -- 'native' for the chain coin; else the mint (Solana), coin type (Sui) or contract (EVM, lower case).
  token      text    not null,
  symbol     text,
  name       text,
  decimals   int,
  "assetId"  text    references public.assets(id) on delete set null,
  ignored    boolean not null default false,
  primary key (chain, token)
);
alter table public.wallet_tokens enable row level security;

-- Last balance read of every token in every wallet.
create table if not exists public.wallet_balances (
  chain      text        not null,
  address    text        not null,
  token      text        not null,
  amount     numeric     not null,
  -- Part of amount that is staked (Solana stake accounts), informative.
  staked     numeric     not null default 0,
  "usdPrice" numeric,
  "syncedAt" timestamptz not null default now(),
  primary key (chain, address, token)
);
alter table public.wallet_balances enable row level security;
