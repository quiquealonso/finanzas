-- Market sentiment ("Sentimiento de mercado"). Written by back/src/sentiment.ts (job every 30 minutes while the
-- backend runs, or the "Actualizar" button), read by GET /api/v2/sentiment/*.
-- Market data, not personal data: shared by every user (RLS on, policy "true" for finanzas_app, like prices).
-- Educational analysis only: it is never investment advice.
-- Re-runnable: every statement is idempotent.

-- Companies of each index ("fund") that can be analysed: sp500, nasdaq100, ibex35.
create table if not exists public.sentiment_universe (
  fund        text        not null,
  -- Yahoo symbol (BRK-B, SAN.MC...).
  symbol      text        not null,
  name        text        not null,
  sector      text,
  "updatedAt" timestamptz not null default now(),
  primary key (fund, symbol)
);

-- Funds someone opened lately: the job only works on these.
create table if not exists public.sentiment_funds (
  fund         text        primary key,
  "lastUsedAt" timestamptz not null default now()
);

-- Daily closes of every company of the universe and the benchmarks (momentum, breadth, track record).
create table if not exists public.sentiment_prices (
  symbol text    not null,
  day    date    not null,
  close  numeric not null,
  primary key (symbol, day)
);

-- Where the posts come from: curated influencers (Bluesky, YouTube) and news publishers (added on the fly).
create table if not exists public.sentiment_sources (
  id          text        primary key,               -- 'bluesky:ritholtz.bsky.social', 'youtube:UC...', 'news:Reuters'
  platform    text        not null,                  -- bluesky | youtube | news
  handle      text        not null,                  -- account handle, channel id or publisher name
  name        text        not null,
  lang        text        not null default 'en',
  -- Curated by us (true) or found in the news (false).
  curated     boolean     not null default false,
  active      boolean     not null default true,
  "fetchedAt" timestamptz
);

-- One post, video or headline.
create table if not exists public.sentiment_posts (
  id             text        primary key default gen_random_uuid()::text,
  "sourceId"     text        not null references public.sentiment_sources(id) on delete cascade,
  "externalId"   text        not null unique,       -- platform id (at:// uri, video id, news link)
  url            text,
  text           text        not null,
  "postedAt"     timestamptz not null,
  "fetchedAt"    timestamptz not null default now(),
  -- Company the post was searched for (news search per symbol); null for influencer posts.
  "hintSymbol"   text,
  -- Classification: gemini | lexicon. Null = not classified yet.
  "classifiedBy" text,
  "classifiedAt" timestamptz,
  -- Tone about the market as a whole: -1 bearish, 0 neutral, 1 bullish (null = says nothing of the market).
  "marketStance" smallint
);
create index if not exists sentiment_posts_pending on public.sentiment_posts ("classifiedAt") where "classifiedBy" is null;
create index if not exists sentiment_posts_posted on public.sentiment_posts ("postedAt" desc);

-- A company named in a post, with the tone about it.
create table if not exists public.sentiment_mentions (
  id           text        primary key default gen_random_uuid()::text,
  "postId"     text        not null references public.sentiment_posts(id) on delete cascade,
  symbol       text        not null,
  stance       smallint    not null,                -- -1 bearish, 0 neutral, 1 bullish
  confidence   numeric     not null,                -- 0..1
  reason       text,
  -- Track record, filled when the days have passed: return of the company and minus its benchmark.
  ret1         numeric,
  ret7         numeric,
  ret30        numeric,
  excess7      numeric,
  -- Did the tone match the next 7 days (excess return vs. benchmark)? Null = neutral or not known yet.
  hit7         boolean,
  unique ("postId", symbol)
);
create index if not exists sentiment_mentions_symbol on public.sentiment_mentions (symbol);

-- Daily market gauges: vix, crypto_fng, btc_funding, breadth200:<fund>, trend:<fund>, social, gauge:<fund>.
create table if not exists public.market_metrics (
  day   date    not null,
  key   text    not null,
  value numeric not null,
  primary key (day, key)
);

do $$
declare t text;
begin
  foreach t in array array['sentiment_universe', 'sentiment_funds', 'sentiment_prices', 'sentiment_sources',
                           'sentiment_posts', 'sentiment_mentions', 'market_metrics'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists app_user_rows on public.%I', t);
    execute format('create policy app_user_rows on public.%I for all to finanzas_app using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on public.%I to finanzas_app', t);
  end loop;
end $$;

-- Last time the news of each company were searched (the job rotates through the universe).
alter table public.sentiment_universe add column if not exists "newsAt" timestamptz;
