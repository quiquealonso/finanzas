import express, { Express } from "express";
import { pdfText } from "./bbva-orders";
import { prisma } from "./prisma";
import { classifyAll } from "./banking";
import { handler, HttpError } from "./portfolio";

/**
 * Bank statements as PDF (page Gastos → «Importar extracto»): fills the history that Open Banking does not give
 * (Trade Republic only gives it from 1 Sept 2026). Only Trade Republic's «Certificado de saldo y movimientos» for now.
 * The PDF is read in memory (pdftotext) and not kept. Only the days BEFORE the first movement read with Open Banking
 * are saved, so nothing is counted twice; importing the same PDF again adds nothing.
 */
export type StatementTx = {
  date: string; amount: number; balance: number; type: string; description: string;
  counterparty: string | null; counterpartyIban: string | null;
};
export type Statement = { bank: string; iban: string; opening: number; closing: number | null; txs: StatementTx[]; mismatches: number };

const MONTHS: Record<string, string> = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", sept: "09", oct: "10", nov: "11", dic: "12" };
const MONEY = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
const TYPES = /\b(Transferencia|Inter[ée]s|Operar|Transacci[óo]n|con tarjeta|Comisi[óo]n|Dividendo|Rentabilidad|Recompensa|Saveback|Reembolso|Impuestos?|Bonificaci[óo]n)\b/g;
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Trade Republic «Certificado de saldo y movimientos» (pdftotext -layout). */
export function parseTradeRepublic(text: string): Statement {
  if (!/TRADE REPUBLIC BANK/i.test(text)) throw new HttpError(400, "No parece un extracto de Trade Republic.");
  const iban = /IBAN\s+([A-Z]{2}\d{2}[A-Z0-9]{10,30})/.exec(text)?.[1];
  if (!iban) throw new HttpError(400, "No encuentro el IBAN en el extracto.");
  const summary = /Cuenta corriente\s+(-?[\d.]+,\d{2})/.exec(text);
  const opening = summary ? num(summary[1]) : 0;
  const start = text.indexOf("TRANSACCIONES DE CUENTA");
  const end = text.indexOf("RESUMEN DEL BALANCE");
  if (start < 0) throw new HttpError(400, "No encuentro la lista de movimientos en el extracto.");
  const closing = end > 0 ? (() => { const m = text.slice(end).match(MONEY); return m ? num(m[0]) : null; })() : null;

  // Lines of the movements, without page headers and footers.
  const lines: string[] = [];
  let inFooter = false;
  for (const raw of text.slice(start, end > 0 ? end : undefined).split(/\r?\n/)) {
    if (/Trade Republic Bank GmbH, Sucursal/.test(raw)) { inFooter = true; continue; }
    if (inFooter) { if (/^Creado en /.test(raw.trim())) inFooter = false; continue; }
    if (/TRADE REPUBLIC BANK GMBH|^\s*FECHA\s+TIPO|^TRANSACCIONES DE CUENTA|^\s*DINERO\s+DINERO\s*$/.test(raw)) continue;
    lines.push(raw.replace(/\s{2,}DINERO\s+DINERO\s*$/, ""));
  }
  // Blocks separated by blank lines; a block with no amounts is text that the page break moved: it goes with the next.
  const blocks: string[][] = [];
  let cur: string[] = [];
  let carry: string[] = [];
  for (const l of [...lines, ""]) {
    if (l.trim()) { cur.push(l); continue; }
    if (!cur.length) continue;
    if ((cur.join(" ").match(MONEY) ?? []).length >= 2) { blocks.push([...cur, ...carry]); carry = []; }
    else carry.push(...cur);
    cur = [];
  }

  const txs: StatementTx[] = [];
  let prev = opening;
  let mismatches = 0;
  for (const b of blocks) {
    const all = b.join("\n");
    const moneyLine = b.find((l) => (l.match(MONEY) ?? []).length >= 2)!;
    const [amountTxt, balanceTxt] = (moneyLine.match(MONEY) ?? []).slice(-2);
    const day = /^\s{0,3}(\d{1,2})\b/.exec(b[0])?.[1];
    const month = /(?:^|\s)(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\b/.exec(all)?.[1];
    const year = /^\s*(20\d{2})\b/m.exec(all)?.[1];
    if (!day || !month || !year) continue;
    const balance = num(balanceTxt);
    // The sign comes from the balance (it never fails, whatever column the amount is in).
    const amount = round2(balance - prev);
    if (Math.abs(Math.abs(amount) - num(amountTxt)) > 0.01) { mismatches++; if (process.env.DEBUG_STATEMENTS) console.log("statement mismatch", year, month, day, amountTxt, balanceTxt, amount); }
    prev = balance;
    const type = (all.match(TYPES) ?? []).filter((t) => t !== "con tarjeta").join(" ") || "Movimiento";
    const description = b.map((l) => l.replace(MONEY, "").replace(/€/g, "")
        .replace(/^\s{0,3}\d{1,2}\b/, "").replace(/^\s*(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\b/, "")
        .replace(/^\s*20\d{2}\b/, "").replace(TYPES, ""))
      .join(" ").replace(/\s+/g, " ").trim();
    const ibanIn = /\(([A-Z]{2}\d{2}[A-Z0-9]{10,30})\)/.exec(description)?.[1] ?? null;
    const party = /(?:transfer for|transfer from)\s+(.+?)(?:\s*\(|$)/i.exec(description)?.[1]?.trim() ?? null;
    txs.push({
      date: `${year}-${MONTHS[month]}-${day.padStart(2, "0")}`, amount, balance, type,
      description: description.replace(/\s*\([A-Z]{2}\d{2}[A-Z0-9]{10,30}\)/, "").trim(),
      counterparty: party ?? (/tarjeta/i.test(all) ? description : null), counterpartyIban: ibanIn,
    });
  }
  if (!txs.length) throw new HttpError(400, "No he encontrado movimientos en el extracto.");
  return { bank: "Trade Republic", iban, opening, closing, txs, mismatches };
}

export function registerStatementRoutes(app: Express): void {
  // The PDF comes as the raw body (Content-Type: application/pdf); the global JSON parser would cut it at 100 kB.
  app.post("/api/v2/banking/statement", express.raw({ type: "application/pdf", limit: "15mb" }), handler(async (req, res) => {
    const pdf = req.body as Buffer;
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 4).toString() !== "%PDF") throw new HttpError(400, "Sube el extracto en PDF.");
    const st = parseTradeRepublic(await pdfText(pdf));
    const [acc] = await prisma.$queryRawUnsafe<Array<{ id: string; accountKey: string }>>(
      `select id, "accountKey" from bank_accounts where replace(iban, ' ', '') = $1`, st.iban);
    if (!acc) throw new HttpError(400, `Conecta primero esa cuenta de ${st.bank} con Open Banking (IBAN ···${st.iban.slice(-4)}): el extracto solo completa su historia.`);
    // Only before the first movement read with Open Banking: from there on the bank's own data rule.
    const [first] = await prisma.$queryRawUnsafe<Array<{ d: string | null }>>(
      `select to_char(min("bookingDate"), 'YYYY-MM-DD') as d from bank_transactions where "accountId" = $1 and key not like '%|stmt|%'`, acc.id);
    const until = first?.d ?? "9999-12-31";
    let imported = 0, skipped = 0;
    const rows = st.txs.filter((t) => t.date < until).map((t) => ({
      key: `${acc.accountKey}|stmt|${t.date}|${t.balance.toFixed(2)}|${t.amount.toFixed(2)}`,
      date: t.date, amount: t.amount, description: `${t.type}: ${t.description}`.slice(0, 500),
      counterparty: t.counterparty, iban: t.counterpartyIban,
    }));
    skipped = st.txs.length - rows.length;
    // From that day on the movements are already there, but some banks (Trade Republic) send them through Open
    // Banking with no text at all: the statement fills in the text of the ones with the same day and amount.
    const later = st.txs.filter((t) => t.date >= until);
    let enriched = 0;
    if (later.length) {
      const bare = await prisma.$queryRawUnsafe<Array<{ id: string; d: string; amount: unknown }>>(
        `select id, to_char("bookingDate", 'YYYY-MM-DD') as d, amount from bank_transactions
          where "accountId" = $1 and key not like '%|stmt|%' and coalesce(description, '') = '' order by "bookingDate", "createdAt"`, acc.id);
      const used = new Set<string>();
      const fills: Array<{ id: string; description: string; counterparty: string | null; iban: string | null }> = [];
      for (const s of later) {
        const m = bare.find((b) => !used.has(b.id) && b.d === s.date && Math.abs(Number(b.amount) - s.amount) < 0.005);
        if (!m) continue;
        used.add(m.id);
        fills.push({ id: m.id, description: `${s.type}: ${s.description}`.slice(0, 500), counterparty: s.counterparty, iban: s.counterpartyIban });
      }
      if (fills.length) enriched = Number(await prisma.$executeRawUnsafe(
        `update bank_transactions t set description = f.description, counterparty = f.counterparty, "counterpartyIban" = f.iban, note = 'texto del extracto'
           from jsonb_to_recordset($1::jsonb) as f(id text, description text, counterparty text, iban text) where t.id = f.id`, JSON.stringify(fills)));
    }
    // All in one statement (one by one is a round trip to the database each).
    if (rows.length) imported = Number(await prisma.$executeRawUnsafe(
      `insert into bank_transactions ("accountId", key, "bookingDate", amount, currency, description, counterparty, "counterpartyIban", status, note)
       select $1, r.key, r.date::date, r.amount, 'EUR', r.description, r.counterparty, r.iban, 'BOOK', 'extracto'
         from jsonb_to_recordset($2::jsonb) as r(key text, date text, amount numeric, description text, counterparty text, iban text)
       on conflict ("userId", key) do nothing`, acc.id, JSON.stringify(rows)));
    await classifyAll(false);
    res.json({
      bank: st.bank, read: st.txs.length, imported, skipped, enriched, until: first?.d ?? null,
      from: st.txs[0]?.date ?? null, to: st.txs[st.txs.length - 1]?.date ?? null,
      checked: st.mismatches === 0 && (st.closing === null || Math.abs(st.closing - st.txs[st.txs.length - 1].balance) < 0.01),
    });
  }));
}
