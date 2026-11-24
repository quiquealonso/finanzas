-- Savings goals: a target amount of the whole portfolio by a date. Only the goal is stored; progress,
-- probability and the needed contribution are computed on the fly from the snapshots and the plans.
-- Re-runnable: every statement is idempotent.

create table if not exists public.goals (
  id              text      primary key default gen_random_uuid()::text,
  name            text      not null,
  "targetEur"     numeric   not null check ("targetEur" > 0),
  "targetDate"    date      not null,
  -- Monthly contribution to simulate; null = the active recurring plans.
  "monthlyEur"    numeric,
  -- Portfolio value when the goal was created, for the "on track" marker.
  "startValueEur" numeric   not null default 0,
  "startDate"     date      not null default current_date,
  position        int       not null default 0,
  "createdAt"     timestamp not null default now()
);

alter table public.goals enable row level security;
