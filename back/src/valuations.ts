import { Express } from "express";
import { base, prisma } from "./prisma";
import { handler, HttpError } from "./portfolio";
import { ensureUniverse } from "./sentiment";

/**
 * Valuations ("Valoraciones"): a weekly photo of 16 usual valuation metrics of every US listed company with a
 * market cap of 1,000 M$ or more (see supabase/valuations.sql), plus the user's investment theses.
 *
 * Data without API key, the same way as the Magic Formula (scripts/magic-formula.js):
 *   - SEC XBRL "frames" (data.sec.gov): one call returns one figure of every filer for one period.
 *     Income statement figures (revenue, operating income, net income) are filed per quarter: the last twelve
 *     months are the last four quarters (the fiscal fourth quarter = fiscal year - the other three).
 *     Cash-flow figures (operating cash flow, capex, dividends, depreciation) are filed year-to-date, so they come
 *     from the last fiscal year.
 *   - Nasdaq screener (api.nasdaq.com): price, market cap, sector of every US listed stock.
 * Spanish companies (IBEX) have no free source of fundamentals: only US funds.
 */

const SEC_UA = { "User-Agent": "finanzas-research-script contact@example.com" };
const MIN_CAP = 1e9;
// A quarterly frame with fewer filers than this is not complete yet (companies still filing).
const MIN_FILERS = 2500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dayNum = (iso: string) => Math.round(Date.parse(iso) / 86_400_000);
const q = <T = any>(sql: string, ...args: unknown[]) => base.$queryRawUnsafe<T[]>(sql, ...args);

export const VALUATION_FUNDS: Record<string, string> = {
  sp500: "S&P 500",
  nasdaq100: "Nasdaq 100",
  us_large: "EE. UU. > 10.000 M$",
  us_all: "EE. UU. > 1.000 M$",
};

// ---------------------------------------------------------------- job state

type JobEvent = { at: string; text: string; level: "info" | "ok" | "warn" };
const job = { running: null as Promise<void> | null, startedAt: null as string | null, finishedAt: null as string | null, events: [] as JobEvent[] };
function log(text: string, level: JobEvent["level"] = "info") {
  job.events.push({ at: new Date().toISOString(), text, level });
}

// ---------------------------------------------------------------- SEC frames

type Fact = { val: number; start: number | null; end: number };
type Frame = Map<number, Fact>;

function frames() {
  const cache = new Map<string, Promise<Frame>>();
  // SEC allows 10 requests a second: each call takes the next free slot, 150 ms after the previous one.
  let nextSlot = 0;
  const slot = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    nextSlot = at + 150;
    await sleep(at - now);
  };
  const get = (tag: string, period: string): Promise<Frame> => {
    const key = `${tag}/${period}`;
    if (!cache.has(key)) {
      cache.set(key, (async () => {
        await slot();
        const res = await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${period}.json`, { headers: SEC_UA, signal: AbortSignal.timeout(60_000) });
        const map: Frame = new Map();
        if (res.ok) for (const d of (await res.json()).data) map.set(d.cik, { val: d.val, start: d.start ? dayNum(d.start) : null, end: dayNum(d.end) });
        else if (res.status !== 404) throw new Error(`SEC ${tag} ${period}: HTTP ${res.status}`);
        return map;
      })());
    }
    return cache.get(key)!;
  };
  return get;
}

type Ttm = { val: number; prev: number | null; annualOnly: boolean };

/**
 * Last twelve months of an income statement figure, and the twelve months before (for growth), per cik.
 * Without four recent back-to-back quarters, the last fiscal year (if it ended less than 15 months ago).
 */
async function ttm(get: ReturnType<typeof frames>, tag: string): Promise<Map<number, Ttm>> {
  const now = new Date().getFullYear();
  const today = dayNum(new Date().toISOString().slice(0, 10));
  const quarters = new Map<number, Fact[]>();
  const years = new Map<number, Fact[]>();
  const add = (into: Map<number, Fact[]>, map: Frame) => {
    for (const [cik, v] of map) {
      if (!into.has(cik)) into.set(cik, []);
      into.get(cik)!.push(v);
    }
  };
  for (const y of [now - 3, now - 2, now - 1, now]) {
    add(years, await get(tag, `CY${y}`));
    for (const n of [1, 2, 3, 4]) add(quarters, await get(tag, `CY${y}Q${n}`));
  }
  const sum = (list: Fact[]) => list.reduce((s, f) => s + f.val, 0);
  const valid = (list: Fact[]) => {
    if (list.length !== 4) return false;
    const span = list[0].end - (list[3].start ?? list[3].end);
    const back2back = list.every((f, i) => i === 3 || Math.abs((f.start ?? 0) - list[i + 1].end) <= 10);
    return span >= 355 && span <= 375 && back2back;
  };
  const out = new Map<number, Ttm>();
  for (const [cik, ys] of years) {
    const qs = [...(quarters.get(cik) ?? [])];
    for (const y of ys) {
      if (y.start == null) continue;
      const inside = qs.filter((f) => f.start != null && f.start >= y.start! - 5 && f.end <= y.end + 5).sort((a, b) => a.start! - b.start!);
      if (inside.length !== 3) continue;
      const val = y.val - sum(inside);
      const gapAt = inside.findIndex((f, i) => (i === 0 ? f.start! - y.start! : f.start! - inside[i - 1].end) > 20);
      if (gapAt === 0) qs.push({ val, start: y.start, end: inside[0].start! - 1 });
      else if (gapAt > 0) qs.push({ val, start: inside[gapAt - 1].end + 1, end: inside[gapAt].start! - 1 });
      else qs.push({ val, start: inside[2].end + 1, end: y.end });
    }
    qs.sort((a, b) => b.end - a.end);
    const last4 = qs.slice(0, 4);
    const prev4 = qs.slice(4, 8);
    if (valid(last4) && today - last4[0].end <= 200) {
      out.set(cik, { val: sum(last4), prev: valid(prev4) && Math.abs(last4[3].start! - 1 - prev4[0].end) <= 10 ? sum(prev4) : null, annualOnly: false });
      continue;
    }
    const sorted = ys.filter((y) => y.start != null).sort((a, b) => b.end - a.end);
    if (sorted[0] && today - sorted[0].end <= 456) {
      const before = sorted.find((y) => Math.abs(sorted[0].end - y.end - 365) <= 20);
      out.set(cik, { val: sorted[0].val, prev: before?.val ?? null, annualOnly: true });
    }
  }
  return out;
}

/** First tag with a value for each cik. */
function firstOf<T>(maps: Array<Map<number, T>>): Map<number, T> {
  const out = new Map<number, T>();
  for (const m of maps) for (const [cik, v] of m) if (!out.has(cik)) out.set(cik, v);
  return out;
}

/** Last fiscal year of a cash-flow figure (ended less than 15 months ago), per cik. */
async function annual(get: ReturnType<typeof frames>, tag: string): Promise<Map<number, number>> {
  const now = new Date().getFullYear();
  const today = dayNum(new Date().toISOString().slice(0, 10));
  const out = new Map<number, Fact>();
  for (const y of [now - 2, now - 1, now]) {
    for (const [cik, f] of await get(tag, `CY${y}`)) {
      if (today - f.end > 456) continue;
      const cur = out.get(cik);
      if (!cur || f.end > cur.end) out.set(cik, f);
    }
  }
  return new Map([...out].map(([cik, f]) => [cik, f.val]));
}

async function latestPeriod(get: ReturnType<typeof frames>): Promise<{ year: number; q: number }> {
  const now = new Date().getFullYear();
  for (const year of [now, now - 1]) for (const n of [4, 3, 2, 1]) if ((await get("OperatingIncomeLoss", `CY${year}Q${n}`)).size >= MIN_FILERS) return { year, q: n };
  throw new Error("No hay datos completos de la SEC.");
}

/** Balance sheet at the end of the period (falling back to the quarter before): same rules as the Magic Formula. */
async function balance(get: ReturnType<typeof frames>, { year, q: n }: { year: number; q: number }) {
  const at = [`CY${year}Q${n}I`, n === 1 ? `CY${year - 1}Q4I` : `CY${year}Q${n - 1}I`];
  const tags = [
    "Assets", "AssetsCurrent", "LiabilitiesCurrent", "Goodwill", "IntangibleAssetsNetExcludingGoodwill",
    "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "LongTermDebtCurrent", "ShortTermBorrowings",
    "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt",
    "StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ];
  const fixedAt = [...at, `CY${year - 1}Q4I`];
  const fixedTags = [
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization", "PropertyPlantAndEquipmentNet",
    "OilAndGasPropertySuccessfulEffortMethodNet", "OilAndGasPropertyFullCostMethodNet",
  ];
  const f: Record<string, Frame[]> = {};
  for (const tag of tags) f[tag] = await Promise.all(at.map((p) => get(tag, p)));
  for (const tag of fixedTags) f[tag] = await Promise.all(fixedAt.map((p) => get(tag, p)));
  return (cik: number) => {
    // One balance date for every figure: the newest where it reported total assets.
    const i = f.Assets.findIndex((m) => m.has(cik));
    if (i < 0) return null;
    const g = (tag: string) => f[tag][i].get(cik)?.val;
    const j = fixedAt.findIndex((_, k) => fixedTags.some((t) => f[t][k].has(cik)));
    const fixed = (tag: string) => (j < 0 ? undefined : f[tag][j].get(cik)?.val);
    let ppe = (fixed(fixedTags[0]) ?? fixed(fixedTags[1]) ?? 0) + (fixed(fixedTags[2]) ?? fixed(fixedTags[3]) ?? 0);
    const assets = g("Assets")!;
    const assetsCurrent = g("AssetsCurrent");
    if (assetsCurrent != null) {
      const tangibleLongTerm = assets - assetsCurrent - (g("Goodwill") ?? 0) - (g("IntangibleAssetsNetExcludingGoodwill") ?? 0);
      if (ppe < 0.1 * tangibleLongTerm) ppe = tangibleLongTerm;
    }
    const ltdCurrent = g("LongTermDebtCurrent");
    return {
      assetsCurrent, liabilitiesCurrent: g("LiabilitiesCurrent"),
      cash: g("CashAndCashEquivalentsAtCarryingValue") ?? g("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents") ?? 0,
      ppe,
      shortDebt: g("DebtCurrent") ?? g("LongTermDebtAndCapitalLeaseObligationsCurrent") ?? (ltdCurrent ?? 0) + (g("ShortTermBorrowings") ?? 0),
      longDebt: g("LongTermDebtNoncurrent") ?? g("LongTermDebtAndCapitalLeaseObligations") ?? (g("LongTermDebt") != null ? g("LongTermDebt")! - (ltdCurrent ?? 0) : 0),
      equity: g("StockholdersEquity") ?? g("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest") ?? null,
    };
  };
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Every US listed stock from the Nasdaq screener: Map(normalized symbol -> row). */
async function listings() {
  const res = await fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", {
    headers: { "User-Agent": "finanzas-class-project/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Nasdaq screener: HTTP ${res.status}`);
  const map = new Map<string, { symbol: string; name: string; sector: string | null; industry: string | null; marketCap: number; price: number | null }>();
  for (const r of (await res.json()).data.rows) {
    map.set(norm(r.symbol), {
      // Yahoo style (BRK-B), like the sentiment universe.
      symbol: r.symbol.trim().replace(/[/.]/g, "-"),
      name: r.name.replace(/\s+(Common Stock|Class [A-C] (Common Stock|Ordinary Shares)|Ordinary Shares|Common Shares|American Depositary Shares)\b.*$/i, "").trim(),
      sector: r.sector || null, industry: r.industry || null,
      marketCap: Number(r.marketCap) || 0, price: Number(String(r.lastsale).replace(/[$,]/g, "")) || null,
    });
  }
  return map;
}

/** SEC cik -> tickers. */
async function tickers(): Promise<Map<number, string[]>> {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: SEC_UA });
  if (!res.ok) throw new Error(`SEC tickers: HTTP ${res.status}`);
  const map = new Map<number, string[]>();
  for (const t of Object.values<any>(await res.json())) {
    if (!map.has(t.cik_str)) map.set(t.cik_str, []);
    map.get(t.cik_str)!.push(t.ticker);
  }
  return map;
}

// ---------------------------------------------------------------- the photo

const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null && b > 0 ? a / b : null);

async function takePhoto(): Promise<void> {
  const get = frames();
  log("Buscando el último trimestre completo en la SEC…");
  const period = await latestPeriod(get);
  const periodLabel = `CY${period.year}Q${period.q}`;
  log(`Datos hasta ${periodLabel}. Descargando cuentas de resultados (últimos 12 meses)…`);
  const ebit = await ttm(get, "OperatingIncomeLoss");
  const netIncome = await ttm(get, "NetIncomeLoss");
  const revenue = firstOf([await ttm(get, "RevenueFromContractWithCustomerExcludingAssessedTax"), await ttm(get, "Revenues")]);
  log("Descargando flujos de caja y dividendos (último año fiscal)…");
  const cfo = firstOf([await annual(get, "NetCashProvidedByUsedInOperatingActivities"), await annual(get, "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations")]);
  const capex = firstOf([await annual(get, "PaymentsToAcquirePropertyPlantAndEquipment"), await annual(get, "PaymentsToAcquireProductiveAssets")]);
  const dividends = firstOf([await annual(get, "PaymentsOfDividendsCommonStock"), await annual(get, "PaymentsOfDividends")]);
  const da = firstOf([await annual(get, "DepreciationDepletionAndAmortization"), await annual(get, "DepreciationAndAmortization"), await annual(get, "DepreciationAmortizationAndAccretionNet"), await annual(get, "Depreciation")]);
  log("Descargando balances…");
  const bal = await balance(get, period);
  log("Precios y capitalización (Nasdaq)…");
  const [list, cikTickers] = [await listings(), await tickers()];
  const mom = new Map((await q<{ symbol: string; r: number }>(
    // 12-month price change of the companies with daily prices (those of the sentiment page).
    `select a.symbol, (a.close / nullif(y.close, 0) - 1)::float as r
       from (select distinct on (symbol) symbol, close from sentiment_prices where day > current_date - 7 order by symbol, day desc) a
       join (select distinct on (symbol) symbol, close from sentiment_prices
              where day between current_date - 380 and current_date - 350 order by symbol, abs(day - (current_date - 365))) y using (symbol)`
  )).map((r) => [r.symbol, r.r]));

  const rows: Array<{ symbol: string; name: string; sector: string | null; industry: string | null; price: number | null; marketCap: number; metrics: Record<string, number | null>; raw: Record<string, number | boolean | null> }> = [];
  for (const [cik, tks] of cikTickers) {
    // One row per company: the listed share class with the biggest market cap.
    const listing = tks.map((t) => list.get(norm(t))).filter((l): l is NonNullable<typeof l> => !!l).sort((a, b) => b.marketCap - a.marketCap)[0];
    if (!listing || listing.marketCap < MIN_CAP) continue;
    const b = bal(cik);
    const e = ebit.get(cik), ni = netIncome.get(cik), rev = revenue.get(cik);
    if (!b || (!e && !ni && !rev)) continue;
    const mcap = listing.marketCap;
    const debt = (b.shortDebt ?? 0) + (b.longDebt ?? 0);
    const ev = mcap + debt - b.cash;
    const d = da.get(cik);
    const ebitda = e && d != null ? e.val + d : null;
    const c = cfo.get(cik), x = capex.get(cik);
    const div = dividends.get(cik) ?? (c != null ? 0 : null);
    const nwc = b.assetsCurrent != null && b.liabilitiesCurrent != null ? Math.max(0, b.assetsCurrent - b.cash - (b.liabilitiesCurrent - b.shortDebt)) : null;
    const capital = nwc != null ? nwc + b.ppe : null;
    rows.push({
      symbol: listing.symbol, name: listing.name, sector: listing.sector, industry: listing.industry, price: listing.price, marketCap: mcap,
      metrics: {
        pe: ni && ni.val > 0 ? mcap / ni.val : null,
        divYield: div != null ? div / mcap : null,
        payout: ni && ni.val > 0 && div != null ? div / ni.val : null,
        pb: ratio(mcap, b.equity),
        ps: ratio(mcap, rev?.val),
        evEbitda: ebitda && ebitda > 0 && ev > 0 ? ev / ebitda : null,
        fcfYield: c != null && x != null ? (c - x) / mcap : null,
        roe: ni && b.equity && b.equity > 0 ? ni.val / b.equity : null,
        roic: e && capital && capital > 0 ? e.val / capital : null,
        opMargin: e ? ratio(e.val, rev?.val) : null,
        netMargin: ni ? ratio(ni.val, rev?.val) : null,
        netDebtEbitda: ebitda && ebitda > 0 ? (debt - b.cash) / ebitda : null,
        revGrowth: rev && rev.prev && rev.prev > 0 ? rev.val / rev.prev - 1 : null,
        epsGrowth: ni && ni.prev && ni.prev > 0 ? ni.val / ni.prev - 1 : null,
        earningsYield: e && ev > 0 ? e.val / ev : null,
        mom12: mom.get(listing.symbol) ?? null,
      },
      raw: {
        revenue: rev?.val ?? null, ebit: e?.val ?? null, netIncome: ni?.val ?? null, ebitda, equity: b.equity, cash: b.cash, debt, ev,
        cfo: c ?? null, capex: x ?? null, dividends: div, annualOnly: !!(e?.annualOnly || ni?.annualOnly),
      },
    });
  }
  // Round to keep the rows small.
  for (const r of rows) for (const k of Object.keys(r.metrics)) if (r.metrics[k] != null) r.metrics[k] = Number(r.metrics[k]!.toPrecision(5));

  const runDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  log(`Guardando ${rows.length} empresas…`);
  await base.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`delete from valuation_runs where "runDate" = $1::date`, runDate);
    const [{ id }] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into valuation_runs ("runDate", period, companies) values ($1::date, $2, $3) returning id`, runDate, periodLabel, rows.length
    );
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      await tx.$executeRawUnsafe(
        `insert into valuation_rows ("runId", symbol, name, sector, industry, "priceUsd", "marketCapUsd", metrics, raw)
           select $1, * from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::numeric[], $8::jsonb[], $9::jsonb[])
         on conflict ("runId", symbol) do nothing`,
        id, part.map((r) => r.symbol), part.map((r) => r.name), part.map((r) => r.sector), part.map((r) => r.industry),
        part.map((r) => r.price), part.map((r) => r.marketCap), part.map((r) => JSON.stringify(r.metrics)), part.map((r) => JSON.stringify(r.raw))
      );
    }
  }, { timeout: 120_000 });
  log(`Foto del ${runDate}: ${rows.length} empresas (datos hasta ${periodLabel})`, "ok");
}

function runJob(): Promise<void> {
  if (job.running) return job.running;
  job.events = [];
  job.startedAt = new Date().toISOString();
  job.finishedAt = null;
  job.running = (async () => {
    try {
      for (const f of ["sp500", "nasdaq100"]) await ensureUniverse(f);
      await takePhoto();
    } catch (e: any) {
      log(`Error: ${e?.message ?? e}`, "warn");
    } finally {
      job.finishedAt = new Date().toISOString();
      job.running = null;
    }
  })();
  return job.running;
}

// ---------------------------------------------------------------- routes

/** Latest close we know of a symbol (daily prices of the sentiment page, else the last photo). */
async function lastPrices(symbols: string[]): Promise<Map<string, number>> {
  if (!symbols.length) return new Map();
  const rows = await q<{ symbol: string; price: number }>(
    `select s as symbol, coalesce(
        (select close from sentiment_prices where symbol = s order by day desc limit 1),
        (select r."priceUsd" from valuation_rows r join valuation_runs v on v.id = r."runId" where r.symbol = s order by v."runDate" desc limit 1)
      )::float as price
       from unnest($1::text[]) s`, symbols
  );
  return new Map(rows.filter((r) => r.price != null).map((r) => [r.symbol, r.price]));
}

export function registerValuationRoutes(app: Express): void {
  app.get("/api/v2/valuations", handler(async (req, res) => {
    const fund = VALUATION_FUNDS[String(req.query.fund)] ? String(req.query.fund) : "sp500";
    const runs = await q<{ id: string; runDate: string; period: string; companies: number }>(
      `select id, to_char("runDate", 'YYYY-MM-DD') as "runDate", period, companies from valuation_runs order by "runDate" desc limit 52`
    );
    const run = runs.find((r) => r.id === req.query.run) ?? runs[0] ?? null;
    const funds = Object.entries(VALUATION_FUNDS).map(([id, label]) => ({ id, label }));
    const jobState = { running: !!job.running, startedAt: job.startedAt, finishedAt: job.finishedAt };
    if (!run) {
      res.json({ run: null, runs: [], fund, funds, rows: [], job: jobState });
      return;
    }
    const filter =
      fund === "us_all" ? "true"
      : fund === "us_large" ? `r."marketCapUsd" >= 10000000000`
      : `r.symbol in (select symbol from sentiment_universe where fund = $2)`;
    const rows = await q(
      `select r.symbol, r.name, r.sector, r.industry, r."priceUsd"::float as "priceUsd", r."marketCapUsd"::float as "marketCapUsd", r.metrics,
              (r.raw->>'annualOnly')::boolean as "annualOnly"
         from valuation_rows r where r."runId" = $1 and ${filter}
        order by r."marketCapUsd" desc`,
      ...(fund === "us_all" || fund === "us_large" ? [run.id] : [run.id, fund])
    );
    const theses = await prisma.$queryRawUnsafe<Array<{ symbol: string; stance: number }>>(`select symbol, stance from investment_theses`);
    res.json({ run, runs: runs.map((r) => ({ id: r.id, runDate: r.runDate })), fund, funds, rows, theses, job: jobState });
  }));

  // One company: every photo (how its valuation moved) and the user's thesis.
  app.get("/api/v2/valuations/company/:symbol", handler(async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const history = await q(
      `select to_char(v."runDate", 'YYYY-MM-DD') as "runDate", v.period, r.name, r.sector, r.industry, r."priceUsd"::float as "priceUsd",
              r."marketCapUsd"::float as "marketCapUsd", r.metrics, r.raw
         from valuation_rows r join valuation_runs v on v.id = r."runId" where r.symbol = $1 order by v."runDate" desc`, symbol
    );
    if (!history.length) throw new HttpError(404, "Empresa no encontrada.");
    const [thesis] = await prisma.$queryRawUnsafe<any[]>(
      `select symbol, name, stance, thesis, "targetPrice"::float as "targetPrice", "priceAtWrite"::float as "priceAtWrite", "createdAt", "updatedAt"
         from investment_theses where symbol = $1`, symbol
    );
    const price = (await lastPrices([symbol])).get(symbol) ?? null;
    res.json({ symbol, history, thesis: thesis ?? null, price });
  }));

  app.post("/api/v2/valuations/refresh", handler(async (_req, res) => {
    void runJob();
    res.json({ started: true });
  }));

  app.get("/api/v2/valuations/job", handler(async (req, res) => {
    const after = Number(req.query.after) || 0;
    res.json({ running: !!job.running, startedAt: job.startedAt, finishedAt: job.finishedAt, total: job.events.length, events: job.events.slice(after) });
  }));

  // ---------------- investment theses (per user)

  app.get("/api/v2/theses", handler(async (_req, res) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select symbol, name, stance, thesis, "targetPrice"::float as "targetPrice", "priceAtWrite"::float as "priceAtWrite", "createdAt", "updatedAt"
         from investment_theses order by "updatedAt" desc`
    );
    const prices = await lastPrices(rows.map((r) => r.symbol));
    res.json({ theses: rows.map((r) => ({ ...r, price: prices.get(r.symbol) ?? null })) });
  }));

  app.put("/api/v2/theses/:symbol", handler(async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const body = req.body ?? {};
    const stance = [1, 0, -1].includes(Number(body.stance)) ? Number(body.stance) : 1;
    const thesis = String(body.thesis ?? "").slice(0, 5000);
    const target = body.targetPrice === null || body.targetPrice === "" || body.targetPrice === undefined ? null : Number(body.targetPrice);
    if (target != null && !(target > 0)) throw new HttpError(400, "El precio objetivo no es válido.");
    const [company] = await q<{ name: string }>(`select name from valuation_rows where symbol = $1 limit 1`, symbol);
    if (!company) throw new HttpError(404, "Empresa no encontrada.");
    const price = (await lastPrices([symbol])).get(symbol) ?? null;
    await prisma.$executeRawUnsafe(
      `insert into investment_theses (symbol, name, stance, thesis, "targetPrice", "priceAtWrite") values ($1, $2, $3, $4, $5, $6)
       on conflict ("userId", symbol) do update set stance = excluded.stance, thesis = excluded.thesis, "targetPrice" = excluded."targetPrice", "updatedAt" = now()`,
      symbol, company.name, stance, thesis, target, price
    );
    res.json({ ok: true });
  }));

  app.delete("/api/v2/theses/:symbol", handler(async (req, res) => {
    await prisma.$executeRawUnsafe(`delete from investment_theses where symbol = $1`, String(req.params.symbol).toUpperCase());
    res.json({ ok: true });
  }));

  // A new photo every week: checked two minutes after start and then every 6 hours.
  const check = async () => {
    const [last] = await q<{ fresh: boolean }>(`select coalesce(max("runDate") > current_date - 7, false) as fresh from valuation_runs`);
    if (!last?.fresh) void runJob();
  };
  setTimeout(() => void check().catch(() => undefined), 120_000);
  setInterval(() => void check().catch(() => undefined), 6 * 3_600_000);
}
