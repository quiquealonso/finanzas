import { Express } from "express";
import { base, sharedQuery } from "./prisma";
import { handler, HttpError } from "./portfolio";
import { backgroundJobs } from "./server-mode";

/**
 * Market sentiment ("Sentimiento de mercado"). Educational analysis only, never investment advice.
 *
 * Every 30 minutes while the backend runs (or on the "Actualizar" button) a job:
 *   1. Loads the companies of the funds in use (S&P 500, Nasdaq 100, IBEX 35) from Wikipedia / Nasdaq.
 *   2. Keeps one year of daily closes of each one and of the benchmarks (Yahoo).
 *   3. Reads the last posts of curated influencers (Bluesky, YouTube) and the news of a slice of the
 *      companies (Google News RSS): the whole universe goes round in a few hours.
 *   4. Classifies every new text: which companies it names and whether the tone is bullish, bearish or neutral.
 *      With GEMINI_API_KEY in back/.env (free key of Google AI Studio) the Gemini model does it, 40 texts per
 *      call; without it a simple word list (much worse) so the page still works.
 *   5. Reads the market gauges (VIX, crypto Fear & Greed, BTC funding) and checks the track record: what the
 *      price did 1, 7 and 30 days after each mention, against the benchmark of the fund.
 *
 * Every free source is public data read with its public endpoint and a generic client name. Sources that block
 * automated clients (StockTwits, CNN Fear & Greed, Reddit without a key) are left out on purpose.
 * Shared market data: written and read with the owner client (`base`), not per user (see supabase/sentiment.sql).
 */

const UA = { "User-Agent": "finanzas-class-project/1.0" };
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

export const FUNDS: Record<string, { label: string; benchmark: string; lang: "en" | "es" }> = {
  sp500: { label: "S&P 500", benchmark: "SPY", lang: "en" },
  nasdaq100: { label: "Nasdaq 100", benchmark: "QQQ", lang: "en" },
  ibex35: { label: "IBEX 35", benchmark: "^IBEX", lang: "es" },
};
const benchmarkOf = (symbol: string) => (symbol.endsWith(".MC") ? "^IBEX" : "SPY");

/** Curated influencers: accounts and channels that talk about markets and companies (checked they exist). */
const INFLUENCERS: Array<{ platform: "bluesky" | "youtube"; handle: string; name: string; lang: "en" | "es" }> = [
  // Bluesky: analysts, journalists and financial media.
  { platform: "bluesky", handle: "unusualwhales.bsky.social", name: "Unusual Whales", lang: "en" },
  { platform: "bluesky", handle: "ritholtz.bsky.social", name: "Barry Ritholtz", lang: "en" },
  { platform: "bluesky", handle: "conorsen.bsky.social", name: "Conor Sen", lang: "en" },
  { platform: "bluesky", handle: "jasonfurman.bsky.social", name: "Jason Furman", lang: "en" },
  { platform: "bluesky", handle: "carlquintanilla.bsky.social", name: "Carl Quintanilla", lang: "en" },
  { platform: "bluesky", handle: "josephpolitano.bsky.social", name: "Joey Politano", lang: "en" },
  { platform: "bluesky", handle: "michaelbatnick.bsky.social", name: "Michael Batnick", lang: "en" },
  { platform: "bluesky", handle: "dividendgrowth.bsky.social", name: "Dividend Growth Investor", lang: "en" },
  { platform: "bluesky", handle: "reuters.com", name: "Reuters", lang: "en" },
  { platform: "bluesky", handle: "bloomberg.com", name: "Bloomberg News", lang: "en" },
  { platform: "bluesky", handle: "wsj.com", name: "The Wall Street Journal", lang: "en" },
  { platform: "bluesky", handle: "cnbc.com", name: "CNBC", lang: "en" },
  { platform: "bluesky", handle: "economist.com", name: "The Economist", lang: "en" },
  { platform: "bluesky", handle: "barrons.com", name: "Barron's", lang: "en" },
  { platform: "bluesky", handle: "marketwatch.com", name: "MarketWatch", lang: "en" },
  { platform: "bluesky", handle: "fortune.com", name: "Fortune", lang: "en" },
  { platform: "bluesky", handle: "businessinsider.com", name: "Business Insider", lang: "en" },
  { platform: "bluesky", handle: "eleconomista.es", name: "elEconomista", lang: "es" },
  // YouTube (public RSS of each channel: title and description of the videos).
  { platform: "youtube", handle: "UCrp_UI8XtuYfpiqluWLD7Lw", name: "CNBC Television", lang: "en" },
  { platform: "youtube", handle: "UCIALMKvObZNtJ6AmdCLP7Lg", name: "Bloomberg Television", lang: "en" },
  { platform: "youtube", handle: "UCEAZeUIeJs0IjQiqTCdVSIg", name: "Yahoo Finance", lang: "en" },
  { platform: "youtube", handle: "UCK7tptUDHh-RYDsdxO1-5QQ", name: "The Wall Street Journal", lang: "en" },
  { platform: "youtube", handle: "UCoUxsWakJucWg46KW5RsvPw", name: "Financial Times", lang: "en" },
  { platform: "youtube", handle: "UCK-zlnUfoDHzUwXcbddtnkg", name: "ARK Invest", lang: "en" },
  { platform: "youtube", handle: "UCUvvj5lwue7PspotMDjk5UA", name: "Meet Kevin", lang: "en" },
  { platform: "youtube", handle: "UCV6KDgJskWaEckne5aPA0aQ", name: "Graham Stephan", lang: "en" },
  { platform: "youtube", handle: "UCGy7SkBjcIAgTiwkXEtPnYg", name: "Andrei Jikh", lang: "en" },
  { platform: "youtube", handle: "UCASM0cgfkJxQ1ICmRilfHLw", name: "Patrick Boyle", lang: "en" },
  { platform: "youtube", handle: "UCnMn36GT_H0X-w5_ckLtlgQ", name: "Financial Education", lang: "en" },
  { platform: "youtube", handle: "UCJm2RBjxfvdTdtJcYtFx2Xw", name: "Everything Money", lang: "en" },
  { platform: "youtube", handle: "UCJwKCyEIFHwUOPQQ-4kC1Zw", name: "Tom Nash", lang: "en" },
  { platform: "youtube", handle: "UC1LpsuAUaKoMzzJSEt5WImw", name: "Chip Stock Investor", lang: "en" },
  { platform: "youtube", handle: "UCORX3Cl7ByidjEgzSCgv9Yw", name: "Ticker Symbol: YOU", lang: "en" },
  { platform: "youtube", handle: "UCTFNtj7w0bRVh-36ITYBaEA", name: "Unrivaled Investing", lang: "en" },
  { platform: "youtube", handle: "UCODr9HUJ90xtWD-0Xoz4vPw", name: "Hamish Hodder", lang: "en" },
  { platform: "youtube", handle: "UCL-F-8nxFtFZ4M3RWkGn6Qw", name: "Daniel Pronk", lang: "en" },
  { platform: "youtube", handle: "UCL_v4tC26PvOFytV1_eEVSg", name: "WhiteBoard Finance", lang: "en" },
  { platform: "youtube", handle: "UC71VTsUKOsh6QEGnzaa2KuQ", name: "Rankia", lang: "es" },
  { platform: "youtube", handle: "UCXmAOGwFYxIq5qrScJeeV4g", name: "El Economista", lang: "es" },
  { platform: "youtube", handle: "UCfZnmQp92JqFxB3CAlDsrPg", name: "Expansión", lang: "es" },
  { platform: "youtube", handle: "UCxy_2pzDLYcQHMCWlMwGOXg", name: "CincoDías", lang: "es" },
  { platform: "youtube", handle: "UCYqm8Y6tfO1HvGSIILyfeOA", name: "Invertir desde Cero", lang: "es" },
  { platform: "youtube", handle: "UCpLie5obXFdf8T0NG-IRHsA", name: "Value School", lang: "es" },
  { platform: "youtube", handle: "UCIRhCEuBUZF7ZpYQnN-JXCg", name: "José Luis Cava", lang: "es" },
  { platform: "youtube", handle: "UCtWEGc5ws4HvMvCW-hVY-Gw", name: "El Club de Inversión", lang: "es" },
];

// ---------------------------------------------------------------- small helpers

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split("?")[0]}`);
  return res.text();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => ENTITIES[n] ?? m);
}
const stripTags = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) ?? [])[1] ?? "").trim();

/** Runs `fn` over `items` with at most `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const q = <T = any>(sql: string, ...args: unknown[]) => sharedQuery<T>(sql, ...args);
const x = (sql: string, ...args: unknown[]) => base.$executeRawUnsafe(sql, ...args);

// ---------------------------------------------------------------- job state

type JobEvent = { at: string; text: string; level: "info" | "ok" | "warn" };
const job = { running: null as Promise<void> | null, startedAt: null as string | null, finishedAt: null as string | null, step: "", events: [] as JobEvent[] };

function log(text: string, level: JobEvent["level"] = "info") {
  job.step = text;
  job.events.push({ at: new Date().toISOString(), text, level });
  if (job.events.length > 200) job.events.splice(0, job.events.length - 200);
}

// ---------------------------------------------------------------- 1. universe

function tableRows(html: string): string[][] {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1])));
}

async function fetchUniverse(fund: string): Promise<Array<{ symbol: string; name: string; sector: string | null }>> {
  if (fund === "sp500") {
    const html = await getText("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies");
    const table = html.match(/<table[^>]*id="constituents"[\s\S]*?<\/table>/)?.[0] ?? "";
    return tableRows(table).slice(1).filter((r) => r.length >= 3 && r[0])
      .map((r) => ({ symbol: r[0].replace(/\./g, "-"), name: r[1], sector: r[2] || null }));
  }
  if (fund === "nasdaq100") {
    const res = await fetch("https://api.nasdaq.com/api/quote/list-type/nasdaq100", { headers: { ...UA, Accept: "application/json" } });
    const rows: any[] = (await res.json())?.data?.data?.rows ?? [];
    const sectors = new Map((await q<{ symbol: string; sector: string }>(`select symbol, sector from sentiment_universe where fund = 'sp500'`)).map((r) => [r.symbol, r.sector]));
    return rows.map((r) => {
      const symbol = String(r.symbol).replace(/\./g, "-");
      const name = String(r.companyName).replace(/\s+(Class [A-C] )?(Common Stock|Ordinary Shares|American Depositary Shares).*$/i, "").trim();
      return { symbol, name, sector: sectors.get(symbol) ?? null };
    });
  }
  if (fund === "ibex35") {
    const html = await getText("https://en.wikipedia.org/wiki/IBEX_35");
    const table = html.match(/<table[^>]*id="components"[\s\S]*?<\/table>/)?.[0] ?? "";
    return tableRows(table).slice(1).filter((r) => r.length >= 2 && /^[A-Z0-9]{2,5}$/.test(r[0]))
      .map((r) => ({ symbol: `${r[0]}.MC`, name: r[1], sector: r[2] || null }));
  }
  throw new HttpError(400, "Fondo no válido.");
}

export async function ensureUniverse(fund: string): Promise<void> {
  const [row] = await q<{ n: number; fresh: boolean }>(
    `select count(*)::int as n, coalesce(min("updatedAt") > now() - interval '7 days', false) as fresh from sentiment_universe where fund = $1`, fund
  );
  if (row.n > 0 && row.fresh) return;
  log(`Cargando las empresas del ${FUNDS[fund].label}…`);
  const list = await fetchUniverse(fund);
  if (list.length < 20) throw new Error(`Lista del ${FUNDS[fund].label} incompleta (${list.length})`);
  await x(
    `insert into sentiment_universe (fund, symbol, name, sector)
       select $1, * from unnest($2::text[], $3::text[], $4::text[])
     on conflict (fund, symbol) do update set name = excluded.name, sector = coalesce(excluded.sector, sentiment_universe.sector), "updatedAt" = now()`,
    fund, list.map((c) => c.symbol), list.map((c) => c.name), list.map((c) => c.sector)
  );
  await x(`delete from sentiment_universe where fund = $1 and not (symbol = any($2::text[]))`, fund, list.map((c) => c.symbol));
  log(`${FUNDS[fund].label}: ${list.length} empresas`, "ok");
}

// ---------------------------------------------------------------- 2. prices

async function fetchCloses(symbol: string, range: string): Promise<Array<{ day: string; close: number }>> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return [];
  const r = (await res.json())?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const closes: Array<number | null> = r?.indicators?.quote?.[0]?.close ?? [];
  const offset = Number(r?.meta?.gmtoffset ?? 0);
  return ts.map((t, i) => ({ day: new Date((t + offset) * 1000).toISOString().slice(0, 10), close: closes[i] as number }))
    .filter((p) => p.close != null && Number.isFinite(p.close));
}

/** Brings the closes up to date: the stalest symbols first, at most `max` of them. */
async function updatePrices(funds: string[], max: number): Promise<void> {
  const symbols = await q<{ symbol: string; last: string | null }>(
    `with wanted as (
       select symbol from sentiment_universe where fund = any($1::text[])
       union select unnest($2::text[])
     )
     select w.symbol, to_char(max(p.day), 'YYYY-MM-DD') as last
       from wanted w left join sentiment_prices p on p.symbol = w.symbol
      group by w.symbol
     -- Stale = misses the last weekday close (Monday needs Friday's).
     having max(p.day) is null
         or max(p.day) < current_date - (case extract(isodow from current_date)::int when 1 then 3 when 7 then 2 else 1 end)
      order by max(p.day) nulls first
      limit $3`,
    funds, ["^VIX", ...funds.map((f) => FUNDS[f].benchmark)], max
  );
  if (!symbols.length) return;
  log(`Actualizando precios de ${symbols.length} valores…`);
  let done = 0;
  await pool(symbols, 4, async ({ symbol, last }) => {
    const pts = await fetchCloses(symbol, last ? "1mo" : "1y").catch(() => []);
    if (pts.length) {
      await x(
        `insert into sentiment_prices (symbol, day, close) select $1, * from unnest($2::date[], $3::numeric[])
         on conflict (symbol, day) do update set close = excluded.close`,
        symbol, pts.map((p) => p.day), pts.map((p) => p.close)
      );
    }
    if (++done % 50 === 0) log(`Precios: ${done}/${symbols.length}`);
    await sleep(150);
  });
  log(`Precios al día (${symbols.length} valores)`, "ok");
}

// ---------------------------------------------------------------- 3. posts

type NewPost = { sourceId: string; externalId: string; url: string | null; text: string; postedAt: string; hintSymbol: string | null };

async function savePosts(all: NewPost[]): Promise<number> {
  const posts = all.filter((p) => p.externalId && Number.isFinite(Date.parse(p.postedAt)));
  if (!posts.length) return 0;
  return x(
    `insert into sentiment_posts ("sourceId", "externalId", url, text, "postedAt", "hintSymbol")
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::timestamptz[], $6::text[])
     on conflict ("externalId") do nothing`,
    posts.map((p) => p.sourceId), posts.map((p) => p.externalId), posts.map((p) => p.url),
    posts.map((p) => p.text.slice(0, 1500)), posts.map((p) => new Date(p.postedAt).toISOString()), posts.map((p) => p.hintSymbol)
  );
}

async function syncInfluencerList(): Promise<void> {
  await x(
    `insert into sentiment_sources (id, platform, handle, name, lang, curated)
       select * , true from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
     on conflict (id) do update set name = excluded.name, lang = excluded.lang, curated = true`,
    INFLUENCERS.map((i) => `${i.platform}:${i.handle}`), INFLUENCERS.map((i) => i.platform), INFLUENCERS.map((i) => i.handle),
    INFLUENCERS.map((i) => i.name), INFLUENCERS.map((i) => i.lang)
  );
}

async function fetchBluesky(handle: string, sourceId: string): Promise<NewPost[]> {
  const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=30&filter=posts_no_replies`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Bluesky ${handle}: HTTP ${res.status}`);
  const feed: any[] = (await res.json()).feed ?? [];
  return feed.filter((f) => !f.reason && f.post?.author?.handle === handle).map((f) => {
    const p = f.post;
    const card = p.embed?.external ? ` [${p.embed.external.title ?? ""}. ${p.embed.external.description ?? ""}]` : "";
    return {
      sourceId, externalId: p.uri, url: `https://bsky.app/profile/${handle}/post/${String(p.uri).split("/").pop()}`,
      text: `${p.record?.text ?? ""}${card}`.trim(), postedAt: p.record?.createdAt ?? p.indexedAt, hintSymbol: null,
    };
  }).filter((p) => p.text.length > 15);
}

async function fetchYoutube(channelId: string, sourceId: string): Promise<NewPost[]> {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const id = tag(e, "yt:videoId");
    const desc = tag(e, "media:description").split(/\n\s*\n/)[0].slice(0, 500);
    return { sourceId, externalId: `yt:${id}`, url: `https://www.youtube.com/watch?v=${id}`, text: `${tag(e, "title")}. ${desc}`.trim(), postedAt: tag(e, "published"), hintSymbol: null };
  }).filter((p) => p.externalId !== "yt:");
}

async function fetchInfluencers(): Promise<void> {
  await syncInfluencerList();
  const sources = await q<{ id: string; platform: string; handle: string; name: string }>(
    `select id, platform, handle, name from sentiment_sources where curated and active and ("fetchedAt" is null or "fetchedAt" < now() - interval '25 minutes')`
  );
  if (!sources.length) return;
  log(`Leyendo ${sources.length} influyentes (Bluesky y YouTube)…`);
  let added = 0;
  const failed: string[] = [];
  await pool(sources, 4, async (s) => {
    try {
      const posts = s.platform === "bluesky" ? await fetchBluesky(s.handle, s.id) : await fetchYoutube(s.handle, s.id);
      added += await savePosts(posts.filter((p) => Date.now() - Date.parse(p.postedAt) < 14 * DAY));
      await x(`update sentiment_sources set "fetchedAt" = now() where id = $1`, s.id);
    } catch {
      failed.push(s.name);
    }
  });
  log(`Influyentes: ${added} publicaciones nuevas${failed.length ? ` (sin respuesta: ${failed.join(", ")})` : ""}`, failed.length ? "warn" : "ok");
}

/** Short company name for the news search: "Apple Inc." -> "Apple". */
const searchName = (name: string) => name.replace(/,?\s+(Inc\.?|Corp(oration)?\.?|Co\.?|Company|Ltd\.?|plc|PLC|S\.?A\.?|N\.?V\.?|Holdings?|Group|Incorporated|Class [A-C])\b.*$/i, "").trim() || name;

async function fetchNews(funds: string[], max: number): Promise<void> {
  const rows = await q<{ fund: string; symbol: string; name: string }>(
    `select distinct on (symbol) fund, symbol, name from sentiment_universe
      where fund = any($1::text[]) and ("newsAt" is null or "newsAt" < now() - interval '6 hours')
      order by symbol, "newsAt" nulls first`, funds
  );
  rows.sort(() => Math.random() - 0.5);
  const slice = rows.slice(0, max);
  if (!slice.length) return;
  log(`Buscando noticias de ${slice.length} empresas…`);
  let added = 0;
  await pool(slice, 3, async (c) => {
    const es = c.symbol.endsWith(".MC");
    const query = `"${searchName(c.name)}" ${es ? "acciones" : "stock"} when:2d`;
    const edition = es ? "hl=es&gl=ES&ceid=ES:es" : "hl=en-US&gl=US&ceid=US:en";
    try {
      const xml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${edition}`);
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => {
        const it = m[1];
        const publisher = tag(it, "source") || "Google News";
        const title = tag(it, "title").replace(new RegExp(`\\s+-\\s+${publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
        return { publisher, post: { sourceId: `news:${publisher}`, externalId: tag(it, "link"), url: tag(it, "link"), text: title, postedAt: tag(it, "pubDate"), hintSymbol: c.symbol } };
      });
      const publishers = [...new Set(items.map((i) => i.publisher))];
      if (publishers.length) {
        await x(
          `insert into sentiment_sources (id, platform, handle, name, lang) select 'news:' || p, 'news', p, p, $2 from unnest($1::text[]) p on conflict (id) do nothing`,
          publishers, es ? "es" : "en"
        );
      }
      added += await savePosts(items.map((i) => i.post));
      await x(`update sentiment_universe set "newsAt" = now() where symbol = $1`, c.symbol);
    } catch {
      // Google may slow down: the company stays first in the queue for the next run.
    }
    await sleep(400);
  });
  log(`Noticias: ${added} titulares nuevos`, "ok");
}

// ---------------------------------------------------------------- 4. classification

type Classified = { market: number | null; mentions: Array<{ symbol: string; stance: number; confidence: number; reason: string }> };

const geminiKey = () => process.env.GEMINI_API_KEY?.trim() || null;
/**
 * Free models to try, in order: the light ones first (fast), then the bigger one (slower, but often free of
 * load when the light ones say "high demand"). GEMINI_MODEL in back/.env puts one first. The last model that
 * answered is tried first next time.
 */
const GEMINI_MODELS = [
  ...(process.env.GEMINI_MODEL?.trim() ? [process.env.GEMINI_MODEL.trim()] : []),
  "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-flash-latest",
].filter((m, i, all) => all.indexOf(m) === i);
let geminiModel = GEMINI_MODELS[0];
/** Models that answered 404 (not available for this key): skipped from then on. */
const missingModels = new Set<string>();

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      i: { type: "INTEGER" },
      market: { type: "INTEGER", nullable: true },
      mentions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: { symbol: { type: "STRING" }, stance: { type: "INTEGER" }, confidence: { type: "NUMBER" }, reason: { type: "STRING" } },
          required: ["symbol", "stance", "confidence", "reason"],
        },
      },
    },
    required: ["i", "mentions"],
  },
};

const PROMPT = `You classify financial social media posts, video titles and news headlines for an educational market-sentiment dashboard.
For each item return:
- "market": the tone about the stock market as a whole: 1 bullish, -1 bearish, 0 neutral, null if it does not talk about the market.
- "mentions": the listed companies the item is about. Use the stock ticker as on Yahoo Finance (US: AAPL, BRK-B; Spain: SAN.MC, ITX.MC).
  For each: "stance" 1 = good news or positive view for the stock price, -1 = bad news or negative view, 0 = neutral or just informative;
  "confidence" 0..1 (how clear the tone is); "reason": at most 12 words in Spanish explaining why.
  If the item has a "hint" ticker, it was found searching that company: include it unless the item is clearly about something else.
  Do not invent companies that are not named or clearly implied. Return an empty list when there are none.
Answer only with the JSON array, one object per item, with the same "i".`;

/** Classifies up to 40 texts in one call. Throws "quota" when the free limit is reached. */
async function geminiBatch(key: string, items: Array<{ i: number; text: string; hint: string | null }>): Promise<Map<number, Classified>> {
  const body = {
    contents: [{ role: "user", parts: [{ text: `${PROMPT}\n\nItems:\n${JSON.stringify(items.map((it) => (it.hint ? it : { i: it.i, text: it.text })))}` }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
  };
  // Start with the model that worked last, then the others; each one gets a second chance after a pause.
  const order = [geminiModel, ...GEMINI_MODELS.filter((m) => m !== geminiModel)].filter((m) => !missingModels.has(m));
  const tries = [...order, ...order];
  let lastError = "sin modelos disponibles";
  for (const [n, model] of tries.entries()) {
    if (missingModels.has(model)) continue;
    if (n === order.length) await sleep(15_000); // second round: give Google a moment
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body), signal: AbortSignal.timeout(150_000),
      });
    } catch (e: any) {
      lastError = `${model}: ${e?.name === "TimeoutError" ? "sin respuesta en 150 s" : e?.message ?? e}`;
      continue;
    }
    if (res.status === 429) throw new Error("quota");
    // 402: the key's project is on the paid tier with no credit. Nothing will work until it changes: stop.
    if (res.status === 402) throw new Error("billing");
    if (res.status === 404) {
      missingModels.add(model);
      lastError = `${model}: no disponible`;
      continue;
    }
    // 503 "high demand" (overloaded for a while) or 500: try the next model.
    if (res.status === 503 || res.status === 500) {
      lastError = `${model}: saturado (${res.status})`;
      continue;
    }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = (await res.json())?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "[]";
    const out = new Map<number, Classified>();
    for (const r of JSON.parse(text) as any[]) out.set(Number(r.i), { market: r.market ?? null, mentions: Array.isArray(r.mentions) ? r.mentions : [] });
    geminiModel = model;
    return out;
  }
  throw new Error(`Gemini no responde (${lastError})`);
}

// Fallback without a key: a short list of finance words in English and Spanish.
const POSITIVE = /\b(beat[s]?|surge[sd]?|soar(s|ed)?|jump(s|ed)?|rall(y|ies|ied)|gain(s|ed)?|upgrade[sd]?|record high|bullish|buy|outperform|strong|growth|raise[sd]? (guidance|forecast)|tops?|rebound(s|ed)?|sube|suben|dispara|récord|alcista|compra|mejora|beneficio(s)? (sube|crece)|supera)\b/gi;
const NEGATIVE = /\b(miss(es|ed)?|plunge[sd]?|tumble[sd]?|drop(s|ped)?|fall(s|en)?|fell|sink(s)?|slump(s|ed)?|downgrade[sd]?|bearish|sell|underperform|weak|cut[s]? (guidance|forecast)|lawsuit|probe|recall|layoffs?|crash|baja|bajan|cae|caen|desploma|bajista|venta|pérdidas?|recorta|rebaja)\b/gi;
const MARKET = /\b(market[s]?|stocks|S&P|Nasdaq|Dow|Wall Street|equities|bolsa|mercados?|Ibex)\b/i;

// Uppercase words that are also tickers but usually mean something else.
const NOT_TICKERS = new Set(["CEO", "CFO", "USA", "GDP", "ETF", "IPO", "NOW", "ALL", "KEY", "FAST", "WELL", "LOW", "HAS", "ARE", "CAN", "NEWS", "BIG", "ONE", "DAY", "HUGE", "FOR", "THE", "AND"]);

/** Company names for the word list: "Nvidia" -> NVDA (names of 5+ letters, case-sensitive). */
let nameIndex: Array<{ re: RegExp; symbol: string }> = [];
function buildNameIndex(rows: Array<{ symbol: string; name: string }>) {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  nameIndex = rows
    .map((r) => ({ name: searchName(r.name), symbol: r.symbol }))
    .filter((r) => r.name.length >= 5)
    .map((r) => ({ re: new RegExp(`\\b${escape(r.name)}\\b`), symbol: r.symbol }));
}

function lexicon(text: string, hint: string | null, known: Set<string>): Classified {
  const pos = text.match(POSITIVE)?.length ?? 0;
  const neg = text.match(NEGATIVE)?.length ?? 0;
  const stance = Math.sign(pos - neg);
  const confidence = Math.min(0.6, 0.3 + 0.1 * Math.abs(pos - neg));
  const symbols = new Set<string>(hint ? [hint] : []);
  for (const m of text.matchAll(/\$([A-Z]{1,5}(?:[.-][A-Z])?)\b/g)) if (known.has(m[1].replace(".", "-"))) symbols.add(m[1].replace(".", "-"));
  for (const m of text.matchAll(/\b([A-Z]{3,5})\b/g)) if (known.has(m[1]) && !NOT_TICKERS.has(m[1])) symbols.add(m[1]);
  for (const n of nameIndex) if (symbols.size < 6 && n.re.test(text)) symbols.add(n.symbol);
  const reason = stance > 0 ? "Palabras positivas en el texto" : stance < 0 ? "Palabras negativas en el texto" : "Sin tono claro";
  return {
    market: symbols.size === 0 && MARKET.test(text) ? stance : null,
    mentions: [...symbols].map((symbol) => ({ symbol, stance, confidence, reason })),
  };
}

/** Maps a ticker the model wrote to one of the universe (BRK.B -> BRK-B, SAN -> SAN.MC). */
function normalizeSymbol(raw: string, known: Set<string>): string | null {
  const s = raw.trim().toUpperCase().replace(/^\$/, "").replace(/\.(?!MC$)/, "-");
  if (known.has(s)) return s;
  if (known.has(`${s}.MC`)) return `${s}.MC`;
  return null;
}

async function classifyPending(maxCalls: number): Promise<void> {
  const key = geminiKey();
  const universe = await q<{ symbol: string; name: string }>(`select distinct on (symbol) symbol, name from sentiment_universe`);
  const known = new Set(universe.map((r) => r.symbol));
  buildNameIndex(universe);
  // With a key, the posts the word list classified in the last 3 days get a second, better look.
  const pending = await q<{ id: string; text: string; hintSymbol: string | null }>(
    `select id, text, "hintSymbol" from sentiment_posts
      where "classifiedBy" is null or ($1 and "classifiedBy" = 'lexicon' and "postedAt" > now() - interval '3 days')
      order by ("classifiedBy" is null) desc, "postedAt" desc
      limit $2`,
    !!key, key ? maxCalls * 40 : 5000
  );
  if (!pending.length) return;
  log(`Clasificando ${pending.length} textos ${key ? `con Gemini (${geminiModel})` : "con la lista de palabras (sin clave de Gemini)"}…`);

  const save = async (id: string, c: Classified, by: string) => {
    const mentions = new Map<string, Classified["mentions"][number]>();
    for (const m of c.mentions) {
      const symbol = normalizeSymbol(m.symbol, known);
      if (symbol && !mentions.has(symbol)) mentions.set(symbol, { ...m, symbol });
    }
    const list = [...mentions.values()];
    await base.$transaction([
      base.$executeRawUnsafe(`delete from sentiment_mentions where "postId" = $1`, id),
      base.$executeRawUnsafe(
        `insert into sentiment_mentions ("postId", symbol, stance, confidence, reason)
           select $1, * from unnest($2::text[], $3::smallint[], $4::numeric[], $5::text[])`,
        id, list.map((m) => m.symbol), list.map((m) => Math.max(-1, Math.min(1, Math.round(m.stance)))),
        list.map((m) => Math.max(0, Math.min(1, Number(m.confidence) || 0.5))), list.map((m) => String(m.reason ?? "").slice(0, 160))
      ),
      base.$executeRawUnsafe(
        `update sentiment_posts set "classifiedBy" = $2, "classifiedAt" = now(), "marketStance" = $3 where id = $1`,
        id, by, c.market == null ? null : Math.max(-1, Math.min(1, Math.round(c.market)))
      ),
    ]);
  };

  if (!key) {
    await pool(pending, 6, (p) => save(p.id, lexicon(p.text, p.hintSymbol, known), "lexicon"));
    log(`Clasificados ${pending.length} textos con la lista de palabras`, "ok");
    return;
  }
  let done = 0;
  for (let start = 0; start < pending.length; start += 40) {
    const batch = pending.slice(start, start + 40);
    try {
      const result = await geminiBatch(key, batch.map((p, i) => ({ i, text: p.text, hint: p.hintSymbol })));
      for (const [i, p] of batch.entries()) await save(p.id, result.get(i) ?? { market: null, mentions: [] }, "gemini");
      done += batch.length;
      log(`Gemini: ${done}/${pending.length}`);
    } catch (e: any) {
      if (e?.message === "quota") {
        log("Límite gratis de Gemini alcanzado: el resto se clasifica en la próxima vuelta", "warn");
        break;
      }
      if (e?.message === "billing") {
        log("Gemini pide pago (el proyecto de la clave está en el plan de pago sin saldo). Usa una clave de un proyecto sin facturación: plan gratis. Mientras, la lista de palabras.", "warn");
        await pool(pending.slice(start), 6, (p) => save(p.id, lexicon(p.text, p.hintSymbol, known), "lexicon"));
        break;
      }
      // Google overloaded: the rest goes with the word list now, and Gemini looks at it again in the next rounds
      // (texts of the last 3 days classified by the word list get a second pass).
      log(`Gemini falló (${e?.message ?? e}): el resto con la lista de palabras, se reintenta en la próxima vuelta`, "warn");
      await pool(pending.slice(start), 6, (p) => save(p.id, lexicon(p.text, p.hintSymbol, known), "lexicon"));
      break;
    }
    await sleep(4500); // free tier: about 15 calls a minute
  }
  log(`Clasificados ${done} textos con Gemini`, "ok");
}

// ---------------------------------------------------------------- 5. gauges and track record

async function updateMetrics(): Promise<void> {
  const [have] = await q<{ fng: boolean; funding: boolean }>(
    `select exists (select 1 from market_metrics where key = 'crypto_fng' and day = current_date) as fng,
            exists (select 1 from market_metrics where key = 'btc_funding' and day = current_date) as funding`
  );
  if (!have.fng) {
    try {
      const res = await fetch("https://api.alternative.me/fng/?limit=400", { headers: UA });
      const data: any[] = (await res.json()).data ?? [];
      await x(
        `insert into market_metrics (day, key, value) select d, 'crypto_fng', v from unnest($1::date[], $2::numeric[]) as t(d, v)
         on conflict (day, key) do update set value = excluded.value`,
        data.map((d) => new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 10)), data.map((d) => Number(d.value))
      );
    } catch {
      log("Fear & Greed de cripto no disponible", "warn");
    }
  }
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
    const [meta, ctx] = await res.json();
    const i = meta.universe.findIndex((u: any) => u.name === "BTC");
    // Hourly funding rate, as a yearly rate.
    if (i >= 0) await x(`insert into market_metrics (day, key, value) values (current_date, 'btc_funding', $1) on conflict (day, key) do update set value = excluded.value`, Number(ctx[i].funding) * 24 * 365);
  } catch {
    if (!have.funding) log("Funding de BTC no disponible", "warn");
  }
}

/** Fills ret1/ret7/ret30 (and the 7-day hit) of the mentions whose days have passed. */
async function evaluateMentions(): Promise<void> {
  const ret = (sym: string, days: number) => `(
      (select close from sentiment_prices where symbol = ${sym} and day >= p."postedAt"::date + ${days} order by day limit 1)
    / nullif((select close from sentiment_prices where symbol = ${sym} and day <= p."postedAt"::date order by day desc limit 1), 0) - 1)`;
  const bench = `case when m.symbol like '%.MC' then '^IBEX' else 'SPY' end`;
  for (const [col, days] of [["ret1", 1], ["ret7", 7], ["ret30", 30]] as const) {
    await x(
      `update sentiment_mentions t set ${col} = v.r ${col === "ret7" ? `, excess7 = v.r - v.b, hit7 = case when t.stance = 0 then null else sign(v.r - v.b)::int = t.stance end` : ""}
         from (select m.id, ${ret("m.symbol", days)} as r, ${ret(bench, days)} as b
                 from sentiment_mentions m join sentiment_posts p on p.id = m."postId"
                where m.${col} is null and p."postedAt" < now() - interval '${days + 1} days') v
        where v.id = t.id and v.r is not null and v.b is not null
          and exists (select 1 from sentiment_prices s where s.symbol = t.symbol and s.day >= current_date - 5)`
    );
  }
}

// ---------------------------------------------------------------- the job

async function activeFunds(extra?: string): Promise<string[]> {
  if (extra) await x(`insert into sentiment_funds (fund) values ($1) on conflict (fund) do update set "lastUsedAt" = now()`, extra);
  const rows = await q<{ fund: string }>(`select fund from sentiment_funds where "lastUsedAt" > now() - interval '7 days'`);
  const funds = rows.map((r) => r.fund).filter((f) => FUNDS[f]);
  return funds.length ? funds : ["sp500"];
}

/** One round. `manual` = the button: more prices and news per round. */
function runJob(manual: boolean, fund?: string): Promise<void> {
  if (job.running) return job.running;
  job.events = [];
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.running = (async () => {
    try {
      const funds = await activeFunds(fund);
      for (const f of funds) await ensureUniverse(f);
      await updatePrices(funds, manual ? 700 : 250);
      await fetchInfluencers();
      await fetchNews(funds, manual ? 60 : 40);
      await updateMetrics();
      await classifyPending(manual ? 12 : 8);
      await evaluateMentions();
      log("Listo", "ok");
    } catch (e: any) {
      log(`Error: ${e?.message ?? e}`, "warn");
    } finally {
      job.finishedAt = new Date().toISOString();
      job.running = null;
    }
  })();
  return job.running;
}

// ---------------------------------------------------------------- reads

const clamp = (v: number) => Math.max(0, Math.min(100, v));
/** Each gauge as 0 (extreme fear) .. 100 (extreme greed). */
const GAUGE = {
  vix: (v: number) => clamp(((35 - v) / (35 - 12)) * 100),
  fng: (v: number) => clamp(v),
  trend: (ratio: number) => clamp(50 + (ratio - 1) * 500),
  breadth: (pct: number) => clamp(pct),
  social: (s: number) => clamp((s + 1) * 50),
  funding: (yearly: number) => clamp(50 + (yearly / 0.3) * 50),
};

/** Daily gauge history of a fund (last `days` days). */
async function gaugeHistory(fund: string, days: number) {
  const bench = FUNDS[fund].benchmark;
  const rows = await q<{ day: string; vix: number | null; fng: number | null; trend: number | null; breadth: number | null; social: number | null; n: number | null }>(
    `with days as (select day from sentiment_prices where symbol = $2 and day > current_date - $3::int),
     uni as (select symbol from sentiment_universe where fund = $1),
     sma as (
       select p.symbol, p.day, p.close,
              avg(p.close) over (partition by p.symbol order by p.day rows between 199 preceding and current row) as sma200,
              count(*) over (partition by p.symbol order by p.day rows between 199 preceding and current row) as n200
         from sentiment_prices p where p.symbol in (select symbol from uni union select $2) and p.day > current_date - $3::int - 300
     ),
     breadth as (
       select day, 100.0 * count(*) filter (where close > sma200) / nullif(count(*), 0) as pct
         from sma where n200 >= 200 and symbol in (select symbol from uni) group by day
     ),
     trend as (select day, close / sma200 as ratio from sma where symbol = $2 and n200 >= 200),
     social as (
       select p."postedAt"::date as day, avg(m.stance * m.confidence) as s, count(*) as n
         from sentiment_mentions m join sentiment_posts p on p.id = m."postId"
        where m.symbol in (select symbol from uni) group by 1
     )
     select to_char(d.day, 'YYYY-MM-DD') as day,
            (select close from sentiment_prices where symbol = '^VIX' and day <= d.day order by day desc limit 1)::float as vix,
            (select value from market_metrics where key = 'crypto_fng' and day <= d.day order by day desc limit 1)::float as fng,
            t.ratio::float as trend,
            b.pct::float as breadth, s.s::float as social, s.n::int as n
       from days d left join breadth b on b.day = d.day left join social s on s.day = d.day left join trend t on t.day = d.day
      order by d.day`,
    fund, bench, days
  );
  return rows.map((r) => {
    const parts = {
      vix: r.vix == null ? null : GAUGE.vix(r.vix),
      fng: r.fng == null ? null : GAUGE.fng(r.fng),
      trend: r.trend == null ? null : GAUGE.trend(r.trend),
      breadth: r.breadth == null ? null : GAUGE.breadth(r.breadth),
      // A day with very few mentions says little.
      social: r.social == null || (r.n ?? 0) < 5 ? null : GAUGE.social(r.social),
    };
    const vals = Object.values(parts).filter((v): v is number => v != null);
    return { day: r.day, gauge: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, parts, raw: { vix: r.vix, fng: r.fng, trend: r.trend, breadth: r.breadth, social: r.social } };
  });
}

/** Weight of each source: 0.5 (always wrong) .. 2 (always right), from its 7-day hits; 1.25 without history. */
const SOURCE_WEIGHT = `(
  select s.id, 0.5 + 1.5 * (count(*) filter (where m.hit7) + 1)::numeric / (count(m.hit7) + 2) as w,
         count(m.hit7)::int as evaluated, count(*) filter (where m.hit7)::int as hits, avg(m.excess7)::float as "avgExcess"
    from sentiment_sources s
    left join sentiment_posts p on p."sourceId" = s.id
    left join sentiment_mentions m on m."postId" = p.id
   group by s.id)`;

export function registerSentimentRoutes(app: Express): void {
  app.get("/api/v2/sentiment/overview", handler(async (req, res) => {
    const fund = FUNDS[String(req.query.fund)] ? String(req.query.fund) : "sp500";
    await activeFunds(fund);
    const history = await gaugeHistory(fund, 400);
    const [funding] = await q<{ value: number; day: string }>(`select value::float as value, to_char(day, 'YYYY-MM-DD') as day from market_metrics where key = 'btc_funding' order by day desc limit 1`);
    const [social] = await q<{ s: number | null; n: number; posts: number }>(
      `select avg(stance * confidence)::float as s, count(*)::int as n, count(distinct "postId")::int as posts
         from sentiment_mentions m join sentiment_posts p on p.id = m."postId"
        where p."postedAt" > now() - interval '3 days' and m.symbol in (select symbol from sentiment_universe where fund = $1)`, fund
    );
    const [marketTone] = await q<{ s: number | null; n: number }>(
      `select avg("marketStance")::float as s, count(*)::int as n from sentiment_posts where "marketStance" is not null and "postedAt" > now() - interval '3 days'`
    );
    const last = history.filter((h) => h.gauge != null).at(-1) ?? null;
    // Today's gauge: the last day of prices plus the live social tone and BTC funding.
    const parts = { ...(last?.parts ?? {}) } as Record<string, number | null>;
    if (social?.n >= 5) parts.social = GAUGE.social(social.s ?? 0);
    parts.funding = funding ? GAUGE.funding(funding.value) : null;
    const vals = Object.values(parts).filter((v): v is number => v != null);
    const [counts] = await q<{ companies: number; posts: number; pending: number; mentions: number; sources: number }>(
      `select (select count(*) from sentiment_universe where fund = $1)::int as companies,
              (select count(*) from sentiment_posts)::int as posts,
              (select count(*) from sentiment_posts where "classifiedBy" is null)::int as pending,
              (select count(*) from sentiment_mentions)::int as mentions,
              (select count(*) from sentiment_sources where curated)::int as sources`, fund
    );
    res.json({
      fund, funds: Object.entries(FUNDS).map(([id, f]) => ({ id, label: f.label, benchmark: f.benchmark })),
      gauge: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      parts, raw: { ...(last?.raw ?? {}), social: social?.s ?? null, funding: funding?.value ?? null, marketTone: marketTone?.s ?? null, marketTonePosts: marketTone?.n ?? 0 },
      asOf: last?.day ?? null,
      history: history.filter((h) => h.gauge != null).map((h) => ({ day: h.day, gauge: h.gauge })),
      counts, classifier: geminiKey() ? `Gemini (${geminiModel})` : "Lista de palabras (falta GEMINI_API_KEY)",
      job: { running: !!job.running, startedAt: job.startedAt, finishedAt: job.finishedAt, step: job.step },
    });
  }));

  // Every company of the fund: social score of the last 7 days, momentum and data volume.
  app.get("/api/v2/sentiment/stocks", handler(async (req, res) => {
    const fund = FUNDS[String(req.query.fund)] ? String(req.query.fund) : "sp500";
    const rows = await q(
      `with uni as (select symbol, name, sector from sentiment_universe where fund = $1),
       px as (
         select symbol, close, row_number() over (partition by symbol order by day desc) as rn
           from sentiment_prices where symbol in (select symbol from uni) and day > current_date - 420
       ),
       mom as (
         select symbol, max(close) filter (where rn = 1)::float as last, max(close) filter (where rn = 22)::float as m1,
                avg(close) filter (where rn <= 50)::float as sma50, avg(close) filter (where rn <= 200)::float as sma200,
                count(*)::int as n
           from px group by symbol
       ),
       w as ${SOURCE_WEIGHT},
       soc as (
         select m.symbol,
                sum(m.stance * m.confidence * w.w * power(0.5, extract(epoch from now() - p."postedAt") / 86400 / 2))
                  / nullif(sum(m.confidence * w.w * power(0.5, extract(epoch from now() - p."postedAt") / 86400 / 2)), 0) as score,
                count(*)::int as mentions, count(*) filter (where m.stance = 1)::int as bull, count(*) filter (where m.stance = -1)::int as bear,
                max(p."postedAt") as "lastAt"
           from sentiment_mentions m join sentiment_posts p on p.id = m."postId" join w on w.id = p."sourceId"
          where p."postedAt" > now() - interval '7 days' and m.symbol in (select symbol from uni)
          group by m.symbol
       )
       select u.symbol, u.name, u.sector, soc.score::float as score, coalesce(soc.mentions, 0) as mentions,
              coalesce(soc.bull, 0) as bull, coalesce(soc.bear, 0) as bear, soc."lastAt",
              mom.last, case when mom.m1 > 0 then mom.last / mom.m1 - 1 end as "ret1m",
              case when mom.n >= 50 then mom.last / mom.sma50 - 1 end as "vsSma50",
              case when mom.n >= 200 then mom.last / mom.sma200 - 1 end as "vsSma200"
         from uni u left join soc on soc.symbol = u.symbol left join mom on mom.symbol = u.symbol
        order by u.symbol`,
      fund
    );
    res.json({ fund, rows });
  }));

  // One company: its mentions of the last 30 days with the posts, and its track record.
  app.get("/api/v2/sentiment/stock/:symbol", handler(async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const [info] = await q(`select symbol, name, sector from sentiment_universe where symbol = $1 limit 1`, symbol);
    if (!info) throw new HttpError(404, "Empresa no encontrada.");
    const mentions = await q(
      `select m.stance, m.confidence::float as confidence, m.reason, m.ret1::float as ret1, m.ret7::float as ret7, m.ret30::float as ret30,
              m.excess7::float as excess7, m.hit7, p.text, p.url, p."postedAt", s.name as source, s.platform, s.curated
         from sentiment_mentions m join sentiment_posts p on p.id = m."postId" join sentiment_sources s on s.id = p."sourceId"
        where m.symbol = $1 and p."postedAt" > now() - interval '30 days'
        order by p."postedAt" desc limit 80`, symbol
    );
    const prices = await q(`select to_char(day, 'YYYY-MM-DD') as day, close::float as close from sentiment_prices where symbol = $1 and day > current_date - 95 order by day`, symbol);
    res.json({ ...info, mentions, prices });
  }));

  // Latest posts of the curated influencers that named a company or the market.
  app.get("/api/v2/sentiment/feed", handler(async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit) || 60);
    const posts = await q(
      `select p.id, p.text, p.url, p."postedAt", p."marketStance", s.name as source, s.platform,
              coalesce(json_agg(json_build_object('symbol', m.symbol, 'stance', m.stance, 'reason', m.reason)) filter (where m.id is not null), '[]') as mentions
         from sentiment_posts p join sentiment_sources s on s.id = p."sourceId"
         left join sentiment_mentions m on m."postId" = p.id
        where s.curated and p."classifiedBy" is not null and p."postedAt" > now() - interval '7 days'
        group by p.id, s.name, s.platform
       having count(m.id) > 0 or p."marketStance" is not null
        order by p."postedAt" desc limit $1`, limit
    );
    res.json({ posts });
  }));

  // Track record of every source with at least one evaluated call.
  app.get("/api/v2/sentiment/sources", handler(async (_req, res) => {
    const rows = await q(
      `with w as ${SOURCE_WEIGHT}
       select s.id, s.name, s.platform, s.curated, s.lang,
              (select count(*) from sentiment_posts p where p."sourceId" = s.id)::int as posts,
              (select count(*) from sentiment_mentions m join sentiment_posts p on p.id = m."postId" where p."sourceId" = s.id and m.stance <> 0)::int as calls,
              w.evaluated, w.hits, w."avgExcess", w.w::float as weight
         from sentiment_sources s join w on w.id = s.id
        where s.curated or w.evaluated > 0
        order by w.evaluated > 0 desc, w.w desc, posts desc`
    );
    res.json({ sources: rows });
  }));

  app.post("/api/v2/sentiment/refresh", handler(async (req, res) => {
    const fund = FUNDS[String(req.query.fund)] ? String(req.query.fund) : undefined;
    void runJob(true, fund);
    res.json({ started: true });
  }));

  app.get("/api/v2/sentiment/job", handler(async (req, res) => {
    const after = Number(req.query.after) || 0;
    res.json({ running: !!job.running, startedAt: job.startedAt, finishedAt: job.finishedAt, step: job.step, total: job.events.length, events: job.events.slice(after) });
  }));

  // Background rounds while the backend runs: first one a minute after start, then every 30 minutes.
  // Not on the public server (BACKGROUND_JOBS=off): the owner's computer runs it (src/server-mode.ts).
  if (backgroundJobs()) {
    setTimeout(() => void runJob(false), 60_000);
    setInterval(() => void runJob(false), 30 * 60_000);
  }
}
