// Invented movements of the demo's current accounts (page Gastos), saved as answers of the demo mode of the front:
// front/public/demo/v2_banking_*.json. Nothing real: made-up salary, rent and shops, the same every time (fixed seed).
// The categories come from the same rules as the real app (src/banking.ts → classify).
//
//   npm run build && node scripts/demo-banking.js
const fs = require("fs");
const path = require("path");
const { classify, CATEGORIES } = require("../dist/banking");

const OUT = path.join(__dirname, "..", "..", "front", "public", "demo");
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (list) => list[Math.floor(rnd() * list.length)];
const money = (min, max) => Math.round((min + rnd() * (max - min)) * 100) / 100;

const year = new Date().getFullYear();
const lastMonth = new Date().getMonth(); // 0-based, the current month is partial
const today = new Date().toISOString().slice(0, 10);
const txs = [];
let n = 0;
// Own accounts (invented IBANs): a transfer between them is not income nor expense.
const OWN = new Set(["ES0000000000000000000001", "DE00000000000000000002"]);
function add(bank, account, date, amount, description, counterparty = null, counterpartyIban = null) {
  if (date > today) return;
  const c = classify({ amount, description, counterparty, counterpartyIban }, [], OWN);
  txs.push({ id: `demo-tx-${++n}`, date, amount, currency: "EUR", description, counterparty, category: c.category, categorySource: c.source, internal: c.internal, note: null, account, bank });
}
const d = (m, day) => `${year}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day, 28)).padStart(2, "0")}`;

for (let m = 0; m <= lastMonth; m++) {
  const B = ["BBVA", "Cuenta Online"];
  const T = ["Trade Republic", "Cuenta corriente"];
  add(...B, d(m, 27), 1850 + (m === 5 || m === 11 ? 1850 : 0), "NOMINA EMPRESA EJEMPLO SL", "EMPRESA EJEMPLO SL");
  add(...B, d(m, 1), -650, "ALQUILER PISO", "PROPIETARIO EJEMPLO");
  add(...B, d(m, 5), -money(38, 72), "RECIBO IBERDROLA CLIENTES", "IBERDROLA");
  add(...B, d(m, 8), -30, "RECIBO DIGI SPAIN TELECOM", "DIGI");
  add(...B, d(m, 3), -12.99, "NETFLIX.COM", "NETFLIX");
  add(...T, d(m, 12), -10.99, "SPOTIFY", "SPOTIFY");
  add(...T, d(m, 2), -34.9, "BASIC-FIT SPAIN", "BASIC-FIT");
  add(...B, d(m, 2), -300, "TRASPASO A MYINVESTOR", "MYINVESTOR");
  add(...B, d(m, 15), -200, "TRANSFERENCIA A TRADE REPUBLIC", "TRADE REPUBLIC");
  add(...T, d(m, 15), 200, "TRANSFERENCIA DESDE BBVA", "TITULAR DEMO", "ES0000000000000000000001");
  add(...T, d(m, 16), -150, "SAVINGS PLAN EXECUTION", "Trade Republic");
  for (let i = 0; i < 6; i++) add(...pick([B, T]), d(m, 1 + Math.floor(rnd() * 28)), -money(14, 85), pick(["MERCADONA", "LIDL", "CARREFOUR EXPRESS", "DIA"]));
  for (let i = 0; i < 5; i++) add(...pick([B, T]), d(m, 1 + Math.floor(rnd() * 28)), -money(6, 48), pick(["BAR LA ESQUINA", "TELEPIZZA", "GLOVO", "STARBUCKS", "RESTAURANTE EL PATIO", "100 MONTADITOS"]));
  for (let i = 0; i < 3; i++) add(...T, d(m, 1 + Math.floor(rnd() * 28)), -money(10, 60), pick(["REPSOL", "RENFE VIAJEROS", "CABIFY", "BICIMAD"]));
  for (let i = 0; i < 2; i++) add(...pick([B, T]), d(m, 1 + Math.floor(rnd() * 28)), -money(15, 120), pick(["AMAZON EU SARL", "ZARA", "DECATHLON", "PRIMARK"]));
  if (rnd() < 0.6) add(...B, d(m, 1 + Math.floor(rnd() * 28)), -money(10, 40), "BIZUM ENVIADO CENA", "AMIGO DEMO");
  if (rnd() < 0.4) add(...B, d(m, 1 + Math.floor(rnd() * 28)), money(10, 30), "BIZUM RECIBIDO", "AMIGA DEMO");
  if (rnd() < 0.35) add(...T, d(m, 1 + Math.floor(rnd() * 28)), -money(20, 70), pick(["FARMACIA CENTRAL", "OPTICA VISION"]));
  if (m === 2 || m === 7) add(...T, d(m, 10), -money(180, 420), pick(["RYANAIR", "BOOKING.COM", "AIRBNB"]));
  if (m === 8) add(...B, d(m, 9), -420, "MATRICULA UNIVERSIDAD", "UNIVERSIDAD EJEMPLO");
  add(...T, d(m, 28), money(4, 9), "INTERESES", "Trade Republic");
}
txs.sort((a, b) => b.date.localeCompare(a.date));

const now = new Date();
const status = {
  configured: true,
  redirectUrl: "http://localhost:3000/api/banking/callback",
  categories: CATEGORIES,
  links: [
    { id: "demo-link-bbva", aspsp: "BBVA", country: "ES", validUntil: new Date(now.getTime() + 142 * 86400000).toISOString(), status: "active", lastSyncAt: now.toISOString(), lastError: null, createdAt: now.toISOString(),
      accounts: [{ id: "demo-acc-1", linkId: "demo-link-bbva", name: "Cuenta Online", iban: "ES00 ···· 0001", currency: "EUR", balance: 2384.12, balanceAt: now.toISOString(), hidden: false, movements: txs.filter((t) => t.bank === "BBVA").length }] },
    { id: "demo-link-tr", aspsp: "Trade Republic", country: "DE", validUntil: new Date(now.getTime() + 11 * 86400000).toISOString(), status: "active", lastSyncAt: now.toISOString(), lastError: null, createdAt: now.toISOString(),
      accounts: [{ id: "demo-acc-2", linkId: "demo-link-tr", name: "Cuenta corriente", iban: "DE00 ···· 0002", currency: "EUR", balance: 1520.4, balanceAt: now.toISOString(), hidden: false, movements: txs.filter((t) => t.bank === "Trade Republic").length }] },
  ],
};
const banks = { banks: [{ name: "BBVA", country: "ES", logo: null, beta: false, days: 180 }, { name: "Trade Republic", country: "DE", logo: null, beta: false, days: 180 }] };
fs.writeFileSync(path.join(OUT, "v2_banking_status.json"), JSON.stringify(status));
fs.writeFileSync(path.join(OUT, "v2_banking_transactions.json"), JSON.stringify({ transactions: txs }));
fs.writeFileSync(path.join(OUT, "v2_banking_banks.json"), JSON.stringify(banks));
console.log(`${txs.length} movimientos inventados guardados en front/public/demo/`);
