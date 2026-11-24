import { Express } from "express";
import { randomUUID } from "crypto";
import { currentUser, DEFAULT_USER, prisma, USERS, withUser } from "./prisma";
import { addOp, fxOn, handler, madridToday, num, recalcAsset, refreshSnapshots, round, TX_OPTIONS } from "./portfolio";

// Perpetual futures from Hyperliquid (MetaMask Perps runs on it), read only with the public wallet address.
// Model and tables: see supabase/perps.sql. In short: one CRYPTO asset per coin, 1 unit = 1 USD of margin,
// value = margin + unrealized PnL (never the notional). Fills become operations, deduped by source + externalId
// in external_operations; funding and fees also go to perp_costs.

const API = "https://api.hyperliquid.xyz/info";
const SOURCE = "hyperliquid";

type Fill = {
  coin: string; px: string; sz: string; side: "B" | "A"; time: number; startPosition: string; dir: string;
  closedPnl: string; hash: string; tid: number; fee: string; builderFee?: string; feeToken: string;
};
type Position = {
  coin: string; szi: string; leverage: { type: string; value: number }; entryPx: string; positionValue: string;
  unrealizedPnl: string; liquidationPx: string | null; marginUsed: string; cumFunding?: { sinceOpen: string };
};
type Funding = { time: number; hash: string; delta: { type: string; coin: string; usdc: string; szi: string; fundingRate: string } };

async function info<T>(body: object): Promise<T> {
  const res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Hyperliquid ${(body as any).type}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Calendar day in Madrid of a millisecond timestamp. */
const madridDay = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(ms));

/** Perps only: spot pairs come as "@107" or "PURR/USDC". */
const isPerp = (coin: string) => !coin.startsWith("@") && !coin.includes("/");

/** Value a position adds to the net worth: isolated margin already includes the unrealized PnL, cross does not. */
function positionValue(p: Position): { margin: number; upnl: number; value: number } {
  const used = num(p.marginUsed), upnl = num(p.unrealizedPnl);
  return p.leverage.type === "isolated" ? { margin: used - upnl, upnl, value: used } : { margin: used, upnl, value: used + upnl };
}

/** Asset of one coin of one account, created the first time the coin shows up. */
async function perpAsset(address: string, bankId: string, coin: string): Promise<string> {
  const rows: Array<{ assetId: string }> = await prisma.$queryRawUnsafe(
    `select "assetId" from perp_positions where address = $1 and coin = $2`, address, coin
  );
  if (rows[0]) return rows[0].assetId;
  const type = await prisma.assetTypeEntity.findUnique({ where: { code: "CRYPTO" } });
  const asset = await prisma.asset.create({
    data: {
      bankId, name: `${coin} Perp`, currency: "USD", assetTypeId: type!.id,
      marketSymbol: null, marketProvider: SOURCE, marketPriceLocal: 1, marketPriceEur: 0,
      regions: { CRYPTO: 100 }
    }
  });
  await prisma.$executeRawUnsafe(
    `insert into perp_positions ("assetId", address, coin, side) values ($1, $2, $3, 'closed')`, asset.id, address, coin
  );
  return asset.id;
}

type SyncResult = { address: string; newOperations: number; newCosts: number; positions: Array<{ coin: string; side: string; valueUsd: number }> };

/** Imports new fills, funding and fees of one account and refreshes its open positions. */
async function syncAccount(address: string, bankId: string): Promise<SyncResult> {
  const [state, fills, funding] = await Promise.all([
    info<{ assetPositions: Array<{ position: Position }> }>({ type: "clearinghouseState", user: address }),
    info<Fill[]>({ type: "userFills", user: address }),
    info<Funding[]>({ type: "userFunding", user: address, startTime: 0 })
  ]);
  const open = new Map(state.assetPositions.map((x) => [x.position.coin, x.position]));
  const perpFills = fills.filter((f) => isPerp(f.coin)).sort((a, b) => a.time - b.time || a.tid - b.tid);
  const coins = new Set([...perpFills.map((f) => f.coin), ...open.keys()]);

  const known = new Set(
    ((await prisma.$queryRawUnsafe(`select "externalId" from external_operations where source = $1`, SOURCE)) as Array<{ externalId: string }>)
      .map((r) => r.externalId)
  );
  let newOperations = 0, newCosts = 0;
  const touched = new Map<string, string>(); // assetId -> earliest day with a new operation

  for (const coin of coins) {
    const assetId = await perpAsset(address, bankId, coin);
    const leverage = open.get(coin)?.leverage.value ?? 1;
    // Replay every fill of the coin to know the margin units at each step; only the new ones are written.
    let units = 0;
    const ops: Array<{ externalId: string; type: "BUY" | "SELL"; day: string; quantity: number; price: number; fee: number; note: string }> = [];
    for (const f of perpFills.filter((x) => x.coin === coin)) {
      const sz = num(f.sz), start = num(f.startPosition);
      const signed = f.side === "B" ? sz : -sz;
      // Part of the fill that reduces the position, and part that opens (or flips) it.
      const closing = start !== 0 && Math.sign(signed) !== Math.sign(start) ? Math.min(sz, Math.abs(start)) : 0;
      const opening = sz - closing;
      const fee = num(f.fee) + num(f.builderFee);
      const day = madridDay(f.time);
      if (closing > 0) {
        const out = units * (closing / Math.abs(start));
        units -= out;
        const proceeds = Math.max(0, out + num(f.closedPnl));
        if (out > 1e-9) {
          ops.push({
            externalId: `fill:${f.tid}`, type: "SELL", day, quantity: round(out), price: round(proceeds / out),
            fee: round(fee * (closing / sz), 6), note: `${f.dir} ${coin} ${round(closing, 6)} @ ${f.px}`
          });
        }
      }
      if (opening > 0) {
        const inUnits = (num(f.px) * opening) / leverage;
        units += inUnits;
        ops.push({
          externalId: closing > 0 ? `fill:${f.tid}:open` : `fill:${f.tid}`, type: "BUY", day, quantity: round(inUnits), price: 1,
          fee: round(fee * (opening / sz), 6), note: `${f.dir} ${coin} ${round(opening, 6)} @ ${f.px} · ${leverage}x`
        });
      }
    }

    const fresh = ops.filter((o) => !known.has(o.externalId));
    if (fresh.length) {
      await prisma.$transaction(async (tx: any) => {
        for (const o of fresh) {
          const operationId = await addOp(tx, {
            assetId, type: o.type, kind: o.type === "BUY" ? "buy" : "sell", day: o.day, quantity: o.quantity,
            priceLocal: o.price, feeLocal: o.fee, fxToEur: await fxOn("USD", o.day), groupId: randomUUID(), note: o.note
          });
          await tx.$executeRawUnsafe(
            `insert into external_operations (source, "externalId", "operationId", "assetId") values ($1, $2, $3, $4)`,
            SOURCE, o.externalId, operationId, assetId
          );
        }
        await recalcAsset(tx, assetId);
      }, TX_OPTIONS);
      newOperations += fresh.length;
      touched.set(assetId, fresh.map((o) => o.day).sort()[0]);
    }

    // Fees and funding, one row each (re-runs do nothing).
    const costs: Array<[string, string, number, number]> = [];
    for (const f of perpFills.filter((x) => x.coin === coin)) {
      if (f.feeToken !== "USDC") continue;
      costs.push([`fee:${f.tid}`, "fee", -num(f.fee), f.time]);
      if (num(f.builderFee)) costs.push([`builder:${f.tid}`, "builder_fee", -num(f.builderFee), f.time]);
    }
    for (const x of funding.filter((x) => x.delta.type === "funding" && x.delta.coin === coin)) {
      costs.push([`funding:${x.time}:${coin}`, "funding", num(x.delta.usdc), x.time]);
    }
    for (const [externalId, kind, amount, time] of costs) {
      newCosts += await prisma.$executeRawUnsafe(
        `insert into perp_costs (source, "externalId", "assetId", coin, kind, "amountUsd", "occurredAt")
         values ($1, $2, $3, $4, $5, $6, to_timestamp($7::double precision / 1000)) on conflict do nothing`,
        SOURCE, externalId, assetId, coin, kind, amount, time
      );
    }
  }

  // Live state and unit price (value / units) of every perp of the account.
  const today = madridToday();
  const fx = await fxOn("USD", today);
  const positions: SyncResult["positions"] = [];
  const assets: Array<{ assetId: string; coin: string }> = await prisma.$queryRawUnsafe(
    `select "assetId", coin from perp_positions where address = $1`, address
  );
  for (const { assetId, coin } of assets) {
    const p = open.get(coin);
    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    const qty = num(asset?.quantity);
    if (p) {
      const { margin, upnl, value } = positionValue(p);
      const size = num(p.szi);
      await prisma.$executeRawUnsafe(
        `update perp_positions set side = $2, size = $3, "notionalUsd" = $4, "entryPx" = $5, "markPx" = $6, leverage = $7,
                "leverageType" = $8, "liquidationPx" = $9, "marginUsd" = $10, "unrealizedPnlUsd" = $11, "valueUsd" = $12,
                "fundingSinceOpenUsd" = $13, "syncedAt" = now()
          where "assetId" = $1`,
        assetId, size > 0 ? "long" : "short", Math.abs(size), num(p.positionValue), num(p.entryPx),
        Math.abs(size) ? num(p.positionValue) / Math.abs(size) : null, p.leverage.value, p.leverage.type,
        p.liquidationPx ? num(p.liquidationPx) : null, margin, upnl, value, -num(p.cumFunding?.sinceOpen)
      );
      positions.push({ coin, side: size > 0 ? "long" : "short", valueUsd: round(value, 2) });
      if (qty > 0) {
        const unit = value / qty;
        await prisma.asset.update({
          where: { id: assetId },
          data: { marketPriceLocal: unit, marketPriceEur: unit * fx, lastPriceSyncAt: new Date() }
        });
        if (!touched.has(assetId)) touched.set(assetId, today);
      }
    } else {
      await prisma.$executeRawUnsafe(
        `update perp_positions set side = 'closed', size = 0, "notionalUsd" = 0, "marginUsd" = 0, "unrealizedPnlUsd" = 0,
                "valueUsd" = 0, "liquidationPx" = null, "syncedAt" = now() where "assetId" = $1`,
        assetId
      );
    }
  }

  if (touched.size) {
    await refreshSnapshots([...touched.keys()], [...touched.values()].sort()[0]);
    // Today's snapshot carries the live value (the nightly job writes it too, from the same unit price).
    await prisma.$executeRawUnsafe(
      `update daily_asset_snapshots s set "priceLocal" = a."marketPriceLocal", "fxToEur" = $2,
              "priceEur" = a."marketPriceLocal" * $2, "valueEur" = s.quantity * a."marketPriceLocal" * $2
         from assets a where s."assetId" = a.id and a.id = any($1::text[]) and s.date = $3::date`,
      [...touched.keys()], fx, today
    );
  }
  await prisma.$executeRawUnsafe(`update perp_accounts set "lastSyncAt" = now(), "lastError" = null where address = $1`, address);
  return { address, newOperations, newCosts, positions };
}

const running = new Map<string, Promise<SyncResult[]>>();

/** Syncs every account of the current user; concurrent calls of the same user share the run. */
export function syncHyperliquid(): Promise<SyncResult[]> {
  const user = currentUser() ?? DEFAULT_USER;
  const existing = running.get(user);
  if (existing) return existing;
  const run = (async () => {
    const accounts: Array<{ address: string; bankId: string }> = await prisma.$queryRawUnsafe(
      `select address, "bankId" from perp_accounts where source = $1`, SOURCE
    );
    const out: SyncResult[] = [];
    for (const a of accounts) {
      try {
        out.push(await syncAccount(a.address, a.bankId));
      } catch (e: any) {
        await prisma.$executeRawUnsafe(`update perp_accounts set "lastError" = $2 where address = $1`, a.address, String(e?.message ?? e));
        throw e;
      }
    }
    return out;
  })().finally(() => running.delete(user));
  running.set(user, run);
  return run;
}

export function registerHyperliquidRoutes(app: Express): void {
  app.post("/api/v2/hyperliquid/sync", handler(async (_req, res) => {
    res.json({ accounts: await syncHyperliquid() });
  }));

  // Open and closed perps with their live data and what funding and fees cost so far.
  app.get("/api/v2/perps", handler(async (_req, res) => {
    const positions = await prisma.$queryRawUnsafe(
      `select p."assetId", a.name, p.address, p.coin, p.side, p.size::float as size, p."notionalUsd"::float as "notionalUsd",
              p."entryPx"::float as "entryPx", p."markPx"::float as "markPx", p.leverage::float as leverage, p."leverageType",
              p."liquidationPx"::float as "liquidationPx", p."marginUsd"::float as "marginUsd",
              p."unrealizedPnlUsd"::float as "unrealizedPnlUsd", p."valueUsd"::float as "valueUsd",
              p."fundingSinceOpenUsd"::float as "fundingSinceOpenUsd", p."syncedAt",
              coalesce(c.fees, 0)::float as "feesUsd", coalesce(c.builder, 0)::float as "builderFeesUsd", coalesce(c.funding, 0)::float as "fundingUsd"
         from perp_positions p
         join assets a on a.id = p."assetId"
         left join lateral (
           select sum("amountUsd") filter (where kind = 'fee') as fees,
                  sum("amountUsd") filter (where kind = 'builder_fee') as builder,
                  sum("amountUsd") filter (where kind = 'funding') as funding
             from perp_costs where "assetId" = p."assetId"
         ) c on true
        order by p.side = 'closed', p."valueUsd" desc`
    );
    const accounts = await prisma.$queryRawUnsafe(`select address, "lastSyncAt", "lastError" from perp_accounts order by address`);
    res.json({ positions, accounts });
  }));

  // While the backend runs, import new fills every hour (the value itself is refreshed hourly in Supabase too).
  // If the database can't be reached (network not ready yet, Supabase pooler down for a moment), try again in
  // 2 minutes instead of waiting for the next hour, and log one short line instead of the whole Prisma message.
  let retry: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    for (const user of USERS) {
      try {
        await withUser(user, () => syncHyperliquid());
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        if (/Can't reach database server|Timed out fetching a new connection/.test(msg)) {
          console.error(`Hyperliquid sync (${user}): base de datos no disponible, se reintenta en 2 minutos`);
          if (!retry) retry = setTimeout(() => { retry = null; void tick(); }, 2 * 60_000);
          return;
        }
        console.error(`Hyperliquid sync (${user}):`, msg);
      }
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 60 * 60_000);
}

