// Magic Formula screen (Joel Greenblatt, "The Little Book That Still Beats the Market").
//
//   node scripts/magic-formula.js [minCapUsd=1000000000] [top=30] [--dry]
//
// Ranks US companies by two numbers and keeps the best sum of both ranks:
//   return on capital = EBIT / (net working capital + net fixed assets)   (a good business)
//   earnings yield    = EBIT / enterprise value                           (at a cheap price)
// Financials, utilities and real estate are left out, as the book does.
//
// Data, no API key needed:
//   - SEC XBRL "frames" (data.sec.gov): one call returns one figure for every filer and period.
//   - Nasdaq screener (api.nasdaq.com): price, market cap, sector of every US listed stock.
// EBIT is the last twelve months: the last four quarters (the fiscal fourth quarter = year - other three).
// Saves the run into magic_formula_runs / magic_formula_picks (see supabase/magic-formula.sql).
require("dotenv").config({ path: __dirname + "/../.env", quiet: true });
const { PrismaClient } = require("@prisma/client");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const [minCapArg, topArg] = args.filter((a) => !a.startsWith("--"));
const MIN_CAP = Number(minCapArg) || 1e9;
const TOP = Number(topArg) || 30;

// SEC asks automated clients for a User-Agent; a generic one is accepted.
const SEC_UA = "finanzas-research-script contact@example.com";
const EXCLUDED_SECTORS = new Set(["Finance", "Utilities", "Real Estate"]);
// A frame with fewer filers than this is not complete yet (companies still filing).
const MIN_FILERS = 2500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frameCache = new Map();

/** All values of one XBRL tag for one period, as Map(cik -> { val, start, end }). Missing frame = empty map. */
async function frame(tag, period) {
  const key = tag + "/" + period;
  if (frameCache.has(key)) return frameCache.get(key);
  await sleep(150); // SEC allows 10 requests a second
  const res = await fetch(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${period}.json`, { headers: { "User-Agent": SEC_UA } });
  const map = new Map();
  if (res.ok) for (const d of (await res.json()).data) map.set(d.cik, { val: d.val, start: d.start ? day(d.start) : null, end: day(d.end) });
  else if (res.status !== 404) throw new Error(`SEC ${tag} ${period}: HTTP ${res.status}`);
  frameCache.set(key, map);
  return map;
}
/** Date as a day number, to compare and subtract. */
const day = (iso) => Math.round(Date.parse(iso) / 86400000);
const today = day(new Date().toISOString().slice(0, 10));

/** Newest quarter with complete earnings, e.g. { year: 2026, q: 3 }: names the run and dates the balance sheet. */
async function latestPeriod() {
  const now = new Date().getFullYear();
  for (const year of [now, now - 1])
    for (const q of [4, 3, 2, 1]) if ((await frame("OperatingIncomeLoss", `CY${year}Q${q}`)).size >= MIN_FILERS) return { year, q };
  throw new Error("No complete SEC earnings frame found.");
}

/**
 * EBIT of the last twelve months per cik: Map(cik -> { ebit, annualOnly }).
 * Sums the last four back-to-back quarters. Companies don't file the fourth quarter of their fiscal year on its own,
 * so it is worked out as the fiscal year minus its other three quarters (works for any fiscal year end).
 * Without four recent quarters, the last fiscal year is used if it ended less than 15 months ago (annualOnly).
 */
async function ttmEbit() {
  const now = new Date().getFullYear();
  const quarters = new Map(), years = new Map();
  const add = (into, map) => { for (const [cik, v] of map) { if (!into.has(cik)) into.set(cik, []); into.get(cik).push(v); } };
  for (const y of [now - 2, now - 1, now]) {
    add(years, await frame("OperatingIncomeLoss", `CY${y}`));
    for (const q of [1, 2, 3, 4]) add(quarters, await frame("OperatingIncomeLoss", `CY${y}Q${q}`));
  }
  const out = new Map();
  for (const [cik, ys] of years) {
    const qs = [...(quarters.get(cik) ?? [])];
    for (const y of ys) {
      const inside = qs.filter((q) => q.start >= y.start - 5 && q.end <= y.end + 5).sort((a, b) => a.start - b.start);
      if (inside.length !== 3) continue;
      const val = y.val - inside.reduce((s, q) => s + q.val, 0);
      // The missing quarter is the gap: at the start, between two quarters, or at the end of the year.
      const gapAt = inside.findIndex((q, i) => (i === 0 ? q.start - y.start : q.start - inside[i - 1].end) > 20);
      if (gapAt === 0) qs.push({ val, start: y.start, end: inside[0].start - 1 });
      else if (gapAt > 0) qs.push({ val, start: inside[gapAt - 1].end + 1, end: inside[gapAt].start - 1 });
      else qs.push({ val, start: inside[2].end + 1, end: y.end });
    }
    const last4 = qs.sort((a, b) => b.end - a.end).slice(0, 4);
    const span = last4.length === 4 ? last4[0].end - last4[3].start : 0;
    const back2back = last4.every((q, i) => i === last4.length - 1 || Math.abs(q.start - last4[i + 1].end) <= 10);
    if (span >= 355 && span <= 375 && back2back && today - last4[0].end <= 200) {
      out.set(cik, { ebit: last4.reduce((s, q) => s + q.val, 0), annualOnly: false });
      continue;
    }
    const lastYear = ys.sort((a, b) => b.end - a.end)[0];
    if (today - lastYear.end <= 456) out.set(cik, { ebit: lastYear.val, annualOnly: true });
  }
  return out;
}

/** Balance sheet figures at the end of the period, falling back to the quarter before. */
async function balance({ year, q }) {
  const at = [`CY${year}Q${q}I`, q === 1 ? `CY${year - 1}Q4I` : `CY${year}Q${q - 1}I`];
  const tags = [
    "Assets", "AssetsCurrent", "LiabilitiesCurrent", "Goodwill", "IntangibleAssetsNetExcludingGoodwill",
    "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "DebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "LongTermDebtCurrent", "ShortTermBorrowings",
    "LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt",
  ];
  // Fixed assets are spread over several tags, and some companies only tag them in the annual report:
  // these also look at the last year end.
  const fixedAt = [...at, `CY${year - 1}Q4I`];
  const fixedTags = [
    "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization", "PropertyPlantAndEquipmentNet",
    "OilAndGasPropertySuccessfulEffortMethodNet", "OilAndGasPropertyFullCostMethodNet",
  ];
  const frames = {};
  for (const tag of tags) frames[tag] = await Promise.all(at.map((p) => frame(tag, p)));
  for (const tag of fixedTags) frames[tag] = await Promise.all(fixedAt.map((p) => frame(tag, p)));
  return (cik) => {
    // Use one balance date for every figure of a company: the newest where it reported current assets.
    const i = frames.AssetsCurrent.findIndex((m) => m.has(cik));
    if (i < 0) return null;
    const get = (tag) => frames[tag][i].get(cik)?.val;
    // Fixed assets: the newest date with any of the tags, then PP&E (with or without leases) + oil and gas properties.
    const j = fixedAt.findIndex((_, k) => fixedTags.some((t) => frames[t][k].has(cik)));
    const fixed = (tag) => (j < 0 ? undefined : frames[tag][j].get(cik)?.val);
    let ppe = (fixed(fixedTags[0]) ?? fixed(fixedTags[1]) ?? 0) + (fixed(fixedTags[2]) ?? fixed(fixedTags[3]) ?? 0);
    // Tags still miss the fixed assets of some companies (e.g. oil producers with their own tags). If the tagged
    // PP&E is under 10 % of the tangible long-term assets, use those instead: a lower, safer return on capital.
    const assets = get("Assets");
    if (assets != null) {
      const tangibleLongTerm = assets - get("AssetsCurrent") - (get("Goodwill") ?? 0) - (get("IntangibleAssetsNetExcludingGoodwill") ?? 0);
      if (ppe < 0.1 * tangibleLongTerm) ppe = tangibleLongTerm;
    }
    const ltdCurrent = get("LongTermDebtCurrent");
    return {
      assetsCurrent: get("AssetsCurrent"),
      liabilitiesCurrent: get("LiabilitiesCurrent"),
      cash: get("CashAndCashEquivalentsAtCarryingValue") ?? get("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents") ?? 0,
      ppe,
      shortDebt: get("DebtCurrent") ?? get("LongTermDebtAndCapitalLeaseObligationsCurrent") ?? (ltdCurrent ?? 0) + (get("ShortTermBorrowings") ?? 0),
      longDebt:
        get("LongTermDebtNoncurrent") ?? get("LongTermDebtAndCapitalLeaseObligations") ??
        (get("LongTermDebt") != null ? get("LongTermDebt") - (ltdCurrent ?? 0) : 0),
    };
  };
}

/** Every US listed stock from the Nasdaq screener: Map(normalized symbol -> row). */
async function listings() {
  const res = await fetch("https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true", {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Nasdaq screener: HTTP ${res.status}`);
  const map = new Map();
  for (const r of (await res.json()).data.rows) {
    map.set(norm(r.symbol), {
      symbol: r.symbol.trim().replace("/", "."),
      name: r.name.replace(/\s+(Common Stock|Class [A-C] (Common Stock|Ordinary Shares)|Ordinary Shares|Common Shares)\b.*$/i, "").trim(),
      sector: r.sector || null,
      industry: r.industry || null,
      marketCap: Number(r.marketCap) || 0,
      price: Number(String(r.lastsale).replace(/[$,]/g, "")) || null,
    });
  }
  return map;
}
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** SEC cik -> tickers. */
async function tickers() {
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "User-Agent": SEC_UA } });
  if (!res.ok) throw new Error(`SEC tickers: HTTP ${res.status}`);
  const map = new Map();
  for (const t of Object.values(await res.json())) {
    if (!map.has(t.cik_str)) map.set(t.cik_str, []);
    map.get(t.cik_str).push(t.ticker);
  }
  return map;
}

/** 1-based rank of each row by key, highest value first. */
function rankBy(rows, key, field) {
  [...rows].sort((a, b) => b[key] - a[key]).forEach((r, i) => (r[field] = i + 1));
}

async function main() {
  const period = await latestPeriod();
  const periodLabel = `CY${period.year}Q${period.q}`;
  const [ebits, bal, list, cikTickers] = [await ttmEbit(), await balance(period), await listings(), await tickers()];

  const rows = [];
  for (const [cik, { ebit, annualOnly }] of ebits) {
    if (!(ebit > 0)) continue;
    // One row per company: the listed share class with the biggest market cap.
    const listing = (cikTickers.get(cik) ?? []).map((t) => list.get(norm(t))).filter(Boolean).sort((a, b) => b.marketCap - a.marketCap)[0];
    if (!listing || listing.marketCap < MIN_CAP || EXCLUDED_SECTORS.has(listing.sector)) continue;
    const b = bal(cik);
    if (!b || b.assetsCurrent == null || b.liabilitiesCurrent == null) continue;
    // Working capital without the spare cash and without the short-term debt (that counts in EV).
    const nwc = Math.max(0, b.assetsCurrent - b.cash - (b.liabilitiesCurrent - b.shortDebt));
    const capital = nwc + b.ppe;
    const ev = listing.marketCap + b.shortDebt + b.longDebt - b.cash;
    if (capital <= 0 || ev <= 0) continue;
    rows.push({ ...listing, ebit, ev, annualOnly, earningsYield: ebit / ev, roc: ebit / capital });
  }

  rankBy(rows, "earningsYield", "rankEy");
  rankBy(rows, "roc", "rankRoc");
  rows.sort((a, b) => a.rankEy + a.rankRoc - (b.rankEy + b.rankRoc) || a.rankEy - b.rankEy);
  const top = rows.slice(0, TOP).map((r, i) => ({ ...r, rank: i + 1 }));
  const runDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

  if (!dry) {
    const prisma = new PrismaClient();
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`delete from magic_formula_runs where "runDate" = $1::date`, runDate);
        const [{ id }] = await tx.$queryRawUnsafe(
          `insert into magic_formula_runs ("runDate", "minCapUsd", universe, period) values ($1::date, $2, $3, $4) returning id`,
          runDate, MIN_CAP, rows.length, periodLabel
        );
        for (const r of top) {
          await tx.$executeRawUnsafe(
            `insert into magic_formula_picks ("runId", rank, symbol, name, sector, industry, "marketCapUsd", "priceUsd", "ebitUsd", "evUsd",
                                              "earningsYield", roc, "rankEy", "rankRoc", "annualOnly")
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            id, r.rank, r.symbol, r.name, r.sector, r.industry, r.marketCap, r.price, r.ebit, r.ev, r.earningsYield, r.roc, r.rankEy, r.rankRoc, r.annualOnly
          );
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log(JSON.stringify({
    runDate, period: periodLabel, minCapUsd: MIN_CAP, universe: rows.length, saved: !dry,
    top: top.map((r) => `${r.rank}. ${r.symbol} ${r.name} | EY ${(r.earningsYield * 100).toFixed(1)}% | ROC ${(r.roc * 100).toFixed(0)}%${r.annualOnly ? " | anual" : ""}`),
  }, null, 1));
}

main().catch((e) => {
  console.error(process.env.DEBUG ? e.stack : e.message);
  process.exit(1);
});
