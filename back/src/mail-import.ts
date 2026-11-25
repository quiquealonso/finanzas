import { Express } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { prisma, currentUser, withUser, DEFAULT_USER } from "./prisma";
import { createMovement, guessRegions, handler, HttpError, refreshSnapshots } from "./portfolio";
import { attachment, gmailConnected, Mail, searchMails } from "./gmail";
import { markUsed, MailTemplate, readWithTemplate, userTemplateFor } from "./mail-templates";
import { BbvaOrder, parseBbvaOrder, pdfText, savePendingOrder, tickerForIsin } from "./bbva-orders";

// Import of broker operations from e-mails, in two steps so nothing is written without the user seeing it:
//   1. scan: the user picks banks of their own and a start day; each bank with a template (MyInvestor, BBVA) gets
//      its e-mails read with fixed rules (no AI model). Every operation found is marked "new", "exists" (the user
//      already has it: same asset, side, ±3 days, units ±1 %), "imported" (this e-mail was imported before) or
//      "cancelled". Nothing is written.
//   2. apply: the rows the user ticked are written; the "exists" ones are only linked to their e-mail.
// Everything is per user: the "already imported" mark (external_operations, source "mail") carries the user in its key,
// and mail_import_state remembers each user's last import (see supabase/mail-import.sql). On 2026-11-24 a shared mark
// duplicated user1's whole year: never go back to one mark for everybody.
//
// Source of the e-mails: Gmail (read only, see gmail.ts) when the user connected it; otherwise the sample e-mails
// in back/data/mail-demo/ (MyInvestor only).

const SOURCE = "mail";

type Kind = "buy" | "sell";
type ParsedOp = {
  broker: string; kind: Kind; date: string; name: string; isin: string | null;
  quantity: number; price: number; fee: number; currency: string; fxToEur: number | null; amount: number;
  /** What identifies the operation whatever e-mail it came from (duplicates check). */
  key: string;
};

// ---------------------------------------------------------------- MyInvestor

const MYINVESTOR_SUBJECT =
  /CONFIRMACI[ÓO]N DE OPERACI[ÓO]N DE VALORES\s*:\s*\S+\s*#\s*(\d{2})\/(\d{2})\/(\d{4})\s*#\s*([A-ZÁÉÍÓÚÑ .]+?)\s*#\s*(.+?)\s*#\s*TIT:\s*([\d.,]+)\s*#\s*PRE:\s*([\d.,]+)\s*#\s*([\d.,]+)\s*([A-Z]{3})/i;

const OPERATION_KIND: Record<string, Kind | undefined> = {
  SUSCRIPCION: "buy", "SUSCRIPCION I.I.C.": "buy", COMPRA: "buy",
  VENTA: "sell", REEMBOLSO: "sell", "REEMBOLSO I.I.C.": "sell",
};

/** "1,424.28" / "7500.00" / ".17" -> number (MyInvestor writes a dot for decimals and a comma for thousands). */
const amount = (s: string) => Number(s.replace(/,/g, ""));

export function parseMyInvestor(mail: Mail): ParsedOp | null {
  const m = MYINVESTOR_SUBJECT.exec(mail.subject);
  if (!m) return null;
  const [, dd, mm, yyyy, op, name, tit, pre, total, currency] = m;
  const kind = OPERATION_KIND[op.trim().toUpperCase()];
  if (!kind) return null;
  let quantity = amount(tit), price = amount(pre);
  const net = amount(total);
  let fee = 0, isin: string | null = null, fxToEur: number | null = currency.toUpperCase() === "EUR" ? 1 : null;

  // Subject only: funds take the price from amount / units (the subject rounds both); stocks keep the price and
  // the difference with the amount is the fee.
  const isFund = /^(SUSCRIPCION|REEMBOLSO)/i.test(op.trim());
  if (isFund) price = net / quantity;
  else fee = Math.max(0, Math.round((kind === "buy" ? net - quantity * price : quantity * price - net) * 100) / 100);

  // The body has the exact figures and the amount in euros.
  const body = (mail.body ?? "").replace(/[ \t\u00a0]+/g, " ");
  if (body) {
    isin = /C[óo]digo ISIN:\s*([A-Z]{2}[A-Z0-9]{9}\d)/i.exec(body)?.[1] ?? null;
    const units = /Participaciones\s+Precio Bruto\s+Importe Bruto\s+([\d.,]+)\s+([\d.,]+)\s+[A-Z]{3}/i.exec(body);
    if (units) { quantity = amount(units[1]); price = amount(units[2]); }
    const costs = /Tasas e Impuestos\s+([\d.,]+)\s+[A-Z]{3}\s+([\d.,]+)\s+[A-Z]{3}\s+([\d.,]+)\s+[A-Z]{3}/i.exec(body);
    if (costs) fee = amount(costs[1]) + amount(costs[2]) + amount(costs[3]);
    const eur = /Importe Efectivo Neto[\s\S]*?([\d.,]+)\s+EUR/i.exec(body);
    if (!fxToEur && eur && net > 0) fxToEur = amount(eur[1]) / net;
  }
  return {
    broker: "MyInvestor", kind, date: `${yyyy}-${mm}-${dd}`, name: name.trim(), isin,
    quantity, price, fee, currency: currency.toUpperCase(), fxToEur, amount: net,
    key: `MyInvestor|${yyyy}-${mm}-${dd}|${op.trim().toUpperCase()}|${name.trim().toUpperCase()}|${amount(tit)}|${net}|${currency.toUpperCase()}`,
  };
}

const PARSERS: Array<{ name: string; matches: (m: Mail) => boolean; parse: (m: Mail) => ParsedOp | null }> = [
  { name: "MyInvestor", matches: (m) => /MYINVESTOR/i.test(m.subject) || /myinvestor/i.test(m.from), parse: parseMyInvestor },
];

// ---------------------------------------------------------------- Instruments

/** Names as the broker writes them -> asset in the app (name, type, Yahoo ticker, currency). */
const INSTRUMENTS: Array<{ match: RegExp; name: string; type: string; symbol: string | null; currency: string }> = [
  { match: /^MYINVESTOR VALUE/, name: "MyInvestor Value", type: "FUND", symbol: "0P0001T8V7.F", currency: "EUR" },
  { match: /^AZVALOR INTERNACIONAL/, name: "Azvalor Internacional", type: "FUND", symbol: "0P00016YQ5.F", currency: "EUR" },
  { match: /^PICTET CHINA INDEX/, name: "Pictet China Index", type: "FUND", symbol: "LU0625737910.LU", currency: "EUR" },
  { match: /^EMERGING MARKETS STOCK/, name: "Vanguard Emerging Markets", type: "FUND", symbol: "0P000060MS.F", currency: "EUR" },
  { match: /^VANGUARD GLOB SMALL CAP/, name: "Vanguard Global Small-Cap", type: "FUND", symbol: "0P0000XR9M.F", currency: "EUR" },
  { match: /^ISHARES US INDEX FUND/, name: "iShares US Index (S&P 500)", type: "FUND", symbol: "0P0001XF42.F", currency: "EUR" },
  { match: /^VANGUARD EUROPEAN STOCK/, name: "Vanguard European Stock", type: "FUND", symbol: "0P00000RQ8.F", currency: "EUR" },
  { match: /^HOROS VALUE INTERNACIONAL/, name: "Horos Value Internacional", type: "FUND", symbol: "0P0001DFE8.F", currency: "EUR" },
  { match: /^ABCELLERA/, name: "Abcellera", type: "STOCK", symbol: "ABCL", currency: "USD" },
  { match: /^WT PHYSICAL SILVER/, name: "Plata (WisdomTree)", type: "ETF", symbol: "PHAG.MI", currency: "EUR" },
  { match: /^WT COPPER/, name: "Cobre (WisdomTree)", type: "ETF", symbol: "COPA.MI", currency: "EUR" },
  { match: /^NOBLE CORP/, name: "Noble Corporation", type: "STOCK", symbol: "NE", currency: "USD" },
  { match: /^UNITEDHEALTH/, name: "UnitedHealth", type: "STOCK", symbol: "UNH", currency: "USD" },
  { match: /^PINDUODUO|^PDD HOLDINGS/, name: "PDD", type: "STOCK", symbol: "PDD", currency: "USD" },
  { match: /^AMPER$/, name: "Amper", type: "STOCK", symbol: "AMP.MC", currency: "EUR" },
  { match: /^JD\.COM/, name: "JD", type: "STOCK", symbol: "JD", currency: "USD" },
  { match: /^OHL\b/, name: "OHLA", type: "STOCK", symbol: "OHLA.MC", currency: "EUR" },
];

/**
 * Splits and reverse splits after `day` (Yahoo), as one factor: units × factor, price ÷ factor. The confirmation
 * e-mail has the units of that day, but Yahoo's price history (the one the app uses) is adjusted to today's units,
 * e.g. Amper 1:25 on 2026-07-20: 3,800 at 0.18 € bought in January are 152 at 4.50 € today.
 */
const splitCache = new Map<string, Array<{ day: string; factor: number }>>();
async function splitFactor(symbol: string | null, day: string): Promise<{ factor: number; events: string[] }> {
  if (!symbol) return { factor: 1, events: [] };
  let splits = splitCache.get(symbol);
  if (!splits) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=split`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) }
      );
      const body: any = await res.json();
      const events = Object.values(body?.chart?.result?.[0]?.events?.splits ?? {}) as Array<{ date: number; numerator: number; denominator: number }>;
      splits = events.map((e) => ({ day: new Date(e.date * 1000).toISOString().slice(0, 10), factor: e.numerator / e.denominator }));
    } catch {
      splits = [];
    }
    splitCache.set(symbol, splits);
  }
  const after = splits.filter((s) => s.day > day);
  return {
    factor: after.reduce((f, s) => f * s.factor, 1),
    events: after.map((s) => `${s.factor < 1 ? "contrasplit" : "split"} ${s.factor < 1 ? `1:${Math.round(1 / s.factor)}` : `${s.factor}:1`} el ${s.day}`),
  };
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

// ---------------------------------------------------------------- Sources

function demoMails(): Mail[] {
  const dir = path.join(__dirname, "..", "data", "mail-demo");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Mail[]);
}

// ---------------------------------------------------------------- Templates (one per bank)

/**
 * A template reads the e-mails of one bank. The user picks banks of their own (any of them); a bank whose name
 * matches a template is read with it, the others have no template yet (nothing to read).
 */
type Template = { id: "myinvestor" | "bbva" | "user"; label: string; match: RegExp; what: string; query: (since: string) => string; user?: MailTemplate };
const TEMPLATES: Template[] = [
  {
    id: "myinvestor", label: "MyInvestor", match: /my\s*investor/i, what: "confirmaciones de operaciones de valores y fondos",
    query: (since) => `from:myinvestor "OPERACIÓN DE VALORES" after:${since}`,
  },
  {
    id: "bbva", label: "BBVA", match: /\bbbva\b/i, what: "órdenes de compra y venta (PDF adjunto)",
    query: (since) => `from:bbva "Orden de compra venta de valores" has:attachment after:${since}`,
  },
];
const builtinOf = (bankName: string) => TEMPLATES.find((t) => t.match.test(bankName)) ?? null;

/** Template of a bank: the ones in the code first, then the ones made by users (mail-templates.ts). */
async function templateOf(bankName: string): Promise<Template | null> {
  const builtin = builtinOf(bankName);
  if (builtin) return builtin;
  const user = await userTemplateFor(bankName);
  if (!user) return null;
  return { id: "user", label: user.label, match: /.^/, what: user.what, query: (since) => `${user.query} after:${since}`, user };
}

// ---------------------------------------------------------------- Matching with what the user already has

/** "Already imported" mark of an e-mail operation: per user, so two users can import the same e-mail. */
const markKey = (userId: string, key: string) => `${userId}|${key}`;

/** The user's asset for an operation inside the chosen bank: by Yahoo ticker, else by name (case-insensitive). */
async function findAsset(bankId: string, symbol: string | null, name: string): Promise<{ id: string; name: string } | null> {
  const rows: Array<{ id: string; name: string }> = await prisma.$queryRawUnsafe(
    `select id, name from assets
      where "bankId" = $1 and (($2::text is not null and "marketSymbol" = $2) or lower(name) = lower($3))
      order by ("marketSymbol" = $2) desc nulls last limit 1`,
    bankId, symbol, name
  );
  return rows[0] ?? null;
}

/**
 * An operation of the user that is this one: same asset and side, same units (±1 %), dated from 10 days before
 * the e-mail (the confirmation arrives 2-5 days after the order, and people note the order day) to 3 days after.
 * If none, a "maybe": same units (±0.5 %) within 60 days (dates noted roughly by hand). Operations already linked to
 * another e-mail don't count.
 */
async function findSameOperation(assetId: string, kind: Kind, from: string, to: string, quantity: number):
    Promise<{ id: string; day: string; sure: boolean } | null> {
  const rows: Array<{ id: string; day: string; gap: number }> = await prisma.$queryRawUnsafe(
    `select o.id, to_char(o."occurredAt", 'YYYY-MM-DD') as day,
            (case when o."occurredAt"::date < $3::date then $3::date - o."occurredAt"::date
                  when o."occurredAt"::date > $4::date then o."occurredAt"::date - $4::date else 0 end)::int as gap,
            o."occurredAt"::date between $3::date - 10 and $4::date + 3
              and abs(o.quantity - $5) <= greatest(abs($5) * 0.01, 0.000001) as sure
       from asset_operations o
      where o."assetId" = $1 and o."operationType"::text = $2
        and o."occurredAt"::date between $3::date - 60 and $4::date + 60
        and abs(o.quantity - $5) <= greatest(abs($5) * 0.01, 0.000001)
        and not exists (select 1 from external_operations e where e."operationId" = o.id and e.source = 'mail')
      order by sure desc, gap limit 1`,
    assetId, kind === "buy" ? "BUY" : "SELL", from, to, quantity
  );
  const r: any = rows[0];
  if (!r) return null;
  if (!r.sure && Math.abs(r.gap) > 0 && Math.abs(quantity) > 0) {
    // Loose match only with nearly the same units.
    const q: Array<{ ok: boolean }> = await prisma.$queryRawUnsafe(
      `select abs(quantity - $2) <= greatest(abs($2) * 0.005, 0.000001) as ok from asset_operations where id = $1`, r.id, quantity
    );
    if (!q[0]?.ok) return null;
  }
  return { id: r.id, day: r.day, sure: !!r.sure };
}

// ---------------------------------------------------------------- Jobs: scan (read only) and apply

type Status = "new" | "exists" | "maybe" | "imported" | "cancelled";
/** One operation or order found in the e-mails, before anything is written. */
type Candidate = {
  key: string; template: string; bankId: string; bankName: string; type: "operation" | "order";
  kind: Kind; date: string; name: string; quantity: number; price: number | null; currency: string; amount: number | null;
  status: Status; note: string; assetId: string | null; assetName: string; existingOpId: string | null;
  /** Ticked by default in the review (new rows, except old orders). */
  suggest?: boolean;
  op?: ParsedOp; order?: BbvaOrder; mailKey?: string;
};
type Event = { n: number; level: "info" | "ok" | "skip" | "warn" | "error"; text: string };
type Job = {
  id: string; userId: string; userName: string; source: "demo" | "gmail";
  phase: "scanning" | "review" | "applying" | "done" | "error";
  since: string; bankIds: string[]; total: number; processed: number;
  created: number; linked: number; skipped: number; failed: number;
  candidates: Candidate[]; events: Event[];
};
const jobs = new Map<string, Job>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(job: Job, level: Event["level"], text: string) {
  job.events.push({ n: job.events.length, level, text });
}

const KIND_TEXT: Record<Kind, string> = { buy: "Compra", sell: "Venta" };
const fmt = (n: number, d = 2) => n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d });
const units = (n: number) => fmt(n, 4).replace(/,?0+$/, "");
const gmailDate = (day: string) => day.replace(/-/g, "/");
const dmy = (d: string) => d.split("-").reverse().join("/");


/** Reads the e-mails of the chosen banks and works out what is new. Writes nothing. */
async function scan(job: Job, banks: Array<{ id: string; name: string }>): Promise<void> {
  try {
    log(job, "info", `Importando en ${job.userName}: solo se mirarán y cambiarán sus datos.`);
    await sleep(300);
    const picked: Array<{ bank: { id: string; name: string }; template: Template | null }> = [];
    for (const bank of banks) {
      log(job, "info", `Buscando la plantilla de ${bank.name}…`);
      await sleep(250);
      const template = await templateOf(bank.name);
      picked.push({ bank, template });
      if (!template) log(job, "skip", `${bank.name} todavía no tiene plantilla: puedes crearla en el paso anterior («✦ Crear plantilla»).`);
      else log(job, "ok", `Plantilla de ${bank.name}${template.user ? " (creada por un usuario)" : ""}: ${template.what}.`);
    }
    await sleep(250);
    log(job, "info", job.source === "gmail" ? "Conectando con Gmail (solo lectura)…" : "Gmail no está conectado: se usan los correos de ejemplo.");
    await sleep(350);

    // E-mails of each bank with a template, from the chosen day.
    const work: Array<{ bank: { id: string; name: string }; template: Template; mails: Mail[] }> = [];
    for (const { bank, template } of picked) {
      if (!template) continue;
      // Two banks with the same template: read once.
      if (work.some((w) => w.template.id === template.id && w.template.user?.id === template.user?.id)) continue;
      log(job, "info", `Buscando correos de ${bank.name} desde el ${job.since.split("-").reverse().join("/")}…`);
      let mails: Mail[] = [];
      if (job.source === "gmail") {
        let shown = 0;
        mails = await searchMails(template.query(gmailDate(job.since)), (n) => {
          if (n - shown >= 10) { shown = n; log(job, "info", `Descargados ${n} correos…`); }
        });
      } else if (template.id === "myinvestor") {
        mails = demoMails().filter((m) => m.date.slice(0, 10) >= job.since);
      }
      mails.sort((a, b) => a.date.localeCompare(b.date));
      log(job, "ok", `${bank.name}: ${mails.length} correos encontrados.`);
      work.push({ bank, template, mails });
    }
    job.total = work.reduce((s, w) => s + w.mails.length, 0);

    for (const { bank, template, mails } of work) {
      for (const mail of mails) {
        job.processed++;
        log(job, "info", `Leyendo correo ${job.processed}/${job.total} · ${bank.name} · ${mail.date.slice(0, 10)}`);
        await sleep(60);
        try {
          let c: Candidate | null;
          if (template.id === "bbva") c = await orderCandidate(job, bank, mail);
          else {
            const op = template.user ? readWithTemplate(template.label, template.user.fields, mail).op : parseMyInvestor(mail);
            if (!op) log(job, "skip", "No es una operación de compra o venta: se ignora.");
            c = op ? await operationCandidate(job, bank, op, template.user ? `user:${template.user.id}` : "myinvestor") : null;
          }
          if (!c) { job.skipped++; continue; }
          job.candidates.push(c);
          const label = { new: "nueva", exists: "ya la tienes", maybe: "¿ya la tienes?", imported: "ya importada", cancelled: "anulada" }[c.status];
          log(job, c.status === "new" ? "ok" : "skip", `${KIND_TEXT[c.kind]} de ${units(c.quantity)} × ${c.name}: ${label}.`);
        } catch (e: any) {
          job.failed++;
          log(job, "error", `No se pudo leer: ${String(e?.message ?? e).slice(0, 160)}`);
        }
      }
    }
    for (const { template } of work) if (template.user) await markUsed(template.user.id);
    await matchSplitOperations(job);
    const count = (s: Status) => job.candidates.filter((c) => c.status === s).length;
    log(job, "ok", `Listo para revisar: ${count("new")} nuevas, ${count("exists")} que ya tienes, ${count("maybe")} dudosas, ${count("imported")} ya importadas.`);
    job.phase = "review";
  } catch (e: any) {
    log(job, "error", String(e?.message ?? e));
    job.phase = "error";
  }
}

/** New operations of the same asset, side and day that together are one operation of the user (summed units). */
async function matchSplitOperations(job: Job): Promise<void> {
  const groups = new Map<string, Candidate[]>();
  for (const c of job.candidates) {
    if (c.type !== "operation" || c.status !== "new" || !c.assetId) continue;
    const k = `${c.assetId}|${c.kind}|${c.date}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const total = list.reduce((s, c) => s + c.quantity, 0);
    const same = await findSameOperation(list[0].assetId!, list[0].kind, list[0].date, list[0].date, total);
    if (!same?.sure) continue;
    for (const c of list) {
      c.status = "exists";
      c.existingOpId = same.id;
      c.note = `Junto con ${list.length - 1 === 1 ? "otro correo" : `otros ${list.length - 1} correos`} del mismo día es tu ${c.kind === "buy" ? "compra" : "venta"} del ${dmy(same.day)} (${units(total)} títulos)`;
    }
    log(job, "skip", `${list[0].name}: ${list.length} correos del ${dmy(list[0].date)} forman tu operación del ${dmy(same.day)}.`);
  }
}

async function operationCandidate(job: Job, bank: { id: string; name: string }, op: ParsedOp, template: string): Promise<Candidate | null> {
  const known = INSTRUMENTS.find((i) => i.match.test(op.name.toUpperCase()));
  let symbol = known?.symbol ?? null;
  if (!symbol && op.isin) symbol = (await tickerForIsin(op.isin, "").catch(() => null))?.symbol ?? null;
  const split = await splitFactor(symbol, op.date);
  if (split.factor !== 1) {
    op.quantity *= split.factor;
    op.price /= split.factor;
    log(job, "warn", `Ajustado por ${split.events.join(", ")}.`);
  }
  const name = known?.name ?? titleCase(op.name);
  const base: Omit<Candidate, "status" | "note" | "assetId" | "assetName" | "existingOpId"> = {
    key: op.key, template, bankId: bank.id, bankName: bank.name, type: "operation", kind: op.kind, date: op.date,
    name, quantity: op.quantity, price: op.price, currency: op.currency, amount: op.amount, op,
  };
  const marked: unknown[] = await prisma.$queryRawUnsafe(
    `select 1 from external_operations where source = $1 and "externalId" = $2`, SOURCE, markKey(job.userId, op.key)
  );
  const asset = await findAsset(bank.id, symbol, name);
  if (marked.length) return { ...base, status: "imported", note: "Ya importada de este correo", assetId: asset?.id ?? null, assetName: asset?.name ?? name, existingOpId: null };
  const same = asset ? await findSameOperation(asset.id, op.kind, op.date, op.date, op.quantity) : null;
  if (same?.sure) return { ...base, status: "exists", note: `Es tu ${op.kind === "buy" ? "compra" : "venta"} del ${dmy(same.day)}: se enlazará al correo`, assetId: asset!.id, assetName: asset!.name, existingOpId: same.id };
  if (same) return { ...base, status: "maybe", note: `¿Es tu ${op.kind === "buy" ? "compra" : "venta"} del ${dmy(same.day)}? Mismos títulos. Sin marcar se enlaza; marcada se crea aparte`, assetId: asset!.id, assetName: asset!.name, existingOpId: same.id };
  if (asset) {
    // A position noted whole, without operations, already has these units: adding the buy would count them twice.
    const [info] = await prisma.$queryRawUnsafe<Array<{ ops: number; qty: number; opening: string | null; openingQty: number | null }>>(
      `select (select count(*) from asset_operations where "assetId" = a.id)::int as ops, a.quantity::float as qty,
              (select to_char(min("occurredAt"), 'YYYY-MM-DD') from asset_operations where "assetId" = a.id and kind = 'opening') as opening,
              (select sum(quantity)::float from asset_operations where "assetId" = a.id and kind = 'opening') as "openingQty"
         from assets a where a.id = $1`, asset.id
    );
    if (info && info.ops === 0) {
      return { ...base, status: "exists", note: `Tu posición de ${units(info.qty)} títulos se apuntó entera, sin operaciones: ya la incluye`, assetId: asset.id, assetName: asset.name, existingOpId: null };
    }
    if (info?.opening && info.opening <= op.date) {
      return { ...base, status: "maybe", note: `Tienes un saldo inicial de ${units(info.openingQty ?? 0)} títulos el ${dmy(info.opening)}: puede que ya la incluya`, assetId: asset.id, assetName: asset.name, existingOpId: null };
    }
  }
  return {
    ...base, status: "new", assetId: asset?.id ?? null, assetName: asset?.name ?? name, existingOpId: null, suggest: true,
    note: asset ? `Se añadirá a ${asset.name}` : `Activo nuevo en ${bank.name}${symbol ? ` (${symbol})` : " (sin ticker)"}`,
  };
}

async function orderCandidate(job: Job, bank: { id: string; name: string }, mail: Mail): Promise<Candidate | null> {
  const pdf = (mail.attachments ?? []).find((a) => /\.pdf$/i.test(a.filename) && /ORDEN/i.test(a.filename));
  if (!pdf) {
    log(job, "skip", "Sin PDF de orden: se ignora.");
    return null;
  }
  const order = parseBbvaOrder(await pdfText(await attachment(mail.id, pdf.id)));
  if (!order) {
    log(job, "warn", "El PDF no tiene el formato de orden esperado: se ignora.");
    return null;
  }
  const mailKey = `BBVA|${order.orderNo ?? mail.id}`;
  const day = (order.validFrom ?? order.orderedAt ?? mail.date).slice(0, 10);
  const base: Omit<Candidate, "status" | "note" | "assetId" | "assetName" | "existingOpId"> = {
    key: mailKey, template: "bbva", bankId: bank.id, bankName: bank.name, type: "order", kind: order.kind, date: day,
    name: order.name, quantity: order.quantity, price: order.limitPrice, currency: order.currency, amount: null, order, mailKey,
  };
  const seen: unknown[] = await prisma.$queryRawUnsafe(`select 1 from pending_orders where "mailKey" = $1`, mailKey);
  if (seen.length) return { ...base, status: "imported", note: "Orden ya leída", assetId: null, assetName: order.name, existingOpId: null };
  if (order.cancelled) return { ...base, status: "cancelled", note: "Anulación de una orden", assetId: null, assetName: order.name, existingOpId: null };
  // Already registered by hand? Same security, side and units within the order's validity.
  const ticker = await tickerForIsin(order.isin, order.market).catch(() => null);
  const asset = await findAsset(bank.id, ticker?.symbol ?? null, ticker?.name ?? order.name);
  const until = order.validTo ?? day;
  const same = asset ? await findSameOperation(asset.id, order.kind, day, until, order.quantity) : null;
  if (same?.sure) return { ...base, status: "exists", note: `Ya la tienes: ${order.kind === "buy" ? "compra" : "venta"} del ${dmy(same.day)}`, assetId: asset!.id, assetName: asset!.name, existingOpId: same.id };
  if (same) return { ...base, status: "maybe", note: `¿Es tu ${order.kind === "buy" ? "compra" : "venta"} del ${dmy(same.day)}? Mismos títulos`, assetId: asset!.id, assetName: asset!.name, existingOpId: same.id };
  // Old orders without a match were most likely not executed or noted in another way: not ticked by default.
  const old = (order.validTo ?? day) < new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return {
    ...base, status: "new", assetId: asset?.id ?? null, assetName: asset?.name ?? order.name, existingOpId: null, suggest: !old,
    note: old ? "Orden antigua sin operación tuya que coincida: márcala solo si se ejecutó" : "Quedará como orden por confirmar (BBVA no envía la ejecución)",
  };
}

/** The asset for a new operation inside the chosen bank, created the first time. */
async function assetInBank(c: Candidate): Promise<{ id: string; created: boolean }> {
  if (c.assetId) return { id: c.assetId, created: false };
  const op = c.op!;
  const known = INSTRUMENTS.find((i) => i.match.test(op.name.toUpperCase()));
  let symbol = known?.symbol ?? null;
  let typeCode = known?.type ?? (/FI$|FUND|INDEX/i.test(op.name) ? "FUND" : "STOCK");
  if (!known && op.isin) {
    const t = await tickerForIsin(op.isin, "").catch(() => null);
    if (t) {
      symbol = t.symbol;
      typeCode = ({ EQUITY: "STOCK", ETF: "ETF", MUTUALFUND: "FUND" } as Record<string, string>)[t.quoteType] ?? typeCode;
    }
  }
  const again = await findAsset(c.bankId, symbol, c.name); // created by an earlier row of this same import
  if (again) return { id: again.id, created: false };
  const type = await prisma.assetTypeEntity.findUnique({ where: { code: typeCode } });
  if (!type) throw new Error(`Tipo ${typeCode} no existe`);
  const asset = await prisma.asset.create({
    data: {
      bankId: c.bankId, name: c.name, currency: (known?.currency ?? op.currency) as any, assetTypeId: type.id,
      marketSymbol: symbol, marketProvider: symbol ? "yahoo" : null,
      marketPriceLocal: op.price, marketPriceEur: op.price * (op.fxToEur ?? 1),
      regions: (await guessRegions(symbol, typeCode)) ?? undefined,
    },
  });
  return { id: asset.id, created: true };
}

/** Writes the picked rows: new operations, new pending orders, and links the ones the user already had. */
async function apply(job: Job, keys: Set<string>): Promise<void> {
  try {
    // Ticked "maybe" rows are created as new; unticked ones are taken as the user's own and linked.
    for (const c of job.candidates) if (c.status === "maybe") c.status = keys.has(c.key) ? "new" : "exists";
    const rows = job.candidates.filter((c) => (c.status === "new" && keys.has(c.key)) || c.status === "exists");
    job.total = rows.length;
    job.processed = 0;
    log(job, "info", `Aplicando en ${job.userName}: ${rows.filter((r) => r.status === "new").length} nuevas y ${rows.filter((r) => r.status === "exists").length} enlaces.`);
    const touched = new Set<string>();
    let firstDay: string | null = null;
    for (const c of rows) {
      job.processed++;
      try {
        if (c.status === "exists") {
          if (c.type === "operation" && c.existingOpId) {
            await prisma.$executeRawUnsafe(
              `insert into external_operations (source, "externalId", "operationId", "assetId") values ($1, $2, $3, $4) on conflict do nothing`,
              SOURCE, markKey(job.userId, c.key), c.existingOpId, c.assetId
            );
          }
          job.linked++;
          log(job, "skip", `${c.name} (${dmy(c.date)}): ya la tenías${c.type === "operation" ? ", enlazada al correo" : ""}.`);
          continue;
        }
        if (c.type === "order") {
          const saved = await savePendingOrder(c.order!, c.mailKey!);
          job.created++;
          log(job, "ok", `Orden de ${c.kind === "buy" ? "compra" : "venta"} de ${units(c.quantity)} ${c.name}: ${saved === "modified" ? "modificada" : "pendiente de confirmar"}.`);
          continue;
        }
        const asset = await assetInBank(c);
        if (asset.created) log(job, "info", `Activo nuevo: ${c.name} en ${c.bankName}.`);
        const op = c.op!;
        const result = await createMovement({
          kind: op.kind, assetId: asset.id, date: op.date, quantity: op.quantity, price: op.price, fee: op.fee,
          ...(op.fxToEur ? { fxToEur: op.fxToEur } : {}),
          // Sale proceeds wait in "Pendiente de reinvertir", as when selling by hand.
          useCash: op.kind === "sell",
          note: `Importado del correo de ${c.bankName}`,
        });
        const ops: Array<{ id: string }> = await prisma.$queryRawUnsafe(
          `select id from asset_operations where "groupId" = $1 and "assetId" = $2`, result.groupId, asset.id
        );
        await prisma.$executeRawUnsafe(
          `insert into external_operations (source, "externalId", "operationId", "assetId") values ($1, $2, $3, $4)`,
          SOURCE, markKey(job.userId, c.key), ops[0]?.id ?? null, asset.id
        );
        result.assetIds.forEach((id) => touched.add(id));
        if (!firstDay || op.date < firstDay) firstDay = op.date;
        job.created++;
        log(job, "ok", `${KIND_TEXT[op.kind]} de ${units(op.quantity)} × ${c.name} registrada.`);
      } catch (e: any) {
        job.failed++;
        log(job, "error", `${c.name}: ${String(e?.message ?? e).slice(0, 160)}`);
      }
    }
    if (touched.size && firstDay) {
      log(job, "info", "Recalculando posiciones y precios…");
      await refreshSnapshots([...touched], firstDay);
    }
    // Next import starts from the newest e-mail seen.
    const lastMail = job.candidates.reduce<string | null>((m, c) => (!m || c.date > m ? c.date : m), null);
    await prisma.$executeRawUnsafe(
      `insert into mail_import_state ("lastImportAt", "lastMailDate", banks) values (now(), $1::date, $2::text[])
       on conflict ("userId") do update set "lastImportAt" = now(), "lastMailDate" = coalesce(excluded."lastMailDate", mail_import_state."lastMailDate"), banks = excluded.banks`,
      lastMail, job.bankIds
    );
    log(job, "ok", `Hecho: ${job.created} nuevas, ${job.linked} enlazadas, ${job.failed} con error.`);
    job.phase = "done";
  } catch (e: any) {
    log(job, "error", String(e?.message ?? e));
    job.phase = "error";
  }
}

// ---------------------------------------------------------------- Routes

export function registerMailImportRoutes(app: Express): void {
  /** What the dialog needs: the user, their banks (with or without template) and the last import. */
  app.get("/api/v2/mail-import/setup", handler(async (_req, res) => {
    const userId = currentUser() ?? DEFAULT_USER;
    const [user] = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`select name from users where id = $1`, userId);
    // "Reinversión" is the app's own account for money from sales, not a bank with e-mails.
    const banks = (await prisma.bank.findMany({ orderBy: { name: "asc" } })).filter((b) => b.name !== "Reinversión");
    const [state] = await prisma.$queryRawUnsafe<Array<{ lastImportAt: Date | null; lastMailDate: string | null; banks: string[] }>>(
      `select "lastImportAt", to_char("lastMailDate", 'YYYY-MM-DD') as "lastMailDate", banks from mail_import_state`
    );
    res.json({
      user: { id: userId, name: user?.name ?? userId },
      banks: await Promise.all(banks.map(async (b) => {
        const t = await templateOf(b.name);
        return { id: b.id, name: b.name, template: t?.label ?? null, custom: !!t?.user };
      })),
      last: state ? { at: state.lastImportAt, mailDate: state.lastMailDate, banks: state.banks } : null,
      // From the last e-mail imported (it may have had more operations that day), else from 1 January.
      since: state?.lastMailDate ?? `${new Date().getFullYear()}-01-01`,
      gmail: gmailConnected(userId),
    });
  }));

  /** Step 1: reads the e-mails of the chosen banks (nothing is written). */
  app.post("/api/v2/mail-import/scan", handler(async (req, res) => {
    const userId = currentUser() ?? DEFAULT_USER;
    const busy = [...jobs.values()].find((j) => j.userId === userId && (j.phase === "scanning" || j.phase === "applying"));
    if (busy) return void res.json({ jobId: busy.id });
    const ids = Array.isArray(req.body?.banks) ? req.body.banks.map(String) : [];
    if (!ids.length) throw new HttpError(400, "Elige al menos un banco.");
    const since = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.since)) ? String(req.body.since) : `${new Date().getFullYear()}-01-01`;
    const banks = await prisma.bank.findMany({ where: { id: { in: ids } }, orderBy: { name: "asc" } });
    if (!banks.length) throw new HttpError(400, "Bancos no válidos.");
    const [user] = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`select name from users where id = $1`, userId);
    const job: Job = {
      id: randomUUID(), userId, userName: user?.name ?? userId, source: gmailConnected(userId) ? "gmail" : "demo",
      phase: "scanning", since, bankIds: banks.map((b) => b.id), total: 0, processed: 0, created: 0, linked: 0, skipped: 0, failed: 0,
      candidates: [], events: [],
    };
    jobs.set(job.id, job);
    void withUser(userId, () => scan(job, banks.map((b) => ({ id: b.id, name: b.name }))));
    res.status(202).json({ jobId: job.id });
  }));

  /** Step 2: writes the rows the user ticked (keys) and links the ones already registered. */
  app.post("/api/v2/mail-import/:id/apply", handler(async (req, res) => {
    const userId = currentUser() ?? DEFAULT_USER;
    const job = jobs.get(String(req.params.id));
    if (!job || job.userId !== userId) throw new HttpError(404, "Importación no encontrada.");
    if (job.phase !== "review") throw new HttpError(400, "Esta importación ya no se puede aplicar.");
    job.phase = "applying";
    const keys = new Set<string>(Array.isArray(req.body?.keys) ? req.body.keys.map(String) : []);
    void withUser(userId, () => apply(job, keys));
    res.json({ ok: true });
  }));

  /** Progress: counters, the rows found (once reviewing) and the events after `after`. */
  app.get("/api/v2/mail-import/:id", handler(async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.userId !== (currentUser() ?? DEFAULT_USER)) throw new HttpError(404, "Importación no encontrada.");
    const after = Number(req.query.after ?? -1);
    const { events, candidates, ...rest } = job;
    res.json({
      ...rest,
      events: events.filter((e) => e.n > after),
      candidates: job.phase === "scanning" ? [] : candidates.map(({ op, order, ...c }) => c),
    });
  }));
}
