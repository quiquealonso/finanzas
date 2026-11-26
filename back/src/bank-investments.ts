import { Express } from "express";
import { prisma } from "./prisma";
import { createMovement, handler, HttpError, refreshSnapshots } from "./portfolio";
import { tickerForIsin } from "./bbva-orders";
import { ensureAsset, findAsset, findSameOperation } from "./mail-import";

/**
 * Investments found among the bank movements (page Gastos → shown in Movimientos): a buy in Trade Republic, a
 * "compra de valores" in BBVA, money sent to MyInvestor, Lemon Way, Binance… Each one is left ready to be noted in the
 * portfolio with whatever data the bank gives (with an ISIN and units, one click; otherwise the user completes it).
 * Before offering it, it looks for the same operation already in the portfolio (same day ±, same money or units),
 * so nothing is noted twice. Nothing is written until the user says so.
 */
type Side = "buy" | "sell";
export type Detected = {
  kind: "trade" | "securities" | "platform";
  side: Side;
  isin: string | null;
  name: string | null;
  quantity: number | null;
  /** Where the money went (a platform), to find the bank of the portfolio. */
  platform: string | null;
};

const ISIN = "([A-Z]{2}[A-Z0-9]{9}\\d)";
const TRADE = new RegExp(`\\b(Buy|Sell) trade ${ISIN} (.+?)(?:, quantity: ([\\d.]+))?$`, "i");
const PLAN = new RegExp(`\\b(?:Savings plan execution|Saveback|Round up)\\b.*?${ISIN} (.+?)(?:, quantity: ([\\d.]+))?$`, "i");
const SECURITIES = /COMPRA DE VALORES|CARGO POR COMPRA DE T[IÍ]TULOS|OPERACI[OÓ]N DE CRIPTOACTIVOS|SUSCRIPCI[OÓ]N (DE )?FONDO/i;
const SECURITIES_SELL = /VENTA DE VALORES|ABONO POR VENTA DE T[IÍ]TULOS|REEMBOLSO (DE )?FONDO/i;
/** Platforms that money is sent to for investing (text found in the movement → name shown). */
const PLATFORMS: Array<[RegExp, string]> = [
  [/MYINVESTOR/i, "MyInvestor"], [/TRADE ?REPUBLIC/i, "Trade Republic"], [/BINANCE/i, "Binance"], [/NEVERLESS/i, "Neverless"],
  [/MINTOS/i, "Mintos"], [/URBANITAE/i, "Urbanitae"], [/WECITY/i, "WeCity"], [/LEMON ?WAY|\bLMW\b/i, "Lemon Way"],
  [/INDEXA/i, "Indexa Capital"], [/COINBASE/i, "Coinbase"], [/KRAKEN/i, "Kraken"], [/BITPANDA/i, "Bitpanda"],
];

/** Whether a bank movement is an investment, and what can be read from it. */
export function detectInvestment(t: { amount: number; description: string; counterparty: string | null }, ownAccountBank: string): Detected | null {
  const text = `${t.description} ${t.counterparty ?? ""}`.replace(/\s+/g, " ").trim();
  let m = TRADE.exec(text.replace(/^Operar:\s*/i, ""));
  if (m) return { kind: "trade", side: /sell/i.test(m[1]) ? "sell" : "buy", isin: m[2], name: m[3].trim(), quantity: m[4] ? Number(m[4]) : null, platform: ownAccountBank };
  m = PLAN.exec(text.replace(/^Operar:\s*/i, ""));
  if (m) return { kind: "trade", side: "buy", isin: m[1], name: m[2].trim(), quantity: m[3] ? Number(m[3]) : null, platform: ownAccountBank };
  if (SECURITIES.test(text) && t.amount < 0) return { kind: "securities", side: "buy", isin: /\b[A-Z]{2}[A-Z0-9]{9}\d\b/.exec(text)?.[0] ?? null, name: null, quantity: null, platform: ownAccountBank };
  if (SECURITIES_SELL.test(text) && t.amount > 0) return { kind: "securities", side: "sell", isin: null, name: null, quantity: null, platform: ownAccountBank };
  if (t.amount < 0) {
    for (const [re, name] of PLATFORMS) {
      if (name === ownAccountBank) continue; // a card payment or fee of the same bank is not money sent to it
      if (re.test(text)) return { kind: "platform", side: "buy", isin: null, name: null, quantity: null, platform: name };
    }
  }
  return null;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const tickerCache = new Map<string, string | null>();
async function symbolOf(isin: string): Promise<string | null> {
  if (!tickerCache.has(isin)) tickerCache.set(isin, (await tickerForIsin(isin, "").catch(() => null))?.symbol ?? null);
  return tickerCache.get(isin)!;
}

type Bank = { id: string; name: string };
const bankFor = (banks: Bank[], platform: string | null) =>
  platform ? banks.find((b) => norm(b.name) === norm(platform)) ?? banks.find((b) => norm(b.name).includes(norm(platform)) || norm(platform).includes(norm(b.name))) ?? null : null;

/** An operation already in the portfolio with the same money (±1,5 % or 1,5 €) between 10 days before and 5 after. */
async function sameMoney(bankId: string | null, side: Side, day: string, amount: number, used: Set<string>): Promise<{ id: string; day: string; assetName: string } | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; day: string; assetName: string }>>(
    `select o.id, to_char(o."occurredAt", 'YYYY-MM-DD') as day, a.name as "assetName"
       from asset_operations o join assets a on a.id = o."assetId" join asset_types ty on ty.id = a."assetTypeId"
      where not ty."isLiquidity" and o."operationType"::text = $1 and ($2::text is null or a."bankId" = $2)
        and o."occurredAt"::date between $3::date - 10 and $3::date + 5
        and least(abs(o."netEur" - $4), abs(o."grossEur" - $4)) <= greatest(1.5, $4 * 0.015)
        and not exists (select 1 from bank_transactions b where b."invOperationId" = o.id)
        and not (o.id = any($5::text[]))
      order by abs(o."occurredAt"::date - $3::date) limit 1`,
    side === "buy" ? "BUY" : "SELL", bankId, day, amount, [...used]);
  return rows[0] ?? null;
}

/** Words that say nothing about which security it is. */
const GENERIC = new Set(["group", "grupo", "holding", "holdings", "class", "ucits", "index", "fund", "fondo", "core", "acc", "dist", "swap", "units", "multi", "luxembourg", "corp", "corporation", "limited", "ltd", "inc", "plc", "shares", "share", "etf"]);
const words = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !GENERIC.has(w));

/** The asset of the bank whose name shares the most telling words with the bank's text (e.g. "Amundi … Nasdaq-100"). */
async function assetByName(bankId: string, name: string): Promise<{ id: string; name: string } | null> {
  const want = new Set(words(name));
  if (!want.size) return null;
  const list = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(
    `select a.id, a.name from assets a join asset_types ty on ty.id = a."assetTypeId" where a."bankId" = $1 and not ty."isLiquidity"`, bankId);
  let best: { id: string; name: string } | null = null, score = 0;
  for (const a of list) {
    const s = words(a.name).filter((w) => want.has(w)).length;
    if (s > score) { best = a; score = s; }
  }
  return best;
}

type Row = { id: string; date: string; amount: number; description: string; counterparty: string | null; bank: string; account: string; invStatus: string | null; invOperationId: string | null };

async function candidates(all: boolean) {
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `select t.id, to_char(t."bookingDate", 'YYYY-MM-DD') as date, t.amount::float as amount, t.description, t.counterparty,
            l.aspsp as bank, a.name as account, t."invStatus", t."invOperationId"
       from bank_transactions t join bank_accounts a on a.id = t."accountId" join bank_links l on l.id = a."linkId"
      where not a.hidden ${all ? "" : `and t."invStatus" is null`}
      order by t."bookingDate" desc`);
  const banks = await prisma.$queryRawUnsafe<Bank[]>(`select id, name from banks order by name`);
  // Money sent to another bank connected here (BBVA → Trade Republic) is a transfer between own accounts, not an investment.
  const linked = new Set((await prisma.$queryRawUnsafe<Array<{ aspsp: string }>>(`select distinct aspsp from bank_links where status = 'active'`)).map((l) => norm(l.aspsp)));
  const out = [];
  // One operation of the portfolio can only be the match of one bank movement.
  const used = new Set<string>();
  for (const r of rows) {
    const d = detectInvestment(r, r.bank);
    if (!d) continue;
    if (d.kind === "platform" && d.platform && linked.has(norm(d.platform))) continue;
    const amount = Math.abs(r.amount);
    const bank = bankFor(banks, d.platform);
    let asset: { id: string; name: string } | null = null;
    if (bank && (d.isin || d.name)) asset = await findAsset(bank.id, d.isin ? await symbolOf(d.isin) : null, d.name ?? "") ?? (d.name ? await assetByName(bank.id, d.name) : null);
    let match: { id: string; day: string; assetName: string; sure: boolean } | null = null;
    let partOf: { id: string; day: string; assetName: string; quantity: number } | null = null;
    if (!r.invStatus) {
      if (asset && d.quantity) {
        const same = await findSameOperation(asset.id, d.side, r.date, r.date, d.quantity);
        if (same) match = { id: same.id, day: same.day, assetName: asset.name, sure: same.sure };
      }
      if (!match) {
        const s = await sameMoney(bank?.id ?? null, d.side, r.date, amount, used);
        if (s) match = { ...s, sure: false };
      }
      if (match && used.has(match.id)) match = null;
      if (match) used.add(match.id);
      // Several small buys noted by hand as one bigger operation (133 + 0,33 + 50 noted as 183,33): an operation of the
      // same asset close in time with at least these units may already include it. Not "ready": the user decides.
      if (!match && asset && d.quantity) {
        const [big] = await prisma.$queryRawUnsafe<Array<{ id: string; day: string; qty: number }>>(
          `select id, to_char("occurredAt", 'YYYY-MM-DD') as day, quantity::float as qty from asset_operations
            where "assetId" = $1 and "operationType"::text = $2 and "occurredAt"::date between $3::date - 10 and $3::date + 10
              and quantity >= $4 * 0.99 order by abs("occurredAt"::date - $3::date) limit 1`,
          asset.id, d.side === "buy" ? "BUY" : "SELL", r.date, d.quantity);
        if (big) partOf = { id: big.id, day: big.day, assetName: asset.name, quantity: big.qty };
      }
    }
    out.push({
      id: r.id, date: r.date, amount, side: d.side, kind: d.kind, text: r.description, fromBank: r.bank,
      isin: d.isin, name: d.name, quantity: d.quantity, platform: d.platform,
      bankId: bank?.id ?? null, bankName: bank?.name ?? null, assetId: asset?.id ?? null, assetName: asset?.name ?? null,
      status: r.invStatus, operationId: r.invOperationId, match, partOf,
      /** Everything known and nothing similar in the portfolio: one click is enough. */
      ready: !!bank && !!d.quantity && (!!asset || !!d.name) && !partOf && !match,
    });
  }
  return { items: out, banks };
}

async function setStatus(id: string, status: string | null, operationId: string | null = null): Promise<void> {
  const n = await prisma.$executeRawUnsafe(`update bank_transactions set "invStatus" = $2, "invOperationId" = $3 where id = $1`, id, status, operationId);
  if (!n) throw new HttpError(404, "No existe.");
}

export function registerBankInvestmentRoutes(app: Express): void {
  // Investments found in the bank movements; ?all=1 also the ones already noted or ignored.
  app.get("/api/v2/banking/investments", handler(async (req, res) => {
    res.json(await candidates(req.query.all === "1"));
  }));

  // It was already in the portfolio: link it to that operation.
  app.post("/api/v2/banking/investments/:id/link", handler(async (req, res) => {
    await setStatus(String(req.params.id), "done", String(req.body?.operationId ?? "") || null);
    res.json({ ok: true });
  }));
  app.post("/api/v2/banking/investments/:id/ignore", handler(async (req, res) => {
    await setStatus(String(req.params.id), "ignored");
    res.json({ ok: true });
  }));
  app.post("/api/v2/banking/investments/:id/reopen", handler(async (req, res) => {
    await setStatus(String(req.params.id), null);
    res.json({ ok: true });
  }));

  // Note it in the portfolio: a buy (or sell) of `quantity` for the money of the movement, in an asset of the bank
  // (an existing one, or a new one with that name).
  app.post("/api/v2/banking/investments/:id/apply", handler(async (req, res) => {
    const { items } = await candidates(true);
    const c = items.find((x) => x.id === req.params.id);
    if (!c) throw new HttpError(404, "No es una inversión detectada.");
    if (c.status === "done") throw new HttpError(400, "Ya está apuntada.");
    const bankId = String(req.body?.bankId ?? c.bankId ?? "");
    if (!bankId) throw new HttpError(400, "Elige en qué banco o plataforma está la inversión.");
    const quantity = Number(req.body?.quantity ?? c.quantity);
    const amount = Number(req.body?.amount ?? c.amount);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date ?? "")) ? String(req.body.date) : c.date;
    if (!(quantity > 0)) throw new HttpError(400, "Pon cuántos títulos o participaciones.");
    if (!(amount > 0)) throw new HttpError(400, "Pon el importe.");
    let assetId = String(req.body?.assetId ?? c.assetId ?? "");
    if (!assetId) {
      const name = String(req.body?.newName ?? c.name ?? "").trim();
      if (!name) throw new HttpError(400, "Elige el activo o escribe el nombre de uno nuevo.");
      const typed = !!req.body?.newName && req.body.newName !== c.name; // a name the user wrote is kept as is
      const made = await ensureAsset({ bankId, name: typed ? name : titleCase(name), opName: name, isin: c.isin, currency: "EUR", price: amount / quantity, typeCode: req.body?.typeCode || undefined, marketName: !typed });
      assetId = made.id;
    }
    const result = await createMovement({
      kind: c.side, assetId, date, quantity, price: amount / quantity, fee: 0,
      useCash: c.side === "sell", note: `Desde ${c.fromBank}: ${c.text}`.slice(0, 300),
    });
    const [op] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`select id from asset_operations where "groupId" = $1 and "assetId" = $2`, result.groupId, assetId);
    await setStatus(c.id, "done", op?.id ?? null);
    await refreshSnapshots(result.assetIds, date);
    res.json({ ok: true, assetId });
  }));
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, (ch) => ch.toUpperCase());
