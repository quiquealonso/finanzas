-- Funds the user saved from "Analizar mejores opciones" (Perfil de riesgo), shown on that page by profile.
-- Written and read by back/src/fund-finder.ts. Per user (RLS). Re-runnable: every statement is idempotent.
create table if not exists public.saved_funds (
  id          text        primary key default gen_random_uuid()::text,
  "userId"    text        not null default public.app_user(),
  isin        text        not null,
  -- Risk profile the fund was found for: conservador | moderado | equilibrado | dinamico | agresivo
  profile     text        not null,
  -- Zones chosen in the search (ES, EU, US, ..., GLOBAL).
  zones       text[]      not null default '{}',
  -- The fund as the search returned it (name, manager, ret1y, vol, risk, ter, aum, regions, reason...): a photo.
  data        jsonb       not null,
  "createdAt" timestamptz not null default now(),
  unique ("userId", isin, profile)
);
create index if not exists saved_funds_user on public.saved_funds ("userId", profile, "createdAt" desc);
alter table public.saved_funds enable row level security;
drop policy if exists app_user_rows on public.saved_funds;
create policy app_user_rows on public.saved_funds for all to finanzas_app
  using ("userId" = public.app_user()) with check ("userId" = public.app_user());
grant select, insert, update, delete on public.saved_funds to finanzas_app;
