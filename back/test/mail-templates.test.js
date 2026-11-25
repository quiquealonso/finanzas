// Tests of the mail templates made by users (src/mail-templates.ts): reading an e-mail with a template and masking
// personal data before anything is sent to the AI. Fictitious e-mails. Run after `npm run build`: `npm test`.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { maskPersonal, readWithTemplate, parseNumber } = require("../dist/mail-templates");

const FIELDS = {
  kind: { pattern: "Operación:\\s*(\\w+)", buy: ["compra"], sell: ["venta"] },
  date: { pattern: "Fecha de ejecución:\\s*([\\d/]+)", order: "dmy" },
  name: { pattern: "Producto:\\s*([^\\n]+)" },
  isin: { pattern: "ISIN:\\s*([A-Z0-9]{12})" },
  quantity: { pattern: "Títulos:\\s*([\\d.,]+)" },
  price: { pattern: "Precio:\\s*([\\d.,]+)" },
  amount: { pattern: "Importe total:\\s*([\\d.,]+)" },
  currency: { pattern: "Importe total:\\s*[\\d.,]+\\s*([A-Z]{3})" },
  defaultCurrency: "EUR",
  decimal: ",",
};
const mail = (body, subject = "Orden ejecutada") => ({ id: "x", from: "a@b.es", date: "2026-01-01", subject, body });

test("lee una compra con todos sus campos", () => {
  const { op, missing } = readWithTemplate("Broker", FIELDS, mail(
    "Operación: Compra\nProducto: APPLE INC\nISIN: US0378331005\nFecha de ejecución: 03/10/2026\nTítulos: 3\nPrecio: 231,40 USD\nImporte total: 1.694,20 USD"
  ));
  assert.deepEqual(missing, []);
  assert.equal(op.kind, "buy");
  assert.equal(op.date, "2026-10-03");
  assert.equal(op.name, "APPLE INC");
  assert.equal(op.isin, "US0378331005");
  assert.equal(op.quantity, 3);
  assert.equal(op.amount, 1694.2);
  assert.equal(op.currency, "USD");
});

test("dice qué campos no encuentra", () => {
  const { op, missing } = readWithTemplate("Broker", FIELDS, mail("Operación: Venta\nProducto: INDITEX"));
  assert.equal(op, null);
  assert.deepEqual(missing.sort(), ["amount", "date", "quantity"].sort());
});

test("números con coma o con punto decimal", () => {
  assert.equal(parseNumber("1.234,56", ","), 1234.56);
  assert.equal(parseNumber("1,234.56", "."), 1234.56);
});

test("tapa los datos personales y deja fechas, ISIN e importes", () => {
  const out = maskPersonal(
    "Estimado Juan Pérez, orden 1234567890 del 20/11/2026 (2026-11-20). ISIN US0378331005 por 2.345,67 EUR. " +
    "IBAN ES91 2100 0418 4502 0005 1332. DNI 12345678Z. Tel 612 345 678. Cuenta 0049 1500 0512 3456. juan@gmail.com"
  );
  for (const gone of ["Juan", "1234567890", "ES91", "12345678Z", "612 345 678", "0049 1500", "juan@gmail.com"]) assert.ok(!out.includes(gone), gone);
  for (const kept of ["20/11/2026", "2026-11-20", "US0378331005", "2.345,67"]) assert.ok(out.includes(kept), kept);
});
