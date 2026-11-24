-- Target allocation: the % of the portfolio each asset type should have, and inside each type
-- the % of every product (an asset already held, or a free name for one not bought yet).
-- Re-runnable: every statement is idempotent.

create table if not exists public.allocation_targets (
  id         text    primary key default gen_random_uuid()::text,
  "typeCode" text    not null,
  -- null = the row of the type itself (pct of the whole portfolio).
  "assetId"  text    references public.assets(id) on delete cascade,
  -- Product not held yet (only when "assetId" is null and it isn't the type row).
  name       text,
  -- Type row: % of the portfolio. Product row: % inside its type.
  pct        numeric not null check (pct >= 0 and pct <= 100),
  position   int     not null default 0
);

alter table public.allocation_targets enable row level security;
