// Tests of how the movements of the current accounts are classified (src/banking.ts → classify). Fictitious
// movements. Run after `npm run build`: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { classify } = require("../dist/banking");

const tx = (amount, description, counterparty = null, counterpartyIban = null) => ({ amount, description, counterparty, counterpartyIban });
const none = new Set();

test("comercios conocidos", () => {
  assert.equal(classify(tx(-23.4, "COMPRA TARJ. MERCADONA MADRID"), [], none).category, "supermercado");
  assert.equal(classify(tx(-12.99, "NETFLIX.COM"), [], none).category, "suscripciones");
  assert.equal(classify(tx(-40, "REPSOL ESTACION 123"), [], none).category, "transporte");
  assert.equal(classify(tx(-58, "RECIBO IBERDROLA CLIENTES"), [], none).category, "hogar");
});

test("la nómina solo cuenta si entra dinero", () => {
  assert.equal(classify(tx(1850, "NOMINA EMPRESA SL"), [], none).category, "nomina");
  assert.notEqual(classify(tx(-10, "NOMINA EMPRESA SL"), [], none).category, "nomina");
});

test("bizum según el sentido", () => {
  assert.equal(classify(tx(-15, "BIZUM ENVIADO"), [], none).category, "bizum");
  assert.equal(classify(tx(15, "BIZUM RECIBIDO"), [], none).category, "bizum_in");
});

test("traspasos a inversión y entre cuentas propias no son gasto", () => {
  const inv = classify(tx(-300, "TRASPASO A MYINVESTOR"), [], none);
  assert.equal(inv.category, "inversion");
  assert.equal(inv.internal, true);
  const own = classify(tx(200, "TRANSFERENCIA", "TITULAR", "ES00 1111 2222"), [], new Set(["ES0011112222"]));
  assert.equal(own.internal, true);
});

test("los intereses son ingreso aunque los pague un bróker", () => {
  const r = classify(tx(6.2, "INTERESES", "Trade Republic"), [], none);
  assert.equal(r.category, "otros_ingresos");
  assert.equal(r.internal, false);
});

test("las reglas del usuario van primero", () => {
  const rules = [{ pattern: "mercadona", category: "hogar", internal: false }];
  const r = classify(tx(-23.4, "COMPRA MERCADONA"), rules, none);
  assert.equal(r.category, "hogar");
  assert.equal(r.source, "learned");
});

test("lo desconocido va a otros", () => {
  assert.equal(classify(tx(-9, "XYZ 123"), [], none).category, "otros_gastos");
  assert.equal(classify(tx(9, "XYZ 123"), [], none).category, "otros_ingresos");
});

test("Mangopay no es la tienda Mango", () => {
  assert.notEqual(classify(tx(25, "Incoming transfer from Mangopay", "Mangopay"), [], none).category, "compras");
  assert.equal(classify(tx(-30, "MANGO VALENCIA"), [], none).category, "compras");
});
