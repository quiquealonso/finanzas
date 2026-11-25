// Creates the fictitious portfolio of the "demo" user (supabase/demo.sql) through the local API, so every figure is
// computed exactly like for a real user. Prices are the real Yahoo closes of each day; the person and the amounts are
// invented. Then `node scripts/demo-fixtures.js` saves its API answers as the data of the demo mode of the front.
//
//   node scripts/demo-seed.js            (the back must be running; refuses if "demo" already has data)
//   node scripts/demo-seed.js --reset    (deletes the demo user's data first: delete_user_data('demo'))
//
// Never touches user1 or user2: everything goes through the API with a token of "demo" (signed with AUTH_SECRET).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const jwt = require("jsonwebtoken");
const { createClient } = require("./prisma-client");
const { userClient } = require("./user-client");

const API = "http://localhost:3000";
const USER = "demo";
const START = "2024-01-02";
const UA = { "User-Agent": "Mozilla/5.0 (finanzas-class-project)" };

const token = jwt.sign({ sub: USER, name: "Demo" }, process.env.AUTH_SECRET, { algorithm: "HS256", expiresIn: "2h" });

async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Daily closes since START: Map("YYYY-MM-DD" → close). */
async function closes(symbol) {
  const from = Math.floor(new Date(START + "T00:00:00Z").getTime() / 1000) - 10 * 86400;
  const to = Math.floor(Date.now() / 1000);
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${from}&period2=${to}&interval=1d`, { headers: UA });
  const res = (await r.json())?.chart?.result?.[0];
  if (!res) throw new Error(`Sin precios de ${symbol}`);
  const map = new Map();
  res.timestamp.forEach((t, i) => {
    const c = res.indicators.quote[0].close[i];
    if (c != null) map.set(new Date(t * 1000).toISOString().slice(0, 10), c);
  });
  return map;
}

/** Close on that day or the last one before it. */
function priceOn(map, day) {
  let best = null;
  for (const [d, c] of map) if (d <= day) best = c;
  if (best == null) throw new Error(`Sin precio para ${day}`);
  return best;
}

/** First working day (Mon–Fri) on or after the given day. */
function workday(day) {
  const d = new Date(day + "T12:00:00Z");
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const months = [];
for (let d = new Date(START.slice(0, 7) + "-01T12:00:00Z"); d.toISOString().slice(0, 10) <= today; d.setUTCMonth(d.getUTCMonth() + 1)) {
  months.push(d.toISOString().slice(0, 7));
}

async function main() {
  const db = createClient();
  try {
    const [{ n }] = await db.$queryRawUnsafe(`select count(*)::int as n from banks where "userId" = $1`, USER);
    if (n > 0) {
      if (!process.argv.includes("--reset")) throw new Error(`"demo" ya tiene datos (${n} bancos). Usa --reset para empezar de cero.`);
      await db.$executeRawUnsafe(`select public.delete_user_data($1)`, USER);
      console.log("Datos de demo borrados.");
    }
  } finally {
    await db.$disconnect();
  }

  // ---------------------------------------------------------------- banks and assets
  const SYMBOLS = {
    world: "0P00000WLG.F", sp500: "0P00000SUJ.F", iwda: "IWDA.AS", emim: "EMIM.AS", gold: "4GLD.DE",
    itx: "ITX.MC", ibe: "IBE.MC", asml: "ASML.AS", aapl: "AAPL", btc: "BTC-EUR", eth: "ETH-EUR",
  };
  const px = {};
  for (const [k, s] of Object.entries(SYMBOLS)) px[k] = await closes(s);
  const eurusd = await closes("EURUSD=X");
  console.log("Precios descargados.");

  const banks = {};
  for (const name of ["MyInvestor", "Trade Republic", "Binance"]) {
    const dash = await call("POST", "/api/banks", { name });
    banks[name] = dash.banks.find((b) => b.name === name).id;
  }
  const asset = async (name, bank, typeCode, symbol, currency = "EUR") => {
    const a = await call("POST", "/api/v2/assets", { name, bankId: banks[bank], typeCode, currency, symbol });
    return a.id ?? a.asset?.id;
  };
  const A = {
    cashMI: await asset("Cuenta MyInvestor", "MyInvestor", "LIQUID", ""),
    cashTR: await asset("Cuenta Trade Republic", "Trade Republic", "LIQUID", ""),
    cashBN: await asset("Saldo Binance", "Binance", "LIQUID", ""),
    world: await asset("Vanguard Global Stock Index", "MyInvestor", "FUND", SYMBOLS.world),
    sp500: await asset("Vanguard US 500 Stock Index", "MyInvestor", "FUND", SYMBOLS.sp500),
    iwda: await asset("iShares Core MSCI World", "Trade Republic", "ETF", SYMBOLS.iwda),
    emim: await asset("iShares Core MSCI Emerging Markets IMI", "Trade Republic", "ETF", SYMBOLS.emim),
    gold: await asset("Xetra-Gold", "Trade Republic", "METAL", SYMBOLS.gold),
    itx: await asset("Inditex", "Trade Republic", "STOCK", SYMBOLS.itx),
    ibe: await asset("Iberdrola", "Trade Republic", "STOCK", SYMBOLS.ibe),
    asml: await asset("ASML", "Trade Republic", "STOCK", SYMBOLS.asml),
    aapl: await asset("Apple", "Trade Republic", "STOCK", SYMBOLS.aapl, "USD"),
    btc: await asset("Bitcoin", "Binance", "CRYPTO", SYMBOLS.btc),
    eth: await asset("Ethereum", "Binance", "CRYPTO", SYMBOLS.eth),
  };
  console.log("Bancos y activos creados.");

  // ---------------------------------------------------------------- movements, oldest first
  const ops = [];
  const deposit = (date, cash, amount, note) => ops.push({ date, body: { kind: "deposit", assetId: A[cash], amount, note } });
  const withdraw = (date, cash, amount, note) => ops.push({ date, body: { kind: "withdraw", assetId: A[cash], amount, note } });
  const buy = (date, key, eur, note) => ops.push({ date, key, eur, side: "buy", note });
  const sell = (date, key, share, note) => ops.push({ date, key, share, side: "sell", note });

  // Buys are new money; sales go to "Pendiente de reinvertir" (the app's rule) and one buy reinvests it.
  deposit("2024-01-02", "cashMI", 3000, "Colchón de emergencia");
  deposit("2024-01-02", "cashBN", 150, "Saldo para comisiones");
  buy("2024-01-03", "world", 4000, "Primera compra");
  buy("2024-01-03", "sp500", 2000, "Primera compra");
  buy("2024-01-04", "iwda", 2000);
  buy("2024-02-12", "btc", 1200);
  buy("2024-03-11", "itx", 1500);
  buy("2024-05-13", "eth", 600);
  buy("2024-06-10", "asml", 1600);
  buy("2024-06-17", "emim", 800);
  buy("2024-09-09", "aapl", 1200);
  buy("2024-11-11", "btc", 500);
  buy("2025-01-13", "gold", 900, "Algo de oro para diversificar");
  buy("2025-02-10", "ibe", 1000);
  sell("2025-03-10", "btc", 0.25, "Recojo beneficios");
  withdraw("2025-08-04", "cashMI", 1200, "Vacaciones");
  deposit("2024-01-02", "cashTR", 500, "Saldo en la cuenta");
  sell("2025-07-14", "asml", 0.4);
  ops.push({ date: "2025-09-08", key: "emim", eur: 600, side: "buy", reinvest: true, note: "Reinvierto lo de ASML" });
  sell("2026-04-13", "ibe", 1, "Vendo toda la posición");
  // Every month: salary savings into MyInvestor and the plan into the index funds; the ETF from Trade Republic.
  for (const m of months.slice(1)) {
    const day = workday(`${m}-05`);
    if (day > today) break;
    deposit(day, "cashMI", 100, "Ahorro del mes");
    buy(day, "world", 300, "Aportación periódica");
    buy(day, "sp500", 150, "Aportación periódica");
    if (m >= "2024-06") buy(day, "iwda", 150, "Plan de inversión");
  }
  ops.sort((a, b) => a.date.localeCompare(b.date));

  let done = 0;
  for (const op of ops) {
    if (op.body) {
      await call("POST", "/api/v2/movements", { ...op.body, date: op.date });
    } else {
      const key = op.key;
      const local = priceOn(px[key], op.date);
      const fx = key === "aapl" ? 1 / priceOn(eurusd, op.date) : 1;
      if (op.side === "buy") {
        const quantity = Math.floor((op.eur / (local * fx)) * 1e6) / 1e6;
        await call("POST", "/api/v2/movements", { kind: "buy", assetId: A[key], quantity, price: local, fxToEur: fx, date: op.date, useCash: !!op.reinvest, note: op.note });
      } else {
        const held = await heldQuantity(A[key]);
        const quantity = op.share >= 1 ? held : Math.floor(held * op.share * 1e6) / 1e6;
        await call("POST", "/api/v2/movements", { kind: "sell", assetId: A[key], quantity, price: local, fxToEur: fx, date: op.date, useCash: true, note: op.note });
      }
    }
    if (++done % 20 === 0) console.log(`${done}/${ops.length} movimientos`);
  }
  console.log(`${ops.length} movimientos.`);

  // ---------------------------------------------------------------- the rest of the app
  await call("POST", "/api/v2/real-estate", { name: "Residencial Ruzafa (Valencia)", bankName: "Urbanitae", amountEur: 2000, ratePct: 9.5, termMonths: 18, startDate: "2025-06-02" });
  const nextMonth = new Date(today + "T12:00:00Z");
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const startMonth = nextMonth.toISOString().slice(0, 7);
  await call("POST", "/api/v2/recurring", { assetId: A.world, amountEur: 300, dayOfMonth: 5, startMonth, fromCash: true, note: "Plan mensual" });
  await call("POST", "/api/v2/recurring", { assetId: A.sp500, amountEur: 150, dayOfMonth: 5, startMonth, fromCash: true, note: "Plan mensual" });
  await call("POST", "/api/v2/recurring", { assetId: A.iwda, amountEur: 150, dayOfMonth: 5, startMonth, fromCash: true });
  await call("POST", "/api/v2/goals", { name: "Entrada de un piso", targetEur: 45000, targetDate: "2029-06-30", monthlyEur: 600 });
  await call("POST", "/api/v2/goals", { name: "Independencia financiera", targetEur: 400000, targetDate: "2050-12-31", monthlyEur: 750 });
  await call("PUT", "/api/v2/allocation-targets", {
    rows: [
      { typeCode: "FUND", pct: 55 }, { typeCode: "ETF", pct: 20 }, { typeCode: "STOCK", pct: 10 }, { typeCode: "CRYPTO", pct: 6 },
      { typeCode: "METAL", pct: 4 }, { typeCode: "REAL_ESTATE", pct: 3 }, { typeCode: "LIQUID", pct: 2 },
    ],
  });
  const [y, mNow] = today.split("-").map(Number);
  for (let m = 1; m < mNow; m++) await call("POST", "/api/v2/closings/close", { year: y, month: m }).catch((e) => console.log("cierre", m, e.message.slice(0, 80)));
  console.log("Listo: cartera demo creada.");
}

/** Units held of an asset now (the sells go in date order, so it is the holding on the sale day). */
async function heldQuantity(assetId) {
  const db = userClient(USER);
  try {
    const [row] = await db.$queryRawUnsafe(`select quantity::float as q from assets where id = $1`, assetId);
    return Math.floor(Number(row.q) * 1e6) / 1e6;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
