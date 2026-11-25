import { Express, NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { assetDailyPnl, dailyPnl } from "./calendar";

// Portfolio API v2: operations are the source of truth for holdings, daily values come from
// daily_asset_snapshots (filled nightly by public.sync_daily_snapshots() in Supabase).

type Tx = any;
type OpType = "BUY" | "SELL";
type MovementKind = "buy" | "sell" | "deposit" | "withdraw" | "transfer" | "adjust";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 };

export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(typeof value === "object" ? String(value) : value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
}

function parseDay(value: unknown): string {
  const text = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new HttpError(400, "Fecha no valida.");
  }
  if (text > madridToday()) {
    throw new HttpError(400, "La fecha no puede ser futura.");
  }
  return text;
}

// Noon UTC keeps the calendar day stable whatever the server time zone.
function dayToTimestamp(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

function positive(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(400, `${label} debe ser mayor que 0.`);
  }
  return parsed;
}

function nonNegative(value: unknown, label: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${label} no puede ser negativo.`);
  }
  return parsed;
}

export function handler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((error) => {
      if (error instanceof HttpError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      next(error);
    });
  };
}

async function loadAsset(tx: Tx, assetId: string) {
  const asset = await tx.asset.findUnique({ where: { id: assetId }, include: { assetType: true, bank: true } });
  if (!asset) throw new HttpError(404, "Activo no encontrado.");
  return asset;
}

// Value in EUR of 1 unit of the currency on a day: stored snapshots first, then Yahoo, then the last known rate.
export async function fxOn(currency: string, day: string): Promise<number> {
  if (currency === "EUR") return 1;
  const snap = await prisma.dailyAssetSnapshot.findFirst({
    where: { currency, date: { lte: new Date(`${day}T00:00:00Z`) } },
    orderBy: { date: "desc" }
  });
  if (snap && ymd(snap.date) === day) return num(snap.fxToEur);
  const quotes = (await prisma.$queryRawUnsafe(
    `select px from public.yahoo_daily_closes($1, $2::date - 10) where d <= $2::date order by d desc limit 1`,
    `EUR${currency}=X`,
    day
  ).catch(() => [])) as Array<{ px: unknown }>;
  if (quotes[0] && num(quotes[0].px) > 0) return 1 / num(quotes[0].px);
  if (snap) return num(snap.fxToEur);
  const fx = await prisma.fxRate.findFirst({
    where: { fromCurrency: currency as any, toCurrency: "EUR" },
    orderBy: { date: "desc" }
  });
  if (!fx) throw new HttpError(400, `No hay tipo de cambio para ${currency}.`);
  return num(fx.rate);
}

// Price of an asset on a day, in the asset currency: last stored snapshot, else Yahoo, else the live price.
// Loan platforms (supabase/yield.sql): unit price grown from the latest anchor; null for any other asset.
async function yieldPrice(tx: Tx, assetId: string, day: string): Promise<number | null> {
  const rows: Array<{ px: unknown }> = await tx.$queryRawUnsafe(`select public.yield_price($1, $2::date) as px`, assetId, day);
  return rows[0]?.px === null || rows[0]?.px === undefined ? null : num(rows[0].px);
}

async function priceOn(assetId: string, day: string) {
  const asset = await loadAsset(prisma, assetId);
  const currency = asset.currency as string;
  if (asset.assetType.isLiquidity) {
    return { priceLocal: 1, currency, fxToEur: 1, priceEur: 1, date: day, source: "cash" };
  }
  const yieldPx = await yieldPrice(prisma, assetId, day);
  if (yieldPx !== null) {
    return { priceLocal: yieldPx, currency: "EUR", fxToEur: 1, priceEur: yieldPx, date: day, source: "accrual" };
  }
  const fxToEur = await fxOn(currency, day);
  const snap = await prisma.dailyAssetSnapshot.findFirst({
    where: { assetId, date: { lte: new Date(`${day}T00:00:00Z`) } },
    orderBy: { date: "desc" }
  });
  if (snap && snap.source !== "manual") {
    const priceEur = num(snap.priceEur);
    const sameCurrency = snap.currency === currency;
    return {
      priceLocal: sameCurrency ? num(snap.priceLocal) : round(priceEur / fxToEur, 8),
      currency,
      fxToEur: sameCurrency ? num(snap.fxToEur) : fxToEur,
      priceEur,
      date: ymd(snap.date),
      source: snap.source
    };
  }
  if (asset.marketSymbol) {
    // No stored history yet for that day (new asset): ask Yahoo for the close directly.
    const quotes = (await prisma.$queryRawUnsafe(
      `select d, px, cur from public.yahoo_daily_closes($1, $2::date - 10) where d <= $2::date order by d desc limit 1`,
      asset.marketSymbol,
      day
    ).catch(() => [])) as Array<{ d: Date; px: unknown; cur: string }>;
    const quote = quotes[0];
    if (quote) {
      const priceEur = num(quote.px) * (quote.cur === currency ? fxToEur : await fxOn(quote.cur, day));
      return {
        priceLocal: quote.cur === currency ? num(quote.px) : round(priceEur / fxToEur, 8),
        currency,
        fxToEur,
        priceEur,
        date: ymd(quote.d),
        source: "yahoo"
      };
    }
  }
  return {
    priceLocal: num(asset.marketPriceLocal),
    currency,
    fxToEur,
    priceEur: num(asset.marketPriceEur),
    date: day,
    source: "manual"
  };
}

// Assets created before operations existed carry their position in the asset row. The first time
// an operation is added, that position becomes an "opening" operation so history stays consistent.
async function ensureOpening(tx: Tx, assetId: string): Promise<void> {
  const count = await tx.assetOperation.count({ where: { assetId } });
  if (count > 0) return;
  const asset = await tx.asset.findUnique({ where: { id: assetId } });
  const quantity = num(asset.quantity);
  if (quantity <= 0) return;
  const costLocal = num(asset.investedCostLocal);
  const costEur = num(asset.investedCostEur);
  const day = ymd(asset.purchasedAt ?? asset.createdAt);
  await tx.assetOperation.create({
    data: {
      assetId,
      operationType: "BUY",
      kind: "opening",
      occurredAt: dayToTimestamp(day),
      quantity,
      priceLocal: round(costLocal / quantity),
      feeLocal: 0,
      fxToEur: costLocal > 0 ? round(costEur / costLocal) : 1,
      grossLocal: costLocal,
      grossEur: costEur,
      netLocal: costLocal,
      netEur: costEur,
      note: "Saldo inicial"
    }
  });
}

type OpInput = {
  assetId: string;
  type: OpType;
  kind: string;
  day: string;
  quantity: number;
  priceLocal: number;
  feeLocal?: number;
  fxToEur: number;
  groupId: string;
  note?: string | null;
  recurringId?: string | null;
  period?: string | null;
};

export async function addOp(tx: Tx, op: OpInput): Promise<string> {
  await ensureOpening(tx, op.assetId);
  const fee = op.feeLocal ?? 0;
  const grossLocal = round(op.quantity * op.priceLocal);
  const netLocal = op.type === "BUY" ? round(grossLocal + fee) : round(grossLocal - fee);
  const created = await tx.assetOperation.create({
    data: {
      assetId: op.assetId,
      operationType: op.type,
      kind: op.kind,
      occurredAt: dayToTimestamp(op.day),
      quantity: op.quantity,
      priceLocal: op.priceLocal,
      feeLocal: fee,
      fxToEur: op.fxToEur,
      grossLocal,
      grossEur: round(grossLocal * op.fxToEur),
      netLocal,
      netEur: round(netLocal * op.fxToEur),
      groupId: op.groupId,
      note: op.note?.trim() || null,
      recurringId: op.recurringId ?? null,
      period: op.period ?? null
    }
  });
  return created.id;
}

type FifoSale = {
  basisLocal: number;
  basisEur: number;
  /** Days each sold unit was held, weighted by quantity. */
  holdingDays: number;
  firstBuyDay: string;
  lastBuyDay: string;
};

// Replays the operations of one asset with FIFO lots (the criterion Spanish tax uses): each sale
// consumes the oldest purchases first. Returns cost basis and holding period of every sale and
// what is left open.
function replayFifo(ops: any[]): { sales: Map<string, FifoSale>; qty: number; costLocal: number; costEur: number } {
  type Lot = { qty: number; costLocal: number; costEur: number; day: string };
  const lots: Lot[] = [];
  const sales = new Map<string, FifoSale>();

  for (const op of ops) {
    const q = num(op.quantity);
    const day = ymd(op.occurredAt);
    if (op.operationType === "BUY") {
      if (q > 0) lots.push({ qty: q, costLocal: num(op.netLocal), costEur: num(op.netEur), day });
      continue;
    }
    const available = lots.reduce((s, l) => s + l.qty, 0);
    if (q > available + 1e-9) {
      throw new HttpError(400, `No hay suficiente cantidad para la venta del ${day} (tienes ${round(available, 6)}).`);
    }
    let left = q, basisLocal = 0, basisEur = 0, dayWeight = 0;
    let firstBuyDay = day, lastBuyDay = day;
    while (left > 1e-12 && lots.length) {
      const lot = lots[0];
      const take = Math.min(left, lot.qty);
      const share = take / lot.qty;
      basisLocal += lot.costLocal * share;
      basisEur += lot.costEur * share;
      dayWeight += take * Math.max(0, (Date.parse(day) - Date.parse(lot.day)) / 86_400_000);
      if (lot.day < firstBuyDay) firstBuyDay = lot.day;
      lastBuyDay = lot.day;
      lot.qty -= take;
      lot.costLocal -= lot.costLocal * share;
      lot.costEur -= lot.costEur * share;
      left -= take;
      if (lot.qty <= 1e-12) lots.shift();
    }
    sales.set(op.id, {
      basisLocal: round(basisLocal),
      basisEur: round(basisEur),
      holdingDays: q > 0 ? dayWeight / q : 0,
      firstBuyDay,
      lastBuyDay
    });
  }

  const qty = lots.reduce((s, l) => s + l.qty, 0);
  const open = qty > 1e-9;
  return {
    sales,
    qty: open ? qty : 0,
    costLocal: open ? lots.reduce((s, l) => s + l.costLocal, 0) : 0,
    costEur: open ? lots.reduce((s, l) => s + l.costEur, 0) : 0
  };
}

// Rebuilds the position of an asset from its operations (FIFO cost).
export async function recalcAsset(tx: Tx, assetId: string): Promise<void> {
  const ops = await tx.assetOperation.findMany({ where: { assetId }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] });
  if (ops.length === 0) {
    await tx.asset.update({
      where: { id: assetId },
      data: {
        quantity: 0, investedCostLocal: 0, investedCostEur: 0,
        totalBoughtQty: 0, totalBoughtCostLocal: 0, totalBoughtCostEur: 0,
        totalSoldQty: 0, totalSoldProceedsLocal: 0, totalSoldProceedsEur: 0,
        totalSoldCostBasisLocal: 0, totalSoldCostBasisEur: 0
      }
    });
    return;
  }

  const fifo = replayFifo(ops);
  let boughtQty = 0, boughtLocal = 0, boughtEur = 0;
  let soldQty = 0, soldLocal = 0, soldEur = 0, soldBasisLocal = 0, soldBasisEur = 0;

  for (const op of ops) {
    const q = num(op.quantity);
    if (op.operationType === "BUY") {
      boughtQty += q;
      boughtLocal += num(op.netLocal);
      boughtEur += num(op.netEur);
      continue;
    }
    const sale = fifo.sales.get(op.id)!;
    soldQty += q;
    soldLocal += num(op.netLocal);
    soldEur += num(op.netEur);
    soldBasisLocal += sale.basisLocal;
    soldBasisEur += sale.basisEur;
    if (num(op.costBasisEur) !== sale.basisEur || num(op.costBasisLocal) !== sale.basisLocal) {
      await tx.assetOperation.update({
        where: { id: op.id },
        data: {
          costBasisLocal: sale.basisLocal,
          costBasisEur: sale.basisEur,
          realizedPnlLocal: round(num(op.netLocal) - sale.basisLocal),
          realizedPnlEur: round(num(op.netEur) - sale.basisEur)
        }
      });
    }
  }

  const { qty, costLocal, costEur } = fifo;

  await tx.asset.update({
    where: { id: assetId },
    data: {
      quantity: round(qty),
      investedCostLocal: round(costLocal),
      investedCostEur: round(costEur),
      totalBoughtQty: round(boughtQty),
      totalBoughtCostLocal: round(boughtLocal),
      totalBoughtCostEur: round(boughtEur),
      totalSoldQty: round(soldQty),
      totalSoldProceedsLocal: round(soldLocal),
      totalSoldProceedsEur: round(soldEur),
      totalSoldCostBasisLocal: round(soldBasisLocal),
      totalSoldCostBasisEur: round(soldBasisEur)
    }
  });
}

// Runs the Supabase price job. Long backfills exceed Supabase's default statement timeout, so it is
// raised for this transaction only.
async function runPriceSync(fromDay?: string): Promise<unknown> {
  return prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRawUnsafe(`set local statement_timeout = '15min'`);
    const rows: Array<{ r: unknown }> = fromDay
      ? await tx.$queryRawUnsafe(`select public.sync_daily_snapshots($1::date) as r`, fromDay)
      : await tx.$queryRawUnsafe(`select public.sync_daily_snapshots() as r`);
    return rows[0]?.r ?? {};
  }, { timeout: 15 * 60_000, maxWait: 10_000 });
}

// Prices and snapshots of only these assets from fromDay (supabase/asset-snapshots.sql). An old movement or a
// ticket edit no longer re-syncs every asset of every user.
async function syncAssets(ids: string[], fromDay: string): Promise<void> {
  await prisma.$transaction(async (tx: Tx) => {
    await tx.$executeRawUnsafe(`set local statement_timeout = '10min'`);
    await tx.$queryRawUnsafe(`select public.sync_asset_snapshots($1::text[], $2::date) as r`, ids, fromDay);
  }, { timeout: 10 * 60_000, maxWait: 10_000 });
}

// Brings the daily snapshots in line after operations changed. Fetching prices again from Yahoo
// is only needed when the change goes further back than the stored history of an asset.
export async function refreshSnapshots(assetIds: string[], fromDay: string): Promise<void> {
  const ids = [...new Set(assetIds)];
  const firstDays = await prisma.dailyAssetSnapshot.groupBy({
    by: ["assetId"],
    where: { assetId: { in: ids } },
    _min: { date: true }
  });
  const firstByAsset = new Map(firstDays.map((row: any) => [row.assetId, row._min.date ? ymd(row._min.date) : null]));
  const needsFetch = ids.some((id) => {
    const first = firstByAsset.get(id);
    return !first || first > fromDay;
  });

  if (needsFetch) {
    await syncAssets(ids, fromDay);
    return;
  }

  for (const id of ids) {
    await prisma.$queryRawUnsafe(`select public.apply_operation_holdings($1, $2::date)`, id, fromDay);
    await prisma.$queryRawUnsafe(`select public.apply_yield_prices($1, $2::date)`, id, fromDay);
  }
  // Today's row also mirrors the live asset price.
  await prisma.$executeRawUnsafe(
    `update daily_asset_snapshots s
        set quantity = a.quantity, "costEur" = a."investedCostEur", "valueEur" = a.quantity * s."priceEur"
       from assets a
      where s."assetId" = a.id and a.id = any($1::text[]) and s.date = $2::date
        and not exists (select 1 from asset_operations o where o."assetId" = a.id)`,
    ids,
    madridToday()
  );
}

async function cashAssetOf(tx: Tx, bankId: string) {
  const cash = await tx.asset.findFirst({
    where: { bankId, assetType: { isLiquidity: true } },
    orderBy: { createdAt: "asc" }
  });
  if (!cash) {
    throw new HttpError(400, "Este banco no tiene una cuenta de liquido. Crea un activo de tipo liquido en el banco.");
  }
  return cash;
}

// Money from sales waiting to be reinvested: one cash account kept inside the portfolio, so selling and
// buying again doesn't move the net worth. Taking money out of it for personal use is a withdrawal.
const REINVEST_BANK = "Reinversión";
const REINVEST_ASSET = "Pendiente de reinvertir";

async function reinvestAccount(tx: Tx) {
  const existing = await tx.asset.findFirst({
    where: { name: REINVEST_ASSET, assetType: { isLiquidity: true } },
    include: { assetType: true, bank: true }
  });
  if (existing) return existing;
  const type = await tx.assetTypeEntity.findFirst({ where: { isLiquidity: true } });
  const bank = (await tx.bank.findFirst({ where: { name: REINVEST_BANK } })) ?? (await tx.bank.create({ data: { name: REINVEST_BANK } }));
  return tx.asset.create({
    data: { bankId: bank.id, name: REINVEST_ASSET, currency: "EUR", assetTypeId: type.id, marketPriceLocal: 1, marketPriceEur: 1 },
    include: { assetType: true, bank: true }
  });
}

function ensureBalance(cash: any, amountEur: number): void {
  if (amountEur > num(cash.quantity) + 0.005) {
    throw new HttpError(400, `Solo hay ${num(cash.quantity).toFixed(2)} € pendientes de reinvertir.`);
  }
}

type MovementResult = { assetIds: string[]; day: string; groupId: string };

export async function createMovement(body: any): Promise<MovementResult> {
  const kind = String(body?.kind ?? "") as MovementKind;
  const day = parseDay(body?.date ?? madridToday());
  const groupId = randomUUID();
  const note = body?.note ? String(body.note) : null;
  const touched: string[] = [];

  await prisma.$transaction(async (tx: Tx) => {
    if (kind === "buy" || kind === "sell") {
      const asset = await loadAsset(tx, String(body?.assetId ?? ""));
      if (asset.assetType.isLiquidity) throw new HttpError(400, "Para el liquido usa ingreso o retirada.");
      const quantity = positive(body?.quantity, "La cantidad");
      const price = positive(body?.price, "El precio");
      const fee = nonNegative(body?.fee, "La comision");
      const fx = body?.fxToEur ? positive(body.fxToEur, "El cambio") : await fxOn(asset.currency, day);
      const type: OpType = kind === "buy" ? "BUY" : "SELL";
      await addOp(tx, { assetId: asset.id, type, kind, day, quantity, priceLocal: price, feeLocal: fee, fxToEur: fx, groupId, note });
      touched.push(asset.id);

      if (body?.useCash) {
        const cash = await reinvestAccount(tx);
        const grossLocal = quantity * price;
        const amountEur = round((kind === "buy" ? grossLocal + fee : grossLocal - fee) * fx, 2);
        if (kind === "buy") ensureBalance(cash, amountEur);
        await addOp(tx, {
          assetId: cash.id, type: kind === "buy" ? "SELL" : "BUY", kind: kind === "buy" ? "withdraw" : "deposit",
          day, quantity: amountEur, priceLocal: 1, fxToEur: 1, groupId,
          note: `${kind === "buy" ? "Compra" : "Venta"} ${asset.name}`
        });
        touched.push(cash.id);
      }
    } else if (kind === "deposit" || kind === "withdraw") {
      // Without an account it is the money pending reinvestment.
      const asset = body?.assetId ? await loadAsset(tx, String(body.assetId)) : await reinvestAccount(tx);
      if (!asset.assetType.isLiquidity) throw new HttpError(400, "Los ingresos y retiradas van a una cuenta de liquido.");
      const amount = positive(body?.amount, "El importe");
      if (kind === "withdraw") ensureBalance(asset, amount);
      await addOp(tx, {
        assetId: asset.id, type: kind === "deposit" ? "BUY" : "SELL", kind, day,
        quantity: amount, priceLocal: 1, fxToEur: 1, groupId, note
      });
      touched.push(asset.id);
    } else if (kind === "transfer") {
      const from = await loadAsset(tx, String(body?.fromAssetId ?? ""));
      const to = await loadAsset(tx, String(body?.toAssetId ?? ""));
      if (from.id === to.id) throw new HttpError(400, "Elige dos activos distintos.");
      const quantity = positive(body?.quantity, "La cantidad");
      const sellPrice = from.assetType.isLiquidity ? 1 : positive(body?.sellPrice, "El precio de venta");
      const buyPrice = to.assetType.isLiquidity ? 1 : positive(body?.buyPrice, "El precio de compra");
      const fee = nonNegative(body?.fee, "La comision");
      const fromFx = await fxOn(from.currency, day);
      const toFx = await fxOn(to.currency, day);
      const proceedsEur = (quantity * sellPrice - fee) * fromFx;
      const boughtQty = round(proceedsEur / (buyPrice * toFx));
      await addOp(tx, {
        assetId: from.id, type: "SELL", kind: "transfer_out", day, quantity, priceLocal: sellPrice,
        feeLocal: fee, fxToEur: fromFx, groupId, note: note ?? `Traspaso a ${to.name}`
      });
      await addOp(tx, {
        assetId: to.id, type: "BUY", kind: "transfer_in", day, quantity: boughtQty, priceLocal: buyPrice,
        fxToEur: toFx, groupId, note: note ?? `Traspaso desde ${from.name}`
      });
      touched.push(from.id, to.id);
    } else if (kind === "adjust") {
      const asset = await loadAsset(tx, String(body?.assetId ?? ""));
      const isManual = !asset.assetType.isLiquidity && !asset.marketSymbol;
      const isYield = (await yieldPrice(tx, asset.id, day)) !== null;
      if (isYield && body?.value !== undefined && body?.value !== null && body?.value !== "") {
        // Loan platforms: the real balance fixes the unit price that day; the estimate grows from there.
        const value = nonNegative(body.value, "El valor");
        const snap = await tx.dailyAssetSnapshot.findFirst({
          where: { assetId: asset.id, date: { lte: new Date(`${day}T00:00:00Z`) } },
          orderBy: { date: "desc" }
        });
        const quantity = snap ? num(snap.quantity) : num(asset.quantity);
        if (!(quantity > 0) || !(value > 0)) throw new HttpError(400, "No hay saldo que ajustar ese dia.");
        const rates: Array<{ rate: unknown }> = await tx.$queryRawUnsafe(
          `select "annualRatePct" as rate from yield_anchors where "assetId" = $1 and date <= $2::date order by date desc limit 1`,
          asset.id, day
        );
        const rate = body?.annualRatePct !== undefined && body?.annualRatePct !== "" ? Number(body.annualRatePct) : num(rates[0]?.rate);
        if (!Number.isFinite(rate)) throw new HttpError(400, "Rentabilidad no valida.");
        await tx.$executeRawUnsafe(
          `insert into yield_anchors ("assetId", date, price, "annualRatePct") values ($1, $2::date, $3, $4)
           on conflict ("assetId", date) do update set price = excluded.price, "annualRatePct" = excluded."annualRatePct"`,
          asset.id, day, value / quantity, rate
        );
      } else if (isManual && body?.value !== undefined && body?.value !== null && body?.value !== "") {
        // Manually valued assets (real estate...): the adjustment sets today's value.
        const value = nonNegative(body.value, "El valor");
        const quantity = num(asset.quantity) > 0 ? num(asset.quantity) : 1;
        const fx = await fxOn(asset.currency, day);
        if (num(asset.quantity) <= 0) {
          await addOp(tx, { assetId: asset.id, type: "BUY", kind: "adjust", day, quantity, priceLocal: value / fx, fxToEur: fx, groupId, note });
        }
        await tx.asset.update({
          where: { id: asset.id },
          data: { marketPriceLocal: round(value / quantity / fx), marketPriceEur: round(value / quantity) }
        });
        await tx.dailyAssetSnapshot.updateMany({
          where: { assetId: asset.id, date: { gte: new Date(`${day}T00:00:00Z`) } },
          data: { priceLocal: round(value / quantity / fx), priceEur: round(value / quantity), valueEur: value }
        });
      } else {
        const target = nonNegative(body?.quantity, "La cantidad");
        await ensureOpening(tx, asset.id);
        await recalcAsset(tx, asset.id);
        const current = num((await tx.asset.findUnique({ where: { id: asset.id } })).quantity);
        const diff = round(target - current);
        if (Math.abs(diff) < 1e-9) throw new HttpError(400, "La cantidad ya es esa.");
        const price = asset.assetType.isLiquidity ? { priceLocal: 1, fxToEur: 1 } : await priceOn(asset.id, day);
        await addOp(tx, {
          assetId: asset.id, type: diff > 0 ? "BUY" : "SELL", kind: "adjust", day,
          quantity: Math.abs(diff), priceLocal: price.priceLocal, fxToEur: price.fxToEur, groupId,
          note: note ?? "Ajuste de saldo"
        });
      }
      touched.push(asset.id);
    } else {
      throw new HttpError(400, "Tipo de movimiento no valido.");
    }

    for (const id of new Set(touched)) {
      await recalcAsset(tx, id);
    }
  }, TX_OPTIONS);

  return { assetIds: touched, day, groupId };
}

export const REGION_CODES = ["ES", "EU", "US", "CN", "EM", "DEV", "COMMODITY", "CRYPTO", "CASH"] as const;

/** Geographic split (percent by region code). Stored per asset; otherwise inferred from the type. */
function resolveRegions(asset: any): Record<string, number> {
  const stored = asset.regions as Record<string, number> | null;
  if (stored && typeof stored === "object" && Object.keys(stored).length) return stored;
  switch (asset.assetType.code) {
    case "LIQUID": return { CASH: 100 };
    case "CRYPTO": return { CRYPTO: 100 };
    case "REAL_ESTATE": return { ES: 100 };
    // Mintos lends mostly through originators in emerging and eastern European markets.
    case "LOANS": return { EM: 100 };
    default: return {};
  }
}

// Stock exchange suffix of a Yahoo ticker -> region of the company. Only for stocks: an ETF or fund listed in
// Frankfurt can hold anything. ".F" (Frankfurt) and ".L" also list many foreign companies, so they are left out.
const SUFFIX_REGION: Record<string, string> = {
  MC: "ES",
  DE: "EU", PA: "EU", AS: "EU", MI: "EU", BR: "EU", LS: "EU", VI: "EU", HE: "EU", ST: "EU", CO: "EU", OL: "EU", SW: "EU", IR: "EU",
  HK: "CN", SS: "CN", SZ: "CN",
  T: "DEV", AX: "DEV", TO: "DEV", V: "DEV", NZ: "DEV",
};

/**
 * Geographic split for a new or re-tickered asset without one: the split of another asset with the same ticker
 * (the same stock in another bank), or, for stocks, the region of its exchange (no suffix = US market). Null
 * when it can't tell (funds, ETFs): those are set by hand in the asset's card.
 */
export async function guessRegions(symbol: string | null, typeCode: string): Promise<Record<string, number> | null> {
  if (!symbol) return null;
  const twin: Array<{ regions: Record<string, number> }> = await prisma.$queryRawUnsafe(
    `select regions from assets where "marketSymbol" = $1 and regions is not null and regions::text <> '{}' limit 1`, symbol
  );
  if (twin[0]?.regions && Object.keys(twin[0].regions).length) return twin[0].regions;
  if (typeCode !== "STOCK") return null;
  const dot = symbol.lastIndexOf(".");
  if (dot < 0) return { US: 100 };
  const region = SUFFIX_REGION[symbol.slice(dot + 1).toUpperCase()];
  return region ? { [region]: 100 } : null;
}

function parseRegions(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "object") throw new HttpError(400, "Reparto geografico no valido.");
  const out: Record<string, number> = {};
  for (const [code, pct] of Object.entries(value as Record<string, unknown>)) {
    if (!(REGION_CODES as readonly string[]).includes(code)) throw new HttpError(400, `Region desconocida: ${code}`);
    const n = Number(pct);
    if (Number.isFinite(n) && n > 0) out[code] = n;
  }
  return Object.keys(out).length ? out : null;
}

function monthKey(date: Date): string {
  return ymd(date).slice(0, 7);
}

/** Day of the month for a contribution, moved forward to Monday when it falls on a weekend. */
function businessDay(period: string, dayOfMonth: number): string {
  const date = new Date(`${period}-${String(dayOfMonth).padStart(2, "0")}T12:00:00Z`);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return ymd(date);
}

function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

async function getRecurringPayload() {
  const today = madridToday();
  const currentMonth = today.slice(0, 7);
  const plans = await prisma.recurringContribution.findMany({
    include: { asset: { include: { bank: true, assetType: true } } },
    orderBy: { createdAt: "asc" }
  });
  const done = await prisma.assetOperation.findMany({
    where: { recurringId: { not: null } },
    select: { recurringId: true, period: true, occurredAt: true, quantity: true, priceLocal: true, netEur: true, groupId: true }
  });
  const doneByKey = new Map(done.map((op: any) => [`${op.recurringId}|${op.period}`, op]));
  // Not in the Prisma schema (added by supabase/portfolio_v2.sql): months the user skipped.
  const skipped: Array<{ id: string; skippedPeriods: string[] }> = await prisma.$queryRawUnsafe(
    `select id, "skippedPeriods" from recurring_contributions`
  );
  const skippedByPlan = new Map(skipped.map((row) => [row.id, new Set(row.skippedPeriods)]));

  const pending: any[] = [];
  const items = [];
  for (const plan of plans) {
    const history = done
      .filter((op: any) => op.recurringId === plan.id)
      .sort((a: any, b: any) => String(b.period).localeCompare(String(a.period)))
      .map((op: any) => ({
        period: op.period, date: ymd(op.occurredAt), quantity: num(op.quantity),
        price: num(op.priceLocal), amountEur: num(op.netEur), groupId: op.groupId
      }));
    if (plan.active) {
      for (const period of monthsBetween(plan.startMonth, currentMonth)) {
        if (doneByKey.has(`${plan.id}|${period}`) || skippedByPlan.get(plan.id)?.has(period)) continue;
        const dueDay = businessDay(period, plan.dayOfMonth);
        if (dueDay > today) continue;
        // Estimate with the latest price available for that day; the user confirms the real units.
        const estimate = await priceOn(plan.assetId, dueDay).catch(() => null);
        const estPrice = estimate && estimate.priceLocal > 0 ? estimate.priceLocal : null;
        pending.push({
          recurringId: plan.id, period, dueDate: dueDay,
          assetId: plan.assetId, assetName: plan.asset.name, bankName: plan.asset.bank.name,
          amountEur: num(plan.amountEur),
          note: plan.note,
          estPrice,
          estPriceDate: estimate?.date ?? null,
          estQuantity: estPrice && estimate ? round(num(plan.amountEur) / (estPrice * estimate.fxToEur), 4) : null
        });
      }
    }
    items.push({
      id: plan.id, assetId: plan.assetId, assetName: plan.asset.name, bankName: plan.asset.bank.name,
      amountEur: num(plan.amountEur), dayOfMonth: plan.dayOfMonth, fromCash: plan.fromCash,
      startMonth: plan.startMonth, active: plan.active, note: plan.note,
      totalInvestedEur: round(history.reduce((sum: number, h: any) => sum + h.amountEur, 0), 2),
      history
    });
  }
  pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { items, pending };
}

/**
 * Daily series of the portfolio, or of some assets only (assetIds; null = all): value, cost, realized result,
 * running result (see calendar.ts) and the value of positions that show up already held (opening).
 */
export async function portfolioSeries(assetIds: string[] | null): Promise<Array<{ date: string; value: number; cost: number; realized: number; result: number; opening: number }>> {
  const params: unknown[] = assetIds ? [assetIds] : [];
  const only = (col: string) => (assetIds ? `${col} = any($1::text[])` : "true");
  // realized: gains/losses already closed by sales up to that day, so selling doesn't erase them.
  const series: Array<{ date: Date; value: unknown; cost: unknown; realized: unknown }> = await prisma.$queryRawUnsafe(
    `with d as (
       select date, sum("valueEur") as value, sum("costEur") as cost from daily_asset_snapshots where ${only("\"assetId\"")} group by date
     ), sales as (
       select o."occurredAt"::date as day, sum(o."realizedPnlEur") as pnl
         from asset_operations o
         join assets a on a.id = o."assetId"
         join asset_types t on t.id = a."assetTypeId"
        where o."operationType" = 'SELL' and not t."isLiquidity" and ${only("o.\"assetId\"")}
        group by 1
     )
     select d.date, d.value, d.cost,
            coalesce((select sum(s.pnl) from sales s where s.day <= d.date), 0) as realized
       from d order by d.date`, ...params
  );
  // Running total of the daily gains (see calendar.ts): the one figure every "result" on the overview uses.
  const resultByDay = new Map<string, number>();
  let running = 0;
  for (const d of await dailyPnl(assetIds)) resultByDay.set(d.date, (running += d.pnl));
  // Market value of the positions that show up already held: on their first day with value, with no real buy that
  // day (opening balances, positions loaded with just a quantity, or a price missing until then). Same rule as
  // the calendar, where that day is no gain. They were held before, only not tracked yet, so the return figures
  // count them as start value, not as money put in. Cash accounts are left out: their moves are sales and buys.
  const openingRows: Array<{ day: Date; value: unknown }> = await prisma.$queryRawUnsafe(
    `with s as (
       select s."assetId", s.date, s.quantity, s."valueEur",
              lag(s."valueEur") over (partition by s."assetId" order by s.date) as prev_value
         from daily_asset_snapshots s
         join assets a on a.id = s."assetId"
         join asset_types t on t.id = a."assetTypeId"
        where not t."isLiquidity" and ${only("s.\"assetId\"")}
          -- Days with quantity but no price are skipped, so a price missing for a few days is not a new position.
          and not (s.quantity > 0 and s."valueEur" = 0)
     )
     select s.date as day, sum(s."valueEur") as value
       from s
      where s.quantity > 0 and s."valueEur" > 0 and coalesce(s.prev_value, 0) <= 0
        and not exists (
          select 1 from asset_operations o
           where o."assetId" = s."assetId" and o."occurredAt"::date = s.date
             and o."operationType" = 'BUY' and coalesce(o.kind, 'buy') <> 'opening')
      group by s.date`, ...params
  );
  const openingByDay = new Map(openingRows.map((r) => [ymd(r.day), num(r.value)]));
  return series.map((row) => ({
    date: ymd(row.date), value: round(num(row.value), 2), cost: round(num(row.cost), 2), realized: round(num(row.realized), 2),
    result: round(resultByDay.get(ymd(row.date)) ?? 0, 2),
    opening: round(openingByDay.get(ymd(row.date)) ?? 0, 2)
  }));
}

export function registerPortfolioRoutes(app: Express): void {
  // Series of the assets of some banks and/or types (comma separated ids / type codes; empty = any).
  app.get("/api/v2/series", handler(async (req, res) => {
    const list = (v: unknown) => String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const banks = list(req.query.banks), types = list(req.query.types);
    if (!banks.length && !types.length) return void res.json({ series: await portfolioSeries(null) });
    const rows: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `select a.id from assets a join asset_types t on t.id = a."assetTypeId"
        where (cardinality($1::text[]) = 0 or a."bankId" = any($1::text[]))
          and (cardinality($2::text[]) = 0 or t.code = any($2::text[]))`,
      banks, types
    );
    res.json({ series: rows.length ? await portfolioSeries(rows.map((r) => r.id)) : [] });
  }));

  app.get("/api/v2/overview", handler(async (_req, res) => {
    const [assets, banks, types, lastRun] = await Promise.all([
      prisma.asset.findMany({ include: { assetType: true, bank: true }, orderBy: { name: "asc" } }),
      prisma.bank.findMany({ orderBy: { name: "asc" } }),
      prisma.assetTypeEntity.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.priceSyncRun.findFirst({ where: { finishedAt: { not: null } }, orderBy: { startedAt: "desc" } })
    ]);

    const series = await portfolioSeries(null);
    const realizedRows: Array<{ realized: unknown; basis: unknown }> = await prisma.$queryRawUnsafe(
      `select coalesce(sum(o."realizedPnlEur"), 0) as realized, coalesce(sum(o."costBasisEur"), 0) as basis
         from asset_operations o
         join assets a on a.id = o."assetId"
         join asset_types t on t.id = a."assetTypeId"
        where o."operationType" = 'SELL' and not t."isLiquidity"`
    );
    const realizedEur = round(num(realizedRows[0]?.realized), 2);
    // Loan platforms: the expected return in use (latest anchor).
    const yieldRows: Array<{ assetId: string; rate: unknown }> = await prisma.$queryRawUnsafe(
      `select distinct on ("assetId") "assetId", "annualRatePct" as rate from yield_anchors order by "assetId", date desc`
    );
    const yieldRate = new Map(yieldRows.map((r) => [r.assetId, num(r.rate)]));
    // Daily change = last close vs the close before it. Rows of non-trading days (weekends, or today
    // before the market closes) repeat the previous close, so walk back to the previous different price.
    const recent: Array<{ assetId: string; date: Date; priceLocal: unknown }> = await prisma.$queryRawUnsafe(
      `select "assetId", date, "priceLocal" from daily_asset_snapshots
        where date >= current_date - 15 and source in ('yahoo', 'accrual')
        order by "assetId", date desc`
    );
    const byAsset = new Map<string, Array<{ date: string; price: number }>>();
    for (const row of recent) {
      const list = byAsset.get(row.assetId) ?? [];
      list.push({ date: ymd(row.date), price: num(row.priceLocal) });
      byAsset.set(row.assetId, list);
    }
    const priceByAsset = new Map<string, { pct: number; closeDay: string }>();
    for (const [assetId, list] of byAsset) {
      const last = list[0];
      const prevIdx = list.findIndex((p) => Math.abs(p.price - last.price) > 1e-12);
      if (prevIdx <= 0) continue;
      // The latest close is the oldest day that already shows the latest price.
      priceByAsset.set(assetId, { pct: last.price / list[prevIdx].price - 1, closeDay: list[prevIdx - 1].date });
    }
    // Stock markets set "the last close" (crypto and accruing tickets move every day).
    const stockIds = new Set((assets as any[]).filter((a) => ["STOCK", "ETF", "FUND"].includes(a.assetType.code)).map((a) => a.id));
    const closeDays = [...priceByAsset.entries()].filter(([id]) => stockIds.has(id)).map(([, p]) => p.closeDay).sort();
    const lastCloseDay = closeDays.length ? closeDays[closeDays.length - 1] : null;

    const assetRows = assets.map((asset: any) => {
      const quantity = num(asset.quantity);
      const priceEur = num(asset.marketPriceEur);
      const valueEur = round(quantity * priceEur, 2);
      const costEur = round(num(asset.investedCostEur), 2);
      const realizedEur = round(num(asset.totalSoldProceedsEur) - num(asset.totalSoldCostBasisEur), 2);
      const prices = priceByAsset.get(asset.id);
      const dayChangePct = prices?.pct ?? 0;
      return {
        id: asset.id,
        name: asset.name,
        bankId: asset.bankId,
        bankName: asset.bank.name,
        typeCode: asset.assetType.code,
        typeName: asset.assetType.name,
        isLiquidity: asset.assetType.isLiquidity,
        currency: asset.currency,
        symbol: asset.marketSymbol,
        provider: asset.marketProvider,
        lastPriceSyncAt: asset.lastPriceSyncAt,
        quantity,
        priceLocal: num(asset.marketPriceLocal),
        priceEur,
        valueEur,
        costEur,
        pnlEur: round(valueEur - costEur, 2),
        pnlPct: costEur > 0 ? (valueEur - costEur) / costEur : 0,
        realizedEur,
        dayChangePct,
        dayChangeEur: dayChangePct ? round(valueEur - valueEur / (1 + dayChangePct), 2) : 0,
        regions: resolveRegions(asset),
        regionsCustom: !!asset.regions,
        yieldRatePct: yieldRate.get(asset.id) ?? null
      };
    });

    const totalEur = round(assetRows.reduce((s, a) => s + a.valueEur, 0), 2);
    const costEur = round(assetRows.reduce((s, a) => s + a.costEur, 0), 2);
    const dayChangeEur = round(assetRows.reduce((s, a) => s + a.dayChangeEur, 0), 2);
    const allocation = types
      .map((type: any) => ({
        code: type.code,
        name: type.name,
        valueEur: round(assetRows.filter((a) => a.typeCode === type.code).reduce((s, a) => s + a.valueEur, 0), 2)
      }))
      .filter((row: any) => row.valueEur > 0);

    res.json({
      asOf: madridToday(),
      lastCloseDay,
      totalEur,
      costEur,
      // Total result = open positions (unrealized) + everything already sold (realized).
      unrealizedEur: round(totalEur - costEur, 2),
      realizedEur,
      pnlEur: round(totalEur - costEur + realizedEur, 2),
      // Over the money put in net (cost minus what sales already returned): selling, reinvesting or
      // taking money out of the pending-reinvestment account leaves the percentage as it was.
      pnlPct: costEur - realizedEur > 0 ? (totalEur - costEur + realizedEur) / (costEur - realizedEur) : 0,
      dayChangeEur,
      dayChangePct: totalEur - dayChangeEur > 0 ? dayChangeEur / (totalEur - dayChangeEur) : 0,
      series,
      allocation,
      assets: assetRows,
      banks: banks.map((b: any) => ({ id: b.id, name: b.name })),
      types: types.map((t: any) => ({ code: t.code, name: t.name, isLiquidity: t.isLiquidity })),
      lastSync: lastRun
        ? { finishedAt: lastRun.finishedAt, assetsOk: lastRun.assetsOk, assetsFailed: lastRun.assetsFailed, errors: lastRun.errors }
        : null
    });
  }));

  // Asset x month matrix: snapshot of the 1st of every month plus the latest day.
  app.get("/api/v2/monthly", handler(async (_req, res) => {
    const rows: Array<any> = await prisma.$queryRawUnsafe(
      `select s."assetId", s.date, s."priceLocal", s.currency, s."priceEur", s."valueEur", s."costEur", s.quantity
         from daily_asset_snapshots s
        where extract(day from s.date) = 1
           or s.date = (select max(date) from daily_asset_snapshots)
        order by s.date`
    );
    const assets = await prisma.asset.findMany({ include: { assetType: true, bank: true }, orderBy: { name: "asc" } });
    const latest = rows.length ? ymd(rows[rows.length - 1].date) : madridToday();
    const months = [...new Set(rows.filter((r) => ymd(r.date).endsWith("-01")).map((r) => monthKey(r.date)))];

    // Running result of each asset (calendar rules: price moves and sales, never buying or paying in), so the gain
    // between two columns is resultB - resultA, the same figure as the calendar and the overview.
    const pnlByAsset = new Map<string, Array<{ date: string; pnl: number }>>();
    for (const r of await assetDailyPnl()) {
      const list = pnlByAsset.get(r.assetId) ?? [];
      list.push(r);
      pnlByAsset.set(r.assetId, list);
    }
    const resultAt = (assetId: string, day: string) =>
      round((pnlByAsset.get(assetId) ?? []).reduce((s, r) => (r.date <= day ? s + r.pnl : s), 0), 2);

    const byAsset = new Map<string, Record<string, any>>();
    for (const row of rows) {
      const day = ymd(row.date);
      const key = day === latest ? "now" : monthKey(row.date);
      const points = byAsset.get(row.assetId) ?? {};
      const point = {
        date: day,
        price: num(row.priceLocal),
        currency: row.currency,
        priceEur: num(row.priceEur),
        value: round(num(row.valueEur), 2),
        cost: round(num(row.costEur), 2),
        quantity: num(row.quantity),
        result: resultAt(row.assetId, day)
      };
      points[key] = point;
      if (day.endsWith("-01")) points[monthKey(row.date)] = point;
      byAsset.set(row.assetId, points);
    }
    // An asset sold or moved out stops having snapshots, but its result stays: fill the later columns with an
    // empty position that keeps it, so a period's gain doesn't lose what it made before leaving.
    const columns = [...months.map((m) => ({ key: m, day: `${m}-01` })), { key: "now", day: latest }];
    for (const [assetId, points] of byAsset) {
      let last: any = null;
      for (const c of columns) {
        if (points[c.key]) { last = points[c.key]; continue; }
        if (!last) continue;
        points[c.key] = { ...last, date: c.day, value: 0, cost: 0, quantity: 0, result: resultAt(assetId, c.day) };
      }
    }

    // Cumulative realized result at each column, so the totals don't lose a gain when something is sold.
    const sales: Array<{ day: Date; pnl: unknown }> = await prisma.$queryRawUnsafe(
      `select o."occurredAt"::date as day, o."realizedPnlEur" as pnl
         from asset_operations o
         join assets a on a.id = o."assetId"
         join asset_types t on t.id = a."assetTypeId"
        where o."operationType" = 'SELL' and not t."isLiquidity"`
    );
    const realizedAt = (day: string) =>
      round(sales.filter((s) => ymd(s.day) <= day).reduce((sum, s) => sum + num(s.pnl), 0), 2);
    const realized: Record<string, number> = { now: realizedAt(latest) };
    for (const m of months) realized[m] = realizedAt(`${m}-01`);

    res.json({
      months,
      latest,
      realized,
      assets: assets
        .filter((a: any) => byAsset.has(a.id))
        .map((a: any) => ({
          id: a.id, name: a.name, bankName: a.bank.name, typeCode: a.assetType.code, typeName: a.assetType.name,
          isLiquidity: a.assetType.isLiquidity, points: byAsset.get(a.id)
        }))
    });
  }));

  app.get("/api/v2/assets/:id/price", handler(async (req, res) => {
    const day = parseDay(req.query.date ?? madridToday());
    res.json(await priceOn(String(req.params.id), day));
  }));

  app.post("/api/v2/assets", handler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const bankId = String(req.body?.bankId ?? "");
    const typeCode = String(req.body?.typeCode ?? "");
    const currency = ["USD", "GBP"].includes(req.body?.currency) ? req.body.currency : "EUR";
    const symbol = String(req.body?.symbol ?? "").trim();
    if (name.length < 2 || !bankId) throw new HttpError(400, "Indica nombre y banco.");
    const type = await prisma.assetTypeEntity.findUnique({ where: { code: typeCode } });
    if (!type) throw new HttpError(400, "Tipo de activo no valido.");
    const exists = await prisma.asset.findFirst({ where: { bankId, name } });
    if (exists) throw new HttpError(409, "Ya existe un activo con ese nombre en ese banco.");
    const isLoans = type.code === "LOANS";
    const manualPrice = isLoans ? 1 : num(req.body?.manualPriceEur);
    const annualRatePct = isLoans ? Number(req.body?.annualRatePct ?? 8) : 0;
    if (isLoans && (!Number.isFinite(annualRatePct) || annualRatePct < -50 || annualRatePct > 100)) {
      throw new HttpError(400, "Rentabilidad anual no valida.");
    }
    const regions = req.body?.regions !== undefined
      ? parseRegions(req.body.regions)
      : await guessRegions(type.isLiquidity ? null : symbol || null, type.code);
    const asset = await prisma.asset.create({
      data: {
        bankId, name, currency, assetTypeId: type.id,
        marketSymbol: type.isLiquidity || !symbol ? null : symbol,
        marketProvider: type.isLiquidity || !symbol ? null : "yahoo",
        marketPriceLocal: type.isLiquidity ? 1 : manualPrice,
        marketPriceEur: type.isLiquidity ? 1 : manualPrice,
        ...(regions ? { regions } : {})
      }
    });
    if (isLoans) {
      const start = parseDay(req.body?.startDate ?? madridToday());
      await prisma.$executeRawUnsafe(
        `insert into yield_anchors ("assetId", date, price, "annualRatePct") values ($1, $2::date, 1, $3)`,
        asset.id, start, annualRatePct
      );
    }
    res.status(201).json({ id: asset.id });
  }));

  app.patch("/api/v2/assets/:id", handler(async (req, res) => {
    const asset = await loadAsset(prisma, String(req.params.id));
    const data: any = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 2) throw new HttpError(400, "El nombre es demasiado corto.");
      data.name = name;
    }
    if (req.body?.symbol !== undefined && !asset.assetType.isLiquidity) {
      const symbol = String(req.body.symbol).trim();
      data.marketSymbol = symbol || null;
      data.marketProvider = symbol ? "yahoo" : null;
    }
    if (["EUR", "USD", "GBP"].includes(req.body?.currency)) data.currency = req.body.currency;
    if (req.body?.regions !== undefined) data.regions = parseRegions(req.body.regions) ?? Prisma.DbNull;
    else if (data.marketSymbol && !(asset.regions && Object.keys(asset.regions as object).length)) {
      // New ticker on an asset without a split: guess it as for a new asset.
      const guess = await guessRegions(data.marketSymbol, asset.assetType.code);
      if (guess) data.regions = guess;
    }
    await prisma.asset.update({ where: { id: asset.id }, data });
    res.json({ ok: true });
  }));

  app.delete("/api/v2/assets/:id", handler(async (req, res) => {
    const id = String(req.params.id);
    await prisma.$transaction(async (tx: Tx) => {
      await tx.transfer.deleteMany({ where: { OR: [{ sourceAssetId: id }, { targetAssetId: id }] } });
      await tx.asset.delete({ where: { id } });
    }, TX_OPTIONS);
    res.json({ ok: true });
  }));

  app.get("/api/v2/movements", handler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 300) || 300, 2000);
    const ops = await prisma.assetOperation.findMany({
      include: { asset: { include: { bank: true, assetType: true } } },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: limit
    });
    res.json(ops.map((op: any) => ({
      id: op.id,
      groupId: op.groupId ?? op.id,
      date: ymd(op.occurredAt),
      type: op.operationType,
      kind: op.kind ?? (op.operationType === "BUY" ? "buy" : "sell"),
      assetId: op.assetId,
      assetName: op.asset.name,
      bankName: op.asset.bank.name,
      isLiquidity: op.asset.assetType.isLiquidity,
      currency: op.asset.currency,
      quantity: num(op.quantity),
      price: num(op.priceLocal),
      fee: num(op.feeLocal),
      amountEur: round(num(op.netEur), 2),
      realizedPnlEur: op.operationType === "SELL" ? round(num(op.realizedPnlEur), 2) : null,
      note: op.note,
      recurringId: op.recurringId,
      period: op.period
    })));
  }));

  app.post("/api/v2/movements", handler(async (req, res) => {
    const result = await createMovement(req.body);
    await refreshSnapshots(result.assetIds, result.day);
    res.status(201).json(result);
  }));

  app.delete("/api/v2/movements/:groupId", handler(async (req, res) => {
    const groupId = String(req.params.groupId);
    const ops = await prisma.assetOperation.findMany({ where: { OR: [{ groupId }, { id: groupId }] } });
    if (ops.length === 0) throw new HttpError(404, "Movimiento no encontrado.");
    const assetIds = [...new Set(ops.map((op: any) => op.assetId as string))];
    const fromDay = ops.map((op: any) => ymd(op.occurredAt)).sort()[0];
    await prisma.$transaction(async (tx: Tx) => {
      await tx.assetOperation.deleteMany({ where: { id: { in: ops.map((op: any) => op.id) } } });
      for (const id of assetIds) await recalcAsset(tx, id);
    }, TX_OPTIONS);
    await refreshSnapshots(assetIds, fromDay);
    res.json({ ok: true });
  }));

  app.get("/api/v2/recurring", handler(async (_req, res) => {
    res.json(await getRecurringPayload());
  }));

  app.post("/api/v2/recurring", handler(async (req, res) => {
    const asset = await loadAsset(prisma, String(req.body?.assetId ?? ""));
    if (asset.assetType.isLiquidity) throw new HttpError(400, "Elige un fondo o activo, no una cuenta de liquido.");
    const amountEur = positive(req.body?.amountEur, "El importe");
    const dayOfMonth = Math.min(28, Math.max(1, Math.round(Number(req.body?.dayOfMonth ?? 1))));
    const startMonth = /^\d{4}-\d{2}$/.test(String(req.body?.startMonth)) ? String(req.body.startMonth) : madridToday().slice(0, 7);
    await prisma.recurringContribution.create({
      data: { assetId: asset.id, amountEur, dayOfMonth, startMonth, fromCash: Boolean(req.body?.fromCash), note: req.body?.note || null }
    });
    res.status(201).json(await getRecurringPayload());
  }));

  // Drops one month from the pending list without buying anything.
  app.post("/api/v2/recurring/:id/skip", handler(async (req, res) => {
    const period = String(req.body?.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, "Mes no valido.");
    await prisma.$executeRawUnsafe(
      `update recurring_contributions set "skippedPeriods" = array_append("skippedPeriods", $1)
        where id = $2 and not ($1 = any("skippedPeriods"))`,
      period, String(req.params.id)
    );
    res.json(await getRecurringPayload());
  }));

  app.patch("/api/v2/recurring/:id", handler(async (req, res) => {
    const data: any = { updatedAt: new Date() };
    if (req.body?.amountEur !== undefined) data.amountEur = positive(req.body.amountEur, "El importe");
    if (req.body?.dayOfMonth !== undefined) data.dayOfMonth = Math.min(28, Math.max(1, Math.round(Number(req.body.dayOfMonth))));
    if (req.body?.active !== undefined) data.active = Boolean(req.body.active);
    if (req.body?.fromCash !== undefined) data.fromCash = Boolean(req.body.fromCash);
    if (req.body?.startMonth !== undefined && /^\d{4}-\d{2}$/.test(String(req.body.startMonth))) data.startMonth = String(req.body.startMonth);
    await prisma.recurringContribution.update({ where: { id: String(req.params.id) }, data });
    res.json(await getRecurringPayload());
  }));

  app.delete("/api/v2/recurring/:id", handler(async (req, res) => {
    // Registered contributions stay as normal buys.
    await prisma.recurringContribution.delete({ where: { id: String(req.params.id) } });
    res.json(await getRecurringPayload());
  }));

  // Registers one month of a recurring contribution as a buy at that day's price.
  app.post("/api/v2/recurring/:id/register", handler(async (req, res) => {
    const plan = await prisma.recurringContribution.findUnique({ where: { id: String(req.params.id) } });
    if (!plan) throw new HttpError(404, "Aportacion no encontrada.");
    const period = String(req.body?.period ?? "");
    if (!/^\d{4}-\d{2}$/.test(period)) throw new HttpError(400, "Mes no valido.");
    const already = await prisma.assetOperation.findFirst({ where: { recurringId: plan.id, period } });
    if (already) throw new HttpError(409, "Ese mes ya esta registrado.");

    const day = parseDay(req.body?.date ?? businessDay(period, plan.dayOfMonth));
    const amountEur = req.body?.amountEur !== undefined ? positive(req.body.amountEur, "El importe") : num(plan.amountEur);
    const price = await priceOn(plan.assetId, day);
    let priceLocal: number;
    let quantity: number;
    if (req.body?.quantity !== undefined && req.body?.quantity !== null && req.body?.quantity !== "") {
      // Units confirmed by the bank: the price is whatever the amount bought.
      quantity = positive(req.body.quantity, "Las participaciones");
      priceLocal = round(amountEur / price.fxToEur / quantity);
    } else {
      priceLocal = req.body?.price !== undefined ? positive(req.body.price, "El precio") : price.priceLocal;
      if (priceLocal <= 0) throw new HttpError(400, "No hay precio para ese dia. Indicalo a mano.");
      quantity = round(amountEur / (priceLocal * price.fxToEur));
    }
    const groupId = randomUUID();
    const touched = [plan.assetId];

    await prisma.$transaction(async (tx: Tx) => {
      const asset = await loadAsset(tx, plan.assetId);
      await addOp(tx, {
        assetId: plan.assetId, type: "BUY", kind: "recurring", day, quantity, priceLocal,
        fxToEur: price.fxToEur, groupId, recurringId: plan.id, period, note: "Aportacion periodica"
      });
      if (plan.fromCash) {
        const cash = await cashAssetOf(tx, asset.bankId);
        await addOp(tx, {
          assetId: cash.id, type: "SELL", kind: "withdraw", day, quantity: round(amountEur, 2),
          priceLocal: 1, fxToEur: 1, groupId, note: `Aportacion ${asset.name}`
        });
        touched.push(cash.id);
      }
      for (const id of touched) await recalcAsset(tx, id);
    }, TX_OPTIONS);

    await refreshSnapshots(touched, day);
    res.status(201).json(await getRecurringPayload());
  }));

  // Realized results: every sale with its FIFO cost, holding period and annualized return,
  // plus totals per fiscal year and per asset (closed positions).
  app.get("/api/v2/realized", handler(async (_req, res) => {
    const assets = await prisma.asset.findMany({
      where: { assetType: { isLiquidity: false }, operations: { some: { operationType: "SELL" } } },
      include: { bank: true, assetType: true, operations: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] } }
    });

    const sales: any[] = [];
    for (const asset of assets as any[]) {
      const fifo = replayFifo(asset.operations);
      for (const op of asset.operations) {
        if (op.operationType !== "SELL") continue;
        const sale = fifo.sales.get(op.id)!;
        const proceedsEur = round(num(op.netEur), 2);
        const costEur = round(sale.basisEur, 2);
        const pnlEur = round(proceedsEur - costEur, 2);
        const pnlPct = costEur > 0 ? pnlEur / costEur : 0;
        const days = Math.round(sale.holdingDays);
        sales.push({
          id: op.id,
          groupId: op.groupId ?? op.id,
          date: ymd(op.occurredAt),
          year: ymd(op.occurredAt).slice(0, 4),
          assetId: asset.id,
          assetName: asset.name,
          bankName: asset.bank.name,
          typeCode: asset.assetType.code,
          typeName: asset.assetType.name,
          kind: op.kind ?? "sell",
          note: op.note,
          quantity: num(op.quantity),
          price: num(op.priceLocal),
          currency: asset.currency,
          proceedsEur,
          costEur,
          pnlEur,
          pnlPct,
          holdingDays: days,
          firstBuyDay: sale.firstBuyDay,
          // Annualizing very short holdings gives meaningless numbers.
          annualizedPct: days >= 30 && costEur > 0 ? Math.pow(1 + pnlPct, 365 / days) - 1 : null,
          positionClosed: num(asset.quantity) <= 0
        });
      }
    }
    // Same day: stable order (by id), whatever order the database returns them in.
    sales.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

    const byYear = new Map<string, { year: string; gains: number; losses: number; net: number; proceeds: number; count: number }>();
    for (const s of sales) {
      const y = byYear.get(s.year) ?? { year: s.year, gains: 0, losses: 0, net: 0, proceeds: 0, count: 0 };
      if (s.pnlEur >= 0) y.gains += s.pnlEur; else y.losses += s.pnlEur;
      y.net += s.pnlEur;
      y.proceeds += s.proceedsEur;
      y.count += 1;
      byYear.set(s.year, y);
    }

    const byAsset = new Map<string, any>();
    for (const s of sales) {
      const a = byAsset.get(s.assetId) ?? {
        assetId: s.assetId, assetName: s.assetName, bankName: s.bankName, typeCode: s.typeCode, typeName: s.typeName,
        costEur: 0, proceedsEur: 0, pnlEur: 0, firstBuyDay: s.firstBuyDay, lastSellDay: s.date, daysWeight: 0,
        sales: 0, positionClosed: s.positionClosed
      };
      a.costEur += s.costEur;
      a.proceedsEur += s.proceedsEur;
      a.pnlEur += s.pnlEur;
      a.daysWeight += s.holdingDays * s.costEur;
      a.sales += 1;
      if (s.firstBuyDay < a.firstBuyDay) a.firstBuyDay = s.firstBuyDay;
      if (s.date > a.lastSellDay) a.lastSellDay = s.date;
      byAsset.set(s.assetId, a);
    }

    res.json({
      sales,
      byYear: [...byYear.values()].map((y) => ({
        ...y, gains: round(y.gains, 2), losses: round(y.losses, 2), net: round(y.net, 2), proceeds: round(y.proceeds, 2)
      })).sort((a, b) => b.year.localeCompare(a.year)),
      byAsset: [...byAsset.values()].map((a) => {
        const holdingDays = a.costEur > 0 ? Math.round(a.daysWeight / a.costEur) : 0;
        const pnlPct = a.costEur > 0 ? a.pnlEur / a.costEur : 0;
        return {
          assetId: a.assetId, assetName: a.assetName, bankName: a.bankName, typeCode: a.typeCode, typeName: a.typeName,
          costEur: round(a.costEur, 2), proceedsEur: round(a.proceedsEur, 2), pnlEur: round(a.pnlEur, 2), pnlPct,
          firstBuyDay: a.firstBuyDay, lastSellDay: a.lastSellDay, holdingDays, sales: a.sales,
          annualizedPct: holdingDays >= 30 && a.costEur > 0 ? Math.pow(1 + pnlPct, 365 / holdingDays) - 1 : null,
          positionClosed: a.positionClosed
        };
      }).sort((a, b) => b.lastSellDay.localeCompare(a.lastSellDay))
    });
  }));

  // An old position, bought and sold before the app existed: stored as its own asset with one buy and
  // one sell, so it counts in the realized results without touching the current portfolio.
  app.post("/api/v2/closed-positions", handler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const bankName = String(req.body?.bankName ?? "").trim();
    if (name.length < 2) throw new HttpError(400, "Indica el nombre del activo.");
    if (bankName.length < 2) throw new HttpError(400, "Indica el banco o broker.");
    const type = await prisma.assetTypeEntity.findUnique({ where: { code: String(req.body?.typeCode ?? "STOCK") } });
    if (!type || type.isLiquidity) throw new HttpError(400, "Tipo de activo no valido.");
    const buyDay = parseDay(req.body?.buyDate);
    const sellDay = parseDay(req.body?.sellDate);
    if (sellDay < buyDay) throw new HttpError(400, "La venta no puede ser anterior a la compra.");
    const quantity = req.body?.quantity ? positive(req.body.quantity, "La cantidad") : 1;
    const buyAmount = positive(req.body?.buyAmountEur, "El importe de compra");
    const sellAmount = nonNegative(req.body?.sellAmountEur, "El importe de venta");
    const groupId = randomUUID();

    const id = await prisma.$transaction(async (tx: Tx) => {
      const bank = (await tx.bank.findUnique({ where: { name: bankName } })) ?? (await tx.bank.create({ data: { name: bankName } }));
      // Several old positions can share a name (e.g. the same share sold in different years).
      let assetName = name;
      if (await tx.asset.findFirst({ where: { bankId: bank.id, name: assetName } })) assetName = `${name} (${sellDay.slice(0, 4)})`;
      let n = 2;
      while (await tx.asset.findFirst({ where: { bankId: bank.id, name: assetName } })) assetName = `${name} (${sellDay.slice(0, 4)}-${n++})`;
      const asset = await tx.asset.create({
        data: { bankId: bank.id, name: assetName, currency: "EUR", assetTypeId: type.id, purchasedAt: dayToTimestamp(buyDay) }
      });
      const note = req.body?.note ? String(req.body.note) : "Posicion antigua";
      await addOp(tx, { assetId: asset.id, type: "BUY", kind: "buy", day: buyDay, quantity, priceLocal: buyAmount / quantity, fxToEur: 1, groupId, note });
      await addOp(tx, { assetId: asset.id, type: "SELL", kind: "sell", day: sellDay, quantity, priceLocal: sellAmount / quantity, fxToEur: 1, groupId, note });
      await recalcAsset(tx, asset.id);
      return asset.id;
    }, TX_OPTIONS);

    res.status(201).json({ id });
  }));

  // Hourly portfolio value of the latest day with intraday points (see supabase/intraday.sql), plus the
  // previous day's close as the starting point of the "1D" chart.
  app.get("/api/v2/intraday", handler(async (_req, res) => {
    const points: Array<{ ts: Date; day: Date; value: unknown; cost: unknown }> = await prisma.$queryRawUnsafe(
      `with last_day as (
         select max((ts at time zone 'Europe/Madrid')::date) as d from intraday_asset_prices
       )
       select ts, (ts at time zone 'Europe/Madrid')::date as day, sum("valueEur") as value, sum("costEur") as cost
         from intraday_asset_prices, last_day
        where (ts at time zone 'Europe/Madrid')::date = last_day.d
        group by ts order by ts`
    );
    if (!points.length) {
      res.json({ day: null, points: [], previousClose: null });
      return;
    }
    const day = ymd(points[0].day);
    const prev: Array<{ date: Date; value: unknown; cost: unknown }> = await prisma.$queryRawUnsafe(
      `select date, sum("valueEur") as value, sum("costEur") as cost
         from daily_asset_snapshots where date < $1::date
        group by date order by date desc limit 1`,
      day
    );
    res.json({
      day,
      previousClose: prev[0] ? { date: ymd(prev[0].date), value: round(num(prev[0].value), 2), cost: round(num(prev[0].cost), 2) } : null,
      points: points.map((p) => ({ ts: p.ts.toISOString(), value: round(num(p.value), 2), cost: round(num(p.cost), 2) }))
    });
  }));

  // ---- Real estate crowdfunding tickets ----

  app.get("/api/v2/real-estate", handler(async (_req, res) => {
    const today = madridToday();
    const assets = await prisma.asset.findMany({
      where: { assetType: { code: "REAL_ESTATE" } },
      include: { bank: true, realEstateDetails: true, operations: { orderBy: { occurredAt: "asc" } } },
      orderBy: { purchasedAt: "asc" }
    });

    const tickets = (assets as any[]).map((a) => {
      const d = a.realEstateDetails;
      const quantity = num(a.quantity);
      const sell = [...a.operations].reverse().find((op: any) => op.operationType === "SELL");
      const buy = a.operations.find((op: any) => op.operationType === "BUY");
      const invested = d ? num(d.investedAmountEur) : num(a.investedCostEur);
      const ratePct = d ? num(d.expectedAnnualReturnPct) : 0;
      const start = d?.startDate ? ymd(d.startDate) : a.purchasedAt ? ymd(a.purchasedAt) : null;
      const termMonths = d?.termMonths ?? null;
      const end = start && termMonths ? addMonths(start, termMonths) : null;
      const totalDays = start && end ? daysBetween(start, end) : null;
      const elapsed = start && totalDays !== null ? Math.max(0, Math.min(daysBetween(start, today), totalDays)) : null;
      const expectedInterest = totalDays !== null ? invested * (ratePct / 100) * (totalDays / 365) : null;
      const accrued = elapsed !== null ? invested * (ratePct / 100) * (elapsed / 365) : null;
      const collected = quantity <= 0 && !!sell;
      const status = collected ? "collected" : !end ? "incomplete" : today >= end ? "matured" : "active";
      return {
        assetId: a.id,
        name: a.name,
        bankId: a.bankId,
        bankName: a.bank.name,
        investedEur: round(invested, 2),
        ratePct,
        startDate: start,
        termMonths,
        endDate: end,
        daysToEnd: end ? daysBetween(today, end) : null,
        progress: totalDays ? (elapsed ?? 0) / totalDays : null,
        accruedEur: accrued !== null ? round(accrued, 2) : null,
        expectedInterestEur: expectedInterest !== null ? round(expectedInterest, 2) : null,
        valueEur: collected ? 0 : round(quantity * num(a.marketPriceEur), 2),
        status,
        collectedDate: collected ? ymd(sell.occurredAt) : null,
        collectedEur: collected ? round(num(sell.netEur), 2) : null,
        realizedEur: collected ? round(num(sell.realizedPnlEur), 2) : null,
        buyGroupId: buy?.groupId ?? null
      };
    });
    res.json(tickets);
  }));

  app.post("/api/v2/real-estate", handler(async (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    const bankName = String(req.body?.bankName ?? "WeCity").trim() || "WeCity";
    if (name.length < 2) throw new HttpError(400, "Indica el nombre del proyecto.");
    const amount = positive(req.body?.amountEur, "El importe");
    const ratePct = nonNegative(req.body?.ratePct, "La rentabilidad");
    const termMonths = Math.round(positive(req.body?.termMonths, "El plazo"));
    const start = parseDay(req.body?.startDate ?? madridToday());
    const type = await prisma.assetTypeEntity.findUnique({ where: { code: "REAL_ESTATE" } });
    if (!type) throw new HttpError(500, "Falta el tipo Inmobiliario.");
    const groupId = randomUUID();
    const touched: string[] = [];

    await prisma.$transaction(async (tx: Tx) => {
      const bank = (await tx.bank.findUnique({ where: { name: bankName } })) ?? (await tx.bank.create({ data: { name: bankName } }));
      if (await tx.asset.findFirst({ where: { bankId: bank.id, name } })) {
        throw new HttpError(409, `Ya hay un ticket llamado "${name}" en ${bankName}.`);
      }
      const asset = await tx.asset.create({
        data: {
          bankId: bank.id, name, currency: "EUR", assetTypeId: type.id, purchasedAt: dayToTimestamp(start),
          marketPriceLocal: amount, marketPriceEur: amount, regions: { ES: 100 }
        }
      });
      await tx.realEstateDetails.create({
        data: {
          assetId: asset.id, investedAmountEur: amount, expectedAnnualReturnPct: ratePct,
          investmentPeriod: `${termMonths} meses`, startDate: new Date(`${start}T00:00:00Z`), termMonths
        }
      });
      await addOp(tx, { assetId: asset.id, type: "BUY", kind: "buy", day: start, quantity: 1, priceLocal: amount, fxToEur: 1, groupId, note: `Ticket ${ratePct} % a ${termMonths} meses` });
      touched.push(asset.id);
      if (req.body?.useCash) {
        const cash = await cashAssetOf(tx, bank.id);
        await addOp(tx, { assetId: cash.id, type: "SELL", kind: "withdraw", day: start, quantity: amount, priceLocal: 1, fxToEur: 1, groupId, note: `Ticket ${name}` });
        touched.push(cash.id);
      }
      for (const id of touched) await recalcAsset(tx, id);
    }, TX_OPTIONS);

    await refreshSnapshots(touched, start);
    res.status(201).json({ id: touched[0] });
  }));

  app.patch("/api/v2/real-estate/:id", handler(async (req, res) => {
    const id = String(req.params.id);
    const details = await prisma.realEstateDetails.findUnique({ where: { assetId: id } });
    const asset = await loadAsset(prisma, id);
    const data: any = { updatedAt: new Date() };
    if (req.body?.ratePct !== undefined) data.expectedAnnualReturnPct = nonNegative(req.body.ratePct, "La rentabilidad");
    if (req.body?.termMonths !== undefined) {
      data.termMonths = Math.round(positive(req.body.termMonths, "El plazo"));
      data.investmentPeriod = `${data.termMonths} meses`;
    }
    if (req.body?.startDate !== undefined) data.startDate = new Date(`${parseDay(req.body.startDate)}T00:00:00Z`);
    if (details) {
      await prisma.realEstateDetails.update({ where: { assetId: id }, data });
    } else {
      // Old aggregated holdings ("Todos") get their details completed here.
      await prisma.realEstateDetails.create({
        data: {
          assetId: id, investedAmountEur: num(asset.investedCostEur), expectedAnnualReturnPct: data.expectedAnnualReturnPct ?? 0,
          investmentPeriod: data.investmentPeriod ?? "", termMonths: data.termMonths ?? null,
          startDate: data.startDate ?? (asset.purchasedAt ? new Date(`${ymd(asset.purchasedAt)}T00:00:00Z`) : null)
        }
      });
    }
    if (req.body?.name !== undefined && String(req.body.name).trim().length >= 2) {
      await prisma.asset.update({ where: { id }, data: { name: String(req.body.name).trim() } });
    }
    const fresh = await prisma.realEstateDetails.findUnique({ where: { assetId: id } });
    if (fresh?.startDate) await syncAssets([id], ymd(fresh.startDate));
    res.json({ ok: true });
  }));

  // Collecting a ticket: it is "sold" for what was actually paid back (capital + interest).
  app.post("/api/v2/real-estate/:id/collect", handler(async (req, res) => {
    const id = String(req.params.id);
    const day = parseDay(req.body?.date ?? madridToday());
    const amount = nonNegative(req.body?.amountEur, "El importe cobrado");
    const groupId = randomUUID();
    const touched = [id];
    await prisma.$transaction(async (tx: Tx) => {
      const asset = await loadAsset(tx, id);
      if (asset.assetType.code !== "REAL_ESTATE") throw new HttpError(400, "No es un ticket inmobiliario.");
      await ensureOpening(tx, id);
      await recalcAsset(tx, id);
      const quantity = num((await tx.asset.findUnique({ where: { id } })).quantity);
      if (quantity <= 0) throw new HttpError(400, "Este ticket ya está cobrado.");
      await addOp(tx, { assetId: id, type: "SELL", kind: "sell", day, quantity, priceLocal: amount / quantity, fxToEur: 1, groupId, note: "Cobro del ticket" });
      if (req.body?.useCash) {
        const cash = await cashAssetOf(tx, asset.bankId);
        await addOp(tx, { assetId: cash.id, type: "BUY", kind: "deposit", day, quantity: amount, priceLocal: 1, fxToEur: 1, groupId, note: `Cobro ${asset.name}` });
        touched.push(cash.id);
      }
      for (const t of touched) await recalcAsset(tx, t);
    }, TX_OPTIONS);
    await refreshSnapshots(touched, day);
    res.status(201).json({ ok: true });
  }));

  // Runs the Supabase price job now (same one the nightly cron runs).
  app.post("/api/v2/prices/sync", handler(async (_req, res) => {
    res.json(await runPriceSync());
  }));
}

/** "2026-01-31" + 1 month -> "2026-02-28" (clamped to the end of the month). */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return ymd(target);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}
