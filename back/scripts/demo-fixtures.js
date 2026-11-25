// Saves the API answers of the "demo" user (scripts/demo-seed.js) as the data of the demo mode of the front:
// front/public/demo/*.json, read by front/src/app/demo/demo.interceptor.ts instead of calling the back.
//
//   node scripts/demo-fixtures.js      (the back must be running)
//
// One file per GET (key = path + sorted query, see keyOf), plus bundles for the endpoints with one answer per day or
// per company, and the series of every bank × type pair (the front adds them up for any filter).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const API = "http://localhost:3000";
const OUT = path.join(__dirname, "..", "..", "front", "public", "demo");
const token = jwt.sign({ sub: "demo", name: "Demo" }, process.env.AUTH_SECRET, { algorithm: "HS256", expiresIn: "1h" });

async function get(p) {
  const r = await fetch(API + p, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180_000) });
  if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Same rule as the front (demo.interceptor.ts → keyOf): "/v2/series?banks=a&types=b" → "v2_series__banks-a_types-b". */
function keyOf(p) {
  const [pathPart, query = ""] = p.replace(/^\/api\//, "").split("?");
  const params = [...new URLSearchParams(query).entries()].filter(([, v]) => v !== "").sort(([a], [b]) => a.localeCompare(b));
  const q = params.map(([k, v]) => `${k}-${v}`).join("_");
  return (pathPart + (q ? "__" + q : "")).replace(/[^a-zA-Z0-9_-]+/g, "_");
}

const written = [];
function save(name, data) {
  fs.writeFileSync(path.join(OUT, name + ".json"), JSON.stringify(data));
  written.push(name);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const simple = [
    "/api/v2/overview", "/api/v2/monthly", "/api/v2/movements?limit=500", "/api/v2/movements?limit=200", "/api/v2/movements?limit=50",
    "/api/v2/recurring", "/api/v2/realized", "/api/v2/real-estate", "/api/v2/intraday", "/api/v2/goals",
    "/api/v2/allocation-targets", "/api/v2/news?days=90", "/api/v2/calendar", "/api/v2/magic-formula", "/api/v2/perps",
    "/api/v2/wallets", "/api/v2/pending-orders", "/api/v2/saved-funds", "/api/v2/theses", "/api/v2/valuations/job",
    "/api/v2/sentiment/feed", "/api/v2/sentiment/sources", "/api/v2/sentiment/job",
  ];
  for (const p of simple) save(keyOf(p), await get(p));

  // Closings: every year with data.
  for (const y of [2024, 2025, 2026]) save(keyOf(`/api/v2/closings?year=${y}`), await get(`/api/v2/closings?year=${y}`));
  save(keyOf("/api/v2/closings"), await get("/api/v2/closings"));

  // Indexes of Sentimiento and Valoraciones.
  for (const fund of ["sp500", "nasdaq100", "ibex35"]) {
    save(keyOf(`/api/v2/sentiment/overview?fund=${fund}`), await get(`/api/v2/sentiment/overview?fund=${fund}`));
    save(keyOf(`/api/v2/sentiment/stocks?fund=${fund}`), await get(`/api/v2/sentiment/stocks?fund=${fund}`));
  }
  const valuations = {};
  for (const fund of ["sp500", "nasdaq100"]) {
    valuations[fund] = await get(`/api/v2/valuations?fund=${fund}`).catch(() => null);
    if (valuations[fund]) save(keyOf(`/api/v2/valuations?fund=${fund}`), valuations[fund]);
  }

  // Series: everything, and every bank × type pair with assets (any filter = sum of its pairs).
  const overview = await get("/api/v2/overview");
  save(keyOf("/api/v2/series?banks=&types="), await get("/api/v2/series?banks=&types="));
  const pairs = new Map();
  for (const a of overview.assets ?? []) pairs.set(`${a.bankId}|${a.typeCode}`, { bank: a.bankId, type: a.typeCode });
  const seriesBundle = {};
  for (const { bank, type } of pairs.values()) {
    seriesBundle[`${bank}|${type}`] = (await get(`/api/v2/series?banks=${bank}&types=${type}`)).series;
  }
  save("bundle_series_pairs", seriesBundle);

  // Indexes of Comparar: from 10 days before the first day of the portfolio (the page asks for that day; the demo
  // answers any "from" with this file).
  const first = (await get("/api/v2/series?banks=&types=")).series[0]?.date ?? "2024-01-01";
  const from = new Date(Date.parse(first.slice(0, 10)) - 10 * 86_400_000).toISOString().slice(0, 10);
  save(keyOf("/api/v2/benchmarks"), await get(`/api/v2/benchmarks?from=${from}`));

  // One answer per day: the day dialog of the calendar.
  const calendar = await get("/api/v2/calendar");
  const days = {};
  for (const d of calendar.days ?? []) {
    if (d.date < "2025-01-01") continue;
    days[d.date] = await get(`/api/v2/calendar/${d.date}`);
  }
  save("bundle_calendar_days", days);

  // Detail of the companies most likely to be opened: the first rows of each list.
  const companies = {};
  for (const fund of Object.keys(valuations)) {
    for (const row of (valuations[fund]?.rows ?? []).slice(0, 40)) {
      const sym = row.symbol ?? row.sym;
      if (sym && !companies[sym]) companies[sym] = await get(`/api/v2/valuations/company/${encodeURIComponent(sym)}`).catch(() => undefined);
    }
  }
  save("bundle_valuations_company", companies);
  const stocks = {};
  for (const fund of ["sp500", "nasdaq100", "ibex35"]) {
    const list = await get(`/api/v2/sentiment/stocks?fund=${fund}`);
    const rows = [...(list.rows ?? [])].sort((a, b) => (b.mentions7 ?? b.mentions ?? 0) - (a.mentions7 ?? a.mentions ?? 0)).slice(0, 25);
    for (const row of rows) {
      const sym = row.symbol;
      if (sym && !stocks[sym]) stocks[sym] = await get(`/api/v2/sentiment/stock/${encodeURIComponent(sym)}`).catch(() => undefined);
    }
  }
  save("bundle_sentiment_stock", stocks);

  // Mail import: the setup of the demo user (its banks and templates). The scan itself is simulated in the front.
  save(keyOf("/api/v2/mail-import/setup"), await get("/api/v2/mail-import/setup"));

  // Fund finder: one real search per risk profile (zone Global), replayed step by step by the demo.
  const finder = {};
  for (const profile of ["conservador", "moderado", "equilibrado", "dinamico", "agresivo"]) {
    const r = await fetch(API + "/api/v2/fund-finder", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile, regions: ["GLOBAL"] }),
    });
    const { jobId } = await r.json();
    let job;
    for (let i = 0; i < 120; i++) {
      await new Promise((ok) => setTimeout(ok, 2000));
      job = await get(`/api/v2/fund-finder/${jobId}?after=-1`);
      if (job.phase !== "running") break;
    }
    finder[profile] = job;
    console.log("fondos", profile, job.phase, job.picks?.length, job.model ?? "sin IA");
  }
  save("bundle_fund_finder", finder);

  save("index", { createdAt: new Date().toISOString(), files: written.slice() });
  const size = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`${written.length} ficheros, ${(size / 1e6).toFixed(1)} MB en front/public/demo`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
