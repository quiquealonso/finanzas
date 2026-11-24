-- Monthly closings: a hand-filled sheet (one per year) that lives apart from the tracked portfolio.
-- Nothing here feeds holdings, snapshots or totals of the rest of the app.
-- Re-runnable: every statement is idempotent.

create table if not exists public.closing_sections (
  id         text    primary key default gen_random_uuid()::text,
  year       int     not null,
  name       text    not null,
  position   int     not null default 0,
  "inTotal"  boolean not null default true   -- counts in the sheet's "Patrimonio total"
);
create index if not exists closing_sections_year_idx on public.closing_sections (year);

create table if not exists public.closing_rows (
  id          text  primary key default gen_random_uuid()::text,
  "sectionId" text  not null references public.closing_sections(id) on delete cascade,
  name        text  not null,
  position    int   not null default 0,
  -- {"0": opening value, "1".."12": month closes}; a value is a number or a free-text note.
  cells       jsonb not null default '{}'::jsonb
);
create index if not exists closing_rows_section_idx on public.closing_rows ("sectionId");

alter table public.closing_sections enable row level security;
alter table public.closing_rows enable row level security;

-- Rows filled by the "Hacer cierre" button: one section per bank with the assets held there,
-- plus a "Liquidez" section (kind 'cash') with one hand-filled row per bank.
alter table public.closing_sections add column if not exists kind text not null default 'manual';  -- manual | cash | bank
alter table public.closing_sections add column if not exists "bankId" text;
alter table public.closing_rows add column if not exists "assetId" text references public.assets(id) on delete set null;
alter table public.closing_rows add column if not exists "bankId" text;

-- Money invested per month (cost basis from the snapshots), so the month change can leave contributions out.
-- {"0": invested at the start, "1".."12": invested at each month end}. "openingValue" = value on 31 December.
alter table public.closing_rows add column if not exists costs jsonb not null default '{}'::jsonb;
alter table public.closing_rows add column if not exists "openingValue" numeric;
