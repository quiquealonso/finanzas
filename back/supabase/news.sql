-- News board: news about the positions in the portfolio, found by scheduled Claude tasks
-- (daily for stocks, monthly for actively managed funds) plus a weekly digest.
-- Written by back/scripts/news-save.js, read by GET /api/v2/news.
-- Re-runnable: every statement is idempotent.

create table if not exists public.news_items (
  id            text        primary key default gen_random_uuid()::text,
  -- null = news about the market in general, not one position.
  "assetId"     text        references public.assets(id) on delete set null,
  -- Kept even if the asset is deleted later.
  "assetName"   text,
  -- 'daily' = stock news, 'monthly' = active fund news.
  scope         text        not null default 'daily' check (scope in ('daily', 'monthly')),
  -- 'important' = can change the thesis or move the price a lot,
  -- 'minor' = worth knowing, 'low' = noise.
  tier          text        not null check (tier in ('important', 'minor', 'low')),
  title         text        not null,
  summary       text,
  -- What it means for the position, in one or two sentences.
  impact        text,
  -- 'up' | 'down' | 'neutral': expected effect on the position.
  sentiment     text        check (sentiment in ('up', 'down', 'neutral')),
  source        text,
  url           text        not null unique,
  "publishedAt" date        not null,
  "createdAt"   timestamptz not null default now()
);
create index if not exists news_items_published on public.news_items ("publishedAt" desc);
alter table public.news_items enable row level security;

create table if not exists public.news_digests (
  id          text        primary key default gen_random_uuid()::text,
  -- First day of the period the digest covers (the Thursday a week before the run).
  "weekStart" date        not null unique,
  headline    text        not null,
  -- Plain text with line breaks; paragraphs separated by a blank line.
  body        text        not null,
  "createdAt" timestamptz not null default now()
);
alter table public.news_digests enable row level security;

-- Weekly task (Thursdays): the fund review runs once a month, in the first weekly run of a new month.
-- true = that run also reviewed the active funds.
alter table public.news_digests add column if not exists "fundsChecked" boolean not null default false;
