import { Express } from "express";
import { prisma } from "./prisma";
import { handler, HttpError, num, round } from "./portfolio";

// Daily gain/loss calendar (heatmap). The gain of an asset on a day is the change of its (value - cost) plus the
// result of the sales that day: buying moves value and cost alike (no gain) and a sale moves its result from
// "open" to "realized" (no loss). Cash accounts never gain.
//
// Rows before an asset is held have quantity 0 (and may already carry its cost), so "held the day before" is
// judged by the quantity. The first day an asset is held only counts when it was really bought that day (the small price move after the
// purchase). Assets that entered the app with an opening balance carry all the gain made before; counting it on
// their first day would show a huge fake jump (e.g. 1 January 2026, when most positions were loaded).

/** `filter`: extra condition on the snapshots (alias s), e.g. to keep some assets only. */
const perAssetDay = (filter = "true") => `
  with s as (
    select s."assetId", s.date, s."valueEur" as value, s."costEur" as cost,
           lag(s."valueEur") over w as prev_value, lag(s."costEur") over w as prev_cost, lag(s.quantity) over w as prev_qty
      from daily_asset_snapshots s
      join assets a on a.id = s."assetId"
      join asset_types t on t.id = a."assetTypeId"
     where not t."isLiquidity" and ${filter}
       -- Held but without a price that day (a gap in the price history): skipped, not a 100 % loss.
       and not (s.quantity > 0 and s."valueEur" = 0)
    window w as (partition by s."assetId" order by s.date)
  ), sales as (
    select o."assetId", o."occurredAt"::date as day, sum(o."realizedPnlEur") as pnl
      from asset_operations o
     where o."operationType" = 'SELL'
     group by 1, 2
  ), buys as (
    select distinct o."assetId", o."occurredAt"::date as day
      from asset_operations o
     where o."operationType" = 'BUY' and coalesce(o.kind, 'buy') <> 'opening'
  ), pnl as (
    select s."assetId", s.date, s.value, coalesce(s.prev_value, 0) as prev_value,
           case
             when coalesce(s.prev_qty, 0) > 0
               then (s.value - s.cost) - (s.prev_value - s.prev_cost)
             when exists (select 1 from buys b where b."assetId" = s."assetId" and b.day = s.date)
               then s.value - s.cost
             else 0
           end + coalesce(sa.pnl, 0) as pnl
      from s
      left join sales sa on sa."assetId" = s."assetId" and sa.day = s.date
  )`;

/**
 * Gain of the whole portfolio per day (date -> EUR), with the rules above. The single source for every
 * "result" figure: the calendar, and the overview chart, period result, years and months (as a running total).
 */
export async function dailyPnl(assetIds: string[] | null = null): Promise<Array<{ date: string; pnl: number; value: number; prevValue: number }>> {
  const rows: Array<{ date: string; value: unknown; prevValue: unknown; pnl: unknown }> = await prisma.$queryRawUnsafe(
    `${perAssetDay(assetIds ? `s."assetId" = any($1::text[])` : "true")}
     select to_char(date, 'YYYY-MM-DD') as date, sum(value) as value, sum(prev_value) as "prevValue", sum(pnl) as pnl
       from pnl group by date order by date`,
    ...(assetIds ? [assetIds] : [])
  );
  // The first day has nothing to compare with.
  return rows.map((r, i) => ({ date: r.date, pnl: i === 0 ? 0 : num(r.pnl), value: num(r.value), prevValue: num(r.prevValue) }));
}

/** Gain of each asset per day (same rules as dailyPnl), for per-asset results such as the monthly table. */
export async function assetDailyPnl(): Promise<Array<{ assetId: string; date: string; pnl: number }>> {
  const rows: Array<{ assetId: string; date: string; pnl: unknown }> = await prisma.$queryRawUnsafe(
    `${perAssetDay()}
     select "assetId", to_char(date, 'YYYY-MM-DD') as date, pnl from pnl where pnl <> 0 order by date`
  );
  return rows.map((r) => ({ assetId: r.assetId, date: r.date, pnl: num(r.pnl) }));
}

export function registerCalendarRoutes(app: Express): void {
  // Every day with its gain (EUR), the gain over the value of the day before (pct) and the value.
  app.get("/api/v2/calendar", handler(async (_req, res) => {
    const days = (await dailyPnl()).slice(1).map((r) => ({
      date: r.date,
      pnl: round(r.pnl, 2),
      pct: r.prevValue > 0 ? round(r.pnl / r.prevValue, 6) : null,
      value: round(r.value, 2),
    }));
    res.json({ days });
  }));

  // One day: the gain of each asset, biggest moves first.
  app.get("/api/v2/calendar/:date", handler(async (req, res) => {
    const date = String(req.params.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Fecha no valida.");
    const rows: Array<{ assetId: string; name: string; bankName: string; typeCode: string; pnl: unknown; prevValue: unknown }> =
      await prisma.$queryRawUnsafe(
        `${perAssetDay()}
         select a.id as "assetId", a.name, b.name as "bankName", t.code as "typeCode", p.pnl, p.prev_value as "prevValue"
           from pnl p
           join assets a on a.id = p."assetId"
           join banks b on b.id = a."bankId"
           join asset_types t on t.id = a."assetTypeId"
          where p.date = $1::date`,
        date
      );
    const assets = rows
      .map((r) => ({
        assetId: r.assetId, name: r.name, bankName: r.bankName, typeCode: r.typeCode, pnl: round(num(r.pnl), 2),
        pct: num(r.prevValue) > 0 ? round(num(r.pnl) / num(r.prevValue), 6) : null,
      }))
      .filter((r) => Math.abs(r.pnl) >= 0.01)
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    res.json({ date, assets });
  }));
}
