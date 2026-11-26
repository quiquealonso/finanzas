// Tests of the Trade Republic statement reader (src/bank-statements.ts). Invented statement with the same layout as
// `pdftotext -layout`: dates split over lines, "sept", a page break in the middle of a movement. Run after `npm run build`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseTradeRepublic } = require("../dist/bank-statements");

const TEXT = `TRADE REPUBLIC BANK GMBH, SUCURSAL EN ESPAÑA C/ VELAZQUEZ 50 - PLANTA 5, MADRID 28001 - MADRID

TITULAR DEMO                                                                          FECHA           01 ene 2026 - 30 oct 2026
Calle Falsa 1                                                                         IBAN      ES0000000000000000000001

PRODUCTO               BALANCE INICIAL                   ENTRADA DE DINERO  SALIDA DE DINERO                                  BALANCE FINAL

Cuenta corriente       100,00                            1.010,00           215,50                                              894,50

TRANSACCIONES DE CUENTA

FECHA TIPO             DESCRIPCIÓN                                                           ENTRADA DE SALIDA DE             BALANCE

                                                                                             DINERO      DINERO

12 ene  Transferencia  Incoming transfer from TITULAR DEMO                                   1.000,00 €                       1.100,00 €
2026                   (ES0000000000000000000002)

01                     Interest payment                                                      10,00 €                          1.110,00 €
sept Interés
2026

Trade Republic Bank GmbH, Sucursal en España  www.traderepublic.es
Creado en 2026-10-30 10:00:00 Europe/Madrid (UTC+01:00)                                                                       Página 1 de 2
TRADE REPUBLIC BANK GMBH, SUCURSAL EN ESPAÑA C/ VELAZQUEZ 50 - PLANTA 5, MADRID 28001 - MADRID

FECHA TIPO             DESCRIPCIÓN                                                              ENTRADA DE SALIDA DE          BALANCE

                       Buy trade DE0000000001 EMPRESA DEMO AG, quantity: 10                     DINERO   DINERO

03 oct  Operar                                                                                           200,00 €  910,00 €
2026

04 oct Transacción     MERCADONA VALENCIA                                                                15,50 €   894,50 €
2026 con tarjeta

RESUMEN DEL BALANCE                                                                                                                     SALDO
a 30 oct 2026                                                                                                                 894,50 €
`;

test("lee fechas partidas, «sept» y el salto de página", () => {
  const s = parseTradeRepublic(TEXT);
  assert.equal(s.iban, "ES0000000000000000000001");
  assert.equal(s.mismatches, 0);
  assert.deepEqual(s.txs.map((t) => [t.date, t.amount]), [["2026-01-12", 1000], ["2026-09-01", 10], ["2026-10-03", -200], ["2026-10-04", -15.5]]);
  assert.equal(s.txs.at(-1).balance, s.closing);
});

test("contraparte, IBAN y texto de cada movimiento", () => {
  const [inc, , buy, card] = parseTradeRepublic(TEXT).txs;
  assert.equal(inc.counterparty, "TITULAR DEMO");
  assert.equal(inc.counterpartyIban, "ES0000000000000000000002");
  assert.match(buy.description, /Buy trade DE0000000001 EMPRESA DEMO AG/);
  assert.match(card.description, /MERCADONA VALENCIA/);
  assert.ok(!card.description.includes("€"));
});

test("rechaza lo que no es de Trade Republic", () => {
  assert.throws(() => parseTradeRepublic("Extracto de otro banco"));
});
