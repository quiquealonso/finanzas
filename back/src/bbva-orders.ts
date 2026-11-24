import { Express } from "express";
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "./prisma";
import { createMovement, guessRegions, handler, HttpError, madridToday, refreshSnapshots } from "./portfolio";

// BBVA orders. BBVA's e-mail ("Revisa la documentación de Orden de compra venta de valores") only carries the
// order document (PDF): what was asked (security, units, limit, validity), not whether nor at what price it was
// executed. So every order becomes a *pending order* (table pending_orders) that the user confirms: "Se ejecutó"
// (date, price, units, fee -> a normal buy/sell) or "No se ejecutó". A modification of an order replaces the
// previous pending one of the same security.

// ---------------------------------------------------------------- PDF text

const PDFTOTEXT_PATHS = [
  process.env.PDFTOTEXT,
  "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe",
  "/usr/bin/pdftotext",
  "/opt/homebrew/bin/pdftotext",
  "pdftotext",
].filter(Boolean) as string[];

/** Text of a PDF keeping its columns (pdftotext -layout, from Poppler; Git for Windows includes it). */
export async function pdfText(pdf: Buffer): Promise<string> {
  const file = path.join(os.tmpdir(), `finanzas-${randomUUID()}.pdf`);
  fs.writeFileSync(file, pdf);
  try {
    for (const bin of PDFTOTEXT_PATHS) {
      if (bin.includes(path.sep) && !fs.existsSync(bin)) continue;
      try {
        return await new Promise<string>((resolve, reject) =>
          execFile(bin, ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 10 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)))
        );
      } catch { /* next candidate */ }
    }
    throw new Error("No se encuentra pdftotext (Poppler). Instala Git para Windows o indica su ruta en PDFTOTEXT.");
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ---------------------------------------------------------------- Parser

export type BbvaOrder = {
  kind: "buy" | "sell"; modified: boolean; cancelled: boolean;
  isin: string; name: string; market: string; currency: string; quantity: number;
  validFrom: string | null; validTo: string | null; modality: string | null; limitPrice: number | null;
  orderNo: string | null; orderedAt: string | null;
};

/** "1.250,5" -> 1250.5 (Spanish format). */
const num = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const isoDay = (d: string) => d.split("/").reverse().join("-");

/** Name of the security without the text of other columns that pdftotext puts on the same line. */
const cleanName = (s: string) => s.split(/\s{2,}|\s+Seg[úu]n aplicaci/i)[0].trim();

export function parseBbvaOrder(text: string): BbvaOrder | null {
  const t = text.replace(/\u00a0/g, " ");
  const title = /(MODIFICACI[ÓO]N DE |ANULACI[ÓO]N DE )?ORDEN DE (COMPRA|VENTA) DE VALORES/i.exec(t);
  const sec = /\b([A-Z]{2}[A-Z0-9]{9}\d)\s+(?:\([A-Z]\)\s+)?(.+?)\s{2,}(\S+(?: \S+)?)\s{2,}([A-Z]{3})\s+([\d.]+(?:,\d+)?)\s*$/m.exec(t);
  if (!title || !sec) return null;
  const valid = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ ]*?)(?:\s+([\d.]+,\d+|\d+))?\s*$/m.exec(t);
  const order = /(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+(\d{10,})/.exec(t);
  const action = (title[1] ?? "").toUpperCase();
  return {
    kind: /VENTA/i.test(title[2]) ? "sell" : "buy",
    modified: action.startsWith("MODIFICAC"),
    cancelled: action.startsWith("ANULAC"),
    // BBVA's legal note ("Según aplicación de la Política de ejecución…") shares the line with the name: cut it.
    isin: sec[1], name: cleanName(sec[2]), market: sec[3].trim(), currency: sec[4], quantity: num(sec[5]),
    validFrom: valid ? isoDay(valid[1]) : null,
    validTo: valid ? isoDay(valid[2]) : null,
    modality: valid ? valid[3].trim() : null,
    limitPrice: valid?.[4] ? num(valid[4]) : null,
    orderNo: order?.[3] ?? null,
    orderedAt: order ? `${isoDay(order[1])}T${order[2]}` : null,
  };
}

// ---------------------------------------------------------------- ISIN -> Yahoo ticker

const tickerCache = new Map<string, { symbol: string; name: string; quoteType: string } | null>();

/** Yahoo ticker of an ISIN, preferring the listing on the order's market (NASDAQ, NYSE, Madrid...). */
export async function tickerForIsin(isin: string, market = ""): Promise<{ symbol: string; name: string; quoteType: string } | null> {
  const cached = tickerCache.get(isin);
  if (cached !== undefined) return cached;
  let found: { symbol: string; name: string; quoteType: string } | null = null;
  try {
    const res = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(isin)}&quotesCount=10&newsCount=0`, {
      headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000),
    });
    const quotes: any[] = ((await res.json()) as any)?.quotes ?? [];
    const m = market.toUpperCase();
    const prefer = (q: any) =>
      m.includes("NASDAQ") ? ["NMS", "NGM", "NCM"].includes(q.exchange)
      : m.includes("NYSE") ? q.exchange === "NYQ"
      : /MADRID|CONTINUO|BME|MC/.test(m) ? String(q.symbol).endsWith(".MC")
      : !String(q.symbol).includes(".");
    const q = quotes.find(prefer) ?? quotes[0];
    // Yahoo's short names carry padding and share-class tails ("Baidu Inc.      R", "... PLC ORD GBP0.").
    const name = String(q?.longname ?? q?.shortname ?? q?.symbol ?? "").split(/\s{2,}/)[0].replace(/\s+ORD\b.*$/i, "").trim();
    if (q?.symbol) found = { symbol: q.symbol, name: name || q.symbol, quoteType: q.quoteType ?? "EQUITY" };
  } catch { /* unknown: the asset is created without ticker */ }
  tickerCache.set(isin, found);
  return found;
}

const TYPE_OF: Record<string, string> = { EQUITY: "STOCK", ETF: "ETF", MUTUALFUND: "FUND", CRYPTOCURRENCY: "CRYPTO" };

/** Asset of a security in a bank: found by its ticker, or created with name, type and ticker from the ISIN. */
export async function assetForIsin(bankName: string, isin: string, fallbackName: string, currency: string, market = "", price = 0) {
  const bank = (await prisma.bank.findFirst({ where: { name: bankName } })) ?? (await prisma.bank.create({ data: { name: bankName } }));
  const t = await tickerForIsin(isin, market);
  if (t) {
    const existing = await prisma.asset.findFirst({ where: { bankId: bank.id, marketSymbol: t.symbol } });
    if (existing) return { id: existing.id, created: false, symbol: t.symbol };
  }
  const name = t?.name ?? fallbackName;
  const same = await prisma.asset.findFirst({ where: { bankId: bank.id, name } });
  if (same) return { id: same.id, created: false, symbol: same.marketSymbol };
  const typeCode = TYPE_OF[t?.quoteType ?? "EQUITY"] ?? "STOCK";
  const type = await prisma.assetTypeEntity.findUnique({ where: { code: typeCode } });
  const asset = await prisma.asset.create({
    data: {
      bankId: bank.id, name, currency: currency as any, assetTypeId: type!.id,
      marketSymbol: t?.symbol ?? null, marketProvider: t ? "yahoo" : null,
      marketPriceLocal: price, marketPriceEur: price,
      // Same geographic guess as an asset created by hand (another asset with the ticker, or the exchange).
      regions: (await guessRegions(t?.symbol ?? null, typeCode)) ?? undefined,
    },
  });
  return { id: asset.id, created: true, symbol: t?.symbol ?? null };
}

// ---------------------------------------------------------------- Pending orders

/** Saves an order read from e-mail. Returns what happened, for the import log. */
export async function savePendingOrder(order: BbvaOrder, mailKey: string): Promise<"new" | "modified" | "cancelled" | "duplicate"> {
  const seen: unknown[] = await prisma.$queryRawUnsafe(`select 1 from pending_orders where "mailKey" = $1`, mailKey);
  if (seen.length) return "duplicate";
  // A modification or cancellation replaces the previous pending order of the same security and side.
  if (order.modified || order.cancelled) {
    await prisma.$executeRawUnsafe(
      `update pending_orders set status = 'cancelled' where broker = 'BBVA' and status = 'pending' and isin = $1 and kind = $2`,
      order.isin, order.kind
    );
  }
  await prisma.$executeRawUnsafe(
    `insert into pending_orders (broker, "mailKey", "orderNo", kind, isin, name, market, currency, quantity, "limitPrice",
                                 modality, "validFrom", "validTo", "orderedAt", modified, status)
     values ('BBVA', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date, $12::date, $13::timestamptz, $14, $15)`,
    mailKey, order.orderNo, order.kind, order.isin, order.name, order.market, order.currency, order.quantity,
    order.limitPrice, order.modality, order.validFrom, order.validTo, order.orderedAt, order.modified,
    order.cancelled ? "cancelled" : "pending"
  );
  return order.cancelled ? "cancelled" : order.modified ? "modified" : "new";
}

// ---------------------------------------------------------------- Was it executed? (estimate)

type Bar = { day: string; open: number; high: number; low: number; close: number };
const barCache = new Map<string, Bar[]>();

/** Daily open/high/low/close of a Yahoo ticker between two days. */
async function dailyBars(symbol: string, from: string, to: string): Promise<Bar[]> {
  const key = `${symbol}|${from}|${to}`;
  const cached = barCache.get(key);
  if (cached) return cached;
  const p1 = Math.floor(Date.parse(from + "T00:00:00Z") / 1000);
  const p2 = Math.floor(Date.parse(to + "T23:59:59Z") / 1000);
  let bars: Bar[] = [];
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) }
    );
    const r: any = ((await res.json()) as any)?.chart?.result?.[0];
    const q = r?.indicators?.quote?.[0] ?? {};
    // London and Johannesburg quote in pence/cents (GBp, ZAc): to pounds/rand, like the order.
    const unit = /^(GBp|GBX|ZAc|ILA)$/.test(r?.meta?.currency ?? "") ? 100 : 1;
    bars = (r?.timestamp ?? []).map((ts: number, i: number) => ({
      day: new Date(ts * 1000).toISOString().slice(0, 10),
      open: q.open?.[i] / unit, high: q.high?.[i] / unit, low: q.low?.[i] / unit, close: q.close?.[i] / unit,
    })).filter((b: Bar) => b.high > 0 && b.low > 0);
  } catch { /* no data: unknown */ }
  barCache.set(key, bars);
  return bars;
}

export type ExecutionHint = {
  status: "likely" | "unlikely" | "open" | "unknown";
  text: string;
  /** First day it would have been executed, and at what price (to prefill the card). */
  day?: string;
  price?: number;
};

/**
 * Estimate from the market prices of the order's validity: a limit buy fills the first day the price drops to
 * the limit (at the limit, or at the open if it opened lower); a limit sell, the first day it rises to it; a market
 * order, its first trading day at that day's open. Only an estimate: BBVA never says.
 */
export async function executionHint(o: { isin: string; market: string | null; kind: string; limitPrice: number | null; validFrom: string | null; validTo: string | null; currency: string }): Promise<ExecutionHint> {
  const today = madridToday();
  const from = o.validFrom, to = o.validTo && o.validTo < today ? o.validTo : today;
  if (!from) return { status: "unknown", text: "Sin fechas de validez." };
  const t = await tickerForIsin(o.isin, o.market ?? "");
  if (!t) return { status: "unknown", text: "No se encuentra el valor en Yahoo para comprobarlo." };
  const bars = await dailyBars(t.symbol, from, to);
  if (!bars.length) return { status: "unknown", text: "Sin precios de esos días para comprobarlo." };
  const fmt = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 4 });
  const fmtDay = (d: string) => d.split("-").reverse().join("/");
  const still = !!o.validTo && o.validTo >= today;
  const limit = Number(o.limitPrice) || 0;
  if (!limit) {
    const b = bars[0];
    return { status: "likely", text: `A mercado: se ejecutaría el ${fmtDay(b.day)} a unos ${fmt(b.open)} ${o.currency}.`, day: b.day, price: Math.round(b.open * 10000) / 10000 };
  }
  const hit = bars.find((b) => (o.kind === "buy" ? b.low <= limit : b.high >= limit));
  if (hit) {
    const price = o.kind === "buy" ? Math.min(limit, hit.open) : Math.max(limit, hit.open);
    return {
      status: "likely", day: hit.day, price,
      text: `Probablemente se ejecutó el ${fmtDay(hit.day)}: el precio ${o.kind === "buy" ? `bajó a ${fmt(hit.low)}` : `subió a ${fmt(hit.high)}`} (límite ${fmt(limit)} ${o.currency}).`,
    };
  }
  const extreme = o.kind === "buy" ? Math.min(...bars.map((b) => b.low)) : Math.max(...bars.map((b) => b.high));
  const why = `el precio no ${o.kind === "buy" ? "bajó" : "subió"} a ${fmt(limit)} ${o.currency} (${o.kind === "buy" ? "mínimo" : "máximo"} ${fmt(extreme)}) entre el ${fmtDay(from)} y el ${fmtDay(to)}`;
  return still
    ? { status: "open", text: `Orden aún vigente hasta el ${fmtDay(o.validTo!)}: de momento ${why}.` }
    : { status: "unlikely", text: `Posiblemente no se ejecutó: ${why}.` };
}

/** Close of a Yahoo ticker on a day (or the last one before it), in its currency. */
async function closeOn(symbol: string, day: string): Promise<number | null> {
  const rows = (await prisma.$queryRawUnsafe(
    `select px from public.yahoo_daily_closes($1, $2::date - 7) where d <= $2::date order by d desc limit 1`, symbol, day
  ).catch(() => [])) as Array<{ px: unknown }>;
  const px = Number(rows[0]?.px);
  return px > 0 ? px : null;
}

/**
 * Turns a pending order into a buy/sell. Price: the one given; otherwise the limit; otherwise (market order) the
 * close of that day. Units and fee: the ones given, or the order's units and 0.
 */
async function executeOrder(id: string, body: any) {
  const rows: any[] = await prisma.$queryRawUnsafe(`select * from pending_orders where id = $1 and status = 'pending'`, id);
  const o = rows[0];
  if (!o) throw new HttpError(404, "Orden no encontrada.");
  const date = String(body?.date || (o.validFrom ? new Date(o.validFrom).toISOString().slice(0, 10) : madridToday()));
  const quantity = Number(body?.quantity || o.quantity), fee = Number(body?.fee || 0);
  let price = Number(body?.price) || Number(o.limitPrice) || 0;
  let priceSource = body?.price ? "given" : o.limitPrice ? "limit" : "close";
  const asset = await assetForIsin("BBVA", o.isin, o.name, o.currency, o.market ?? "", price);
  if (!(price > 0) && asset.symbol) price = (await closeOn(asset.symbol, date)) ?? 0;
  if (!(price > 0)) throw new HttpError(400, `Sin precio para ${o.name}: escríbelo en su tarjeta.`);
  if (!(quantity > 0) || !(fee >= 0)) throw new HttpError(400, "Indica títulos y comisión.");
  const result = await createMovement({
    kind: o.kind, assetId: asset.id, date, quantity, price, fee, useCash: o.kind === "sell",
    note: `Orden BBVA ${o.orderNo ?? ""} confirmada${priceSource === "close" ? " (precio: cierre del día)" : priceSource === "limit" ? " (precio: el límite)" : ""}`.trim(),
  });
  await prisma.$executeRawUnsafe(`update pending_orders set status = 'executed', "groupId" = $2 where id = $1`, o.id, result.groupId);
  return { ...result, price, priceSource };
}

export function registerPendingOrderRoutes(app: Express): void {
  app.get("/api/v2/pending-orders", handler(async (_req, res) => {
    const rows = await prisma.$queryRawUnsafe(
      `select id, broker, "orderNo", kind, isin, name, market, currency, quantity::float, "limitPrice"::float, modality,
              to_char("validFrom", 'YYYY-MM-DD') as "validFrom", to_char("validTo", 'YYYY-MM-DD') as "validTo",
              "orderedAt", modified
         from pending_orders where status = 'pending' order by "orderedAt" desc nulls last`
    ) as any[];
    // Estimate of each order against the market prices of its validity (in parallel: one Yahoo call per order).
    const hints: ExecutionHint[] = await Promise.all(rows.map((o) => executionHint(o).catch((): ExecutionHint => ({ status: "unknown", text: "" }))));
    // Two orders of the same security and side that would fill the same day: often one replaced the other.
    hints.forEach((h, i) => {
      if (h.status !== "likely" || !h.day) return;
      const twins = rows.filter((o, j) => j !== i && o.isin === rows[i].isin && o.kind === rows[i].kind && hints[j].status === "likely" && hints[j].day === h.day);
      if (twins.length) h.text += ` Ojo: ${twins.length === 1 ? "otra orden" : `otras ${twins.length} órdenes`} de este valor se ejecutaría${twins.length === 1 ? "" : "n"} el mismo día; puede que solo se ejecutara una.`;
    });
    // Shown with Yahoo's name for the ISIN (BBVA's document cuts long names: "BANCO", "OBRASCON").
    const names = await Promise.all(rows.map((o) => tickerForIsin(o.isin, o.market ?? "").catch(() => null)));
    res.json({ orders: rows.map((o, i) => ({ ...o, name: names[i]?.name ?? cleanName(o.name), hint: hints[i] })) });
  }));

  // "Descartar las que no se ejecutaron": closes every pending order the estimate says was not executed.
  app.post("/api/v2/pending-orders/cancel-unlikely", handler(async (_req, res) => {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `select id, isin, market, kind, "limitPrice"::float, to_char("validFrom", 'YYYY-MM-DD') as "validFrom",
              to_char("validTo", 'YYYY-MM-DD') as "validTo", currency
         from pending_orders where status = 'pending'`
    );
    let n = 0;
    for (const o of rows) {
      if ((await executionHint(o)).status !== "unlikely") continue;
      await prisma.$executeRawUnsafe(`update pending_orders set status = 'cancelled' where id = $1`, o.id);
      n++;
    }
    res.json({ cancelled: n });
  }));

  // "Se ejecutó": becomes a buy or sell with the real date, price, units and fee the user gives.
  app.post("/api/v2/pending-orders/:id/execute", handler(async (req, res) => {
    const result = await executeOrder(String(req.params.id), req.body ?? {});
    await refreshSnapshots(result.assetIds, result.day);
    res.json({ ok: true, price: result.price, priceSource: result.priceSource });
  }));

  // "Confirmar todas": every pending order as executed, with what the user filled in each card (missing price:
  // the limit, or for market orders the close of that day).
  app.post("/api/v2/pending-orders/execute-all", handler(async (req, res) => {
    const drafts = new Map<string, any>(((req.body?.items ?? []) as any[]).map((d) => [String(d.id), d]));
    const pending: Array<{ id: string; name: string }> = await prisma.$queryRawUnsafe(
      `select id, name from pending_orders where status = 'pending' order by "orderedAt" nulls first`
    );
    const done: string[] = [], failed: Array<{ name: string; error: string }> = [];
    const touched = new Set<string>();
    let firstDay: string | null = null;
    for (const o of pending) {
      try {
        const r = await executeOrder(o.id, drafts.get(o.id) ?? {});
        r.assetIds.forEach((id) => touched.add(id));
        if (!firstDay || r.day < firstDay) firstDay = r.day;
        done.push(o.name);
      } catch (e: any) {
        failed.push({ name: o.name, error: String(e?.message ?? e).slice(0, 160) });
      }
    }
    if (touched.size && firstDay) await refreshSnapshots([...touched], firstDay);
    res.json({ done: done.length, failed });
  }));

  app.post("/api/v2/pending-orders/:id/cancel", handler(async (req, res) => {
    await prisma.$executeRawUnsafe(`update pending_orders set status = 'cancelled' where id = $1`, String(req.params.id));
    res.json({ ok: true });
  }));
}
