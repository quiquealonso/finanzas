// Tests of how investments are recognised among bank movements (src/bank-investments.ts → detectInvestment).
// Fictitious movements. Run after `npm run build`: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { detectInvestment } = require("../dist/bank-investments");

const tx = (amount, description, counterparty = null) => ({ amount, description, counterparty });

test("compra en Trade Republic con ISIN y títulos", () => {
  const d = detectInvestment(tx(-619.6, "Operar: Buy trade US0000000001 EMPRESA DEMO INC., quantity: 5"), "Trade Republic");
  assert.equal(d.kind, "trade");
  assert.equal(d.side, "buy");
  assert.equal(d.isin, "US0000000001");
  assert.equal(d.name, "EMPRESA DEMO INC.");
  assert.equal(d.quantity, 5);
});

test("plan de ahorro y venta", () => {
  assert.equal(detectInvestment(tx(-50, "Operar: Savings plan execution LU0000000001 FONDO DEMO ETF Acc"), "Trade Republic").side, "buy");
  assert.equal(detectInvestment(tx(300, "Operar: Sell trade DE0000000001 DEMO AG, quantity: 10"), "Trade Republic").side, "sell");
});

test("compra de valores en el banco, sin más datos", () => {
  const d = detectInvestment(tx(-1000, "COMPRA DE VALORES COMPRA DE VALORES"), "BBVA");
  assert.equal(d.kind, "securities");
  assert.equal(d.quantity, null);
});

test("dinero enviado a una plataforma", () => {
  assert.equal(detectInvestment(tx(-300, "TRASPASO A MYINVESTOR"), "BBVA").platform, "MyInvestor");
  assert.equal(detectInvestment(tx(-500, "Outgoing transfer for Lemon Way Sas"), "Trade Republic").platform, "Lemon Way");
});

test("no es inversión: gastos normales y el propio banco", () => {
  assert.equal(detectInvestment(tx(-23, "MERCADONA"), "BBVA"), null);
  assert.equal(detectInvestment(tx(-1, "TRADE REPUBLIC CARD FEE"), "Trade Republic"), null);
  assert.equal(detectInvestment(tx(300, "TRASPASO DESDE MYINVESTOR"), "BBVA"), null);
});
