-- Investor risk profile ("Perfil de riesgo"): each time the user answers the questionnaire, one row (history kept).
-- Written and read by back/src/risk-profile.ts. Per user (RLS). Re-runnable: every statement is idempotent.
create table if not exists public.risk_profiles (
  id          text        primary key default gen_random_uuid()::text,
  "userId"    text        not null default public.app_user(),
  -- Question id -> chosen option id (the questions live in the front: features/risk-profile/risk-questions.ts).
  answers     jsonb       not null,
  -- 0..100 of each dimension and the result.
  capacity    int         not null,
  tolerance   int         not null,
  knowledge   int         not null,
  score       int         not null,
  -- conservador | moderado | equilibrado | dinamico | agresivo
  profile     text        not null,
  "createdAt" timestamptz not null default now()
);
create index if not exists risk_profiles_user on public.risk_profiles ("userId", "createdAt" desc);
alter table public.risk_profiles enable row level security;
drop policy if exists app_user_rows on public.risk_profiles;
create policy app_user_rows on public.risk_profiles for all to finanzas_app
  using ("userId" = public.app_user()) with check ("userId" = public.app_user());
grant select, insert, update, delete on public.risk_profiles to finanzas_app;
