import { Express } from "express";
import { prisma } from "./prisma";
import { handler, HttpError } from "./portfolio";

// Monthly closings sheet (see supabase/closings.sql): values typed by hand, one sheet per year.
// It is deliberately independent from the tracked portfolio: nothing here touches operations or snapshots.

type CellValue = number | string;

function text(value: unknown, label: string): string {
  const parsed = String(value ?? "").trim();
  if (!parsed) throw new HttpError(400, `${label} es obligatorio.`);
  return parsed.slice(0, 80);
}

function year(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) throw new HttpError(400, "Año no valido.");
  return parsed;
}

// "1.234,56" or "1234.56" -> number; anything else non-empty is kept as a note; empty clears the cell.
function parseCell(value: unknown): CellValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const compact = raw.replace(/\s|€/g, "");
  const normalized = compact.includes(",") ? compact.replace(/\./g, "").replace(",", ".") : compact;
  const parsed = Number(normalized);
  return /^-?\d+(\.\d+)?$/.test(normalized) && Number.isFinite(parsed) ? parsed : raw.slice(0, 40);
}

async function loadSheet(y: number) {
  const sections: Array<{ id: string; name: string; position: number; inTotal: boolean; kind: string }> = await prisma.$queryRawUnsafe(
    `select id, name, position, "inTotal", kind from closing_sections where year = $1 order by position, name`,
    y
  );
  const rows: Array<{ id: string; sectionId: string; name: string; position: number; cells: Record<string, CellValue>; costs: Record<string, number>; openingValue: number | null; assetId: string | null; typeName: string | null }> =
    sections.length
      ? await prisma.$queryRawUnsafe(
          `select r.id, r."sectionId", r.name, r.position, r.cells, r.costs, r."openingValue"::float as "openingValue", r."assetId", t.name as "typeName"
             from closing_rows r join closing_sections s on s.id = r."sectionId"
             left join assets a on a.id = r."assetId"
             left join asset_types t on t.id = a."assetTypeId"
            where s.year = $1 order by r.position, r.name`,
          y
        )
      : [];
  return sections.map((s) => ({ ...s, rows: rows.filter((r) => r.sectionId === s.id) }));
}

async function nextPosition(table: "closing_sections" | "closing_rows", column: string, value: unknown): Promise<number> {
  const result: Array<{ next: number }> = await prisma.$queryRawUnsafe(
    `select coalesce(max(position) + 1, 0)::int as next from ${table} where "${column}" = $1`,
    value
  );
  return result[0]?.next ?? 0;
}

// Swaps the position with the neighbour above or below inside the same parent.
async function move(table: "closing_sections" | "closing_rows", parentColumn: string, id: string, dir: number): Promise<void> {
  const items: Array<{ id: string }> = await prisma.$queryRawUnsafe(
    `select id from ${table} where "${parentColumn}" = (select "${parentColumn}" from ${table} where id = $1) order by position, name`,
    id
  );
  const index = items.findIndex((i) => i.id === id);
  const target = index + (dir < 0 ? -1 : 1);
  if (index < 0 || target < 0 || target >= items.length) return;
  [items[index], items[target]] = [items[target], items[index]];
  await prisma.$transaction(
    items.map((item, position) => prisma.$executeRawUnsafe(`update ${table} set position = $1 where id = $2`, position, item.id))
  );
}

export function registerClosingRoutes(app: Express): void {
  app.get("/api/v2/closings", handler(async (req, res) => {
    const years: Array<{ year: number }> = await prisma.$queryRawUnsafe(
      `select distinct year from closing_sections order by year desc`
    );
    const current = new Date().getFullYear();
    const y = req.query.year ? year(req.query.year) : current;
    const all = [...new Set([current, ...years.map((r) => r.year)])].sort((a, b) => b - a);
    res.json({ year: y, years: all, sections: await loadSheet(y) });
  }));

  // Month close: every asset held today gets its value at the end of that month (from the daily snapshots),
  // grouped in one section per bank. "Liquidez" is created once with one empty row per bank, to fill by hand.
  // month 0 = opening value (31 December of the year before). Re-running a month overwrites the asset cells only.
  app.post("/api/v2/closings/close", handler(async (req, res) => {
    const y = year(req.body.year);
    const m = Number(req.body.month);
    if (!Number.isInteger(m) || m < 0 || m > 12) throw new HttpError(400, "Mes no valido.");
    const monthEnd = m === 0 ? `${y - 1}-12-31` : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
    if (monthEnd >= today) throw new HttpError(400, "Ese mes todavia no ha terminado.");

    // Value and net money put in (purchases minus what sales paid out) at the month end. The start of the year is
    // the net money put in up to 1 January, or the first purchase for assets bought later in the year.
    const assets: Array<{
      id: string; name: string; bankId: string; bankName: string;
      value: number | null; cost: number | null; startCost: number | null; openingValue: number | null;
    }> = await prisma.$queryRawUnsafe(
      `with held as (
         select "assetId" from daily_asset_snapshots
          where date = (select max(date) from daily_asset_snapshots) and quantity > 0
         union
         -- The pending-reinvestment account stays even when empty, so past months keep its balance.
         select a.id from assets a join asset_types t on t.id = a."assetTypeId" where t."isLiquidity"
       ), at_end as (
         select distinct on (s."assetId") s."assetId", s."valueEur", s."costEur", s.quantity
           from daily_asset_snapshots s join held h on h."assetId" = s."assetId"
          where s.date <= $1::date
          order by s."assetId", s.date desc
       ), at_open as (
         select distinct on (s."assetId") s."assetId", s."valueEur", s."costEur", s.quantity
           from daily_asset_snapshots s join held h on h."assetId" = s."assetId"
          where s.date <= $2::date
          order by s."assetId", s.date desc
       ), first_buy as (
         select distinct on (s."assetId") s."assetId", s.date, s."costEur"
           from daily_asset_snapshots s join held h on h."assetId" = s."assetId"
          where s.date > $2::date and s.quantity > 0
          order by s."assetId", s.date
       ), flows as (
         select o."assetId", o."occurredAt"::date as day,
                case when o."operationType" = 'BUY' then o."netEur" else -o."netEur" end as amount
           from asset_operations o join held h on h."assetId" = o."assetId"
       ), put_in as (
         select h."assetId",
                sum(f.amount) filter (where f.day <= $1::date) as at_end,
                sum(f.amount) filter (where f.day <= $2::date) as at_open,
                sum(f.amount) filter (where f.day <= fb.date) as at_first
           from held h
           left join flows f on f."assetId" = h."assetId"
           left join first_buy fb on fb."assetId" = h."assetId"
          group by h."assetId"
       ), has_ops as (
         select distinct "assetId" from asset_operations
       )
       select a.id, a.name, a."bankId", b.name as "bankName",
              -- A missing price (stored as 0) leaves the month empty instead of showing a fake drop.
              case when e.quantity > 0 and e."valueEur" > 0 then round(e."valueEur"::numeric, 2)::float end as value,
              -- Assets without operations (balances typed in directly) fall back to the snapshot cost.
              case when e.quantity > 0 and e."valueEur" > 0 then round((case when x."assetId" is null then e."costEur" else p.at_end end)::numeric, 2)::float end as cost,
              round((case when x."assetId" is null then case when o.quantity > 0 then o."costEur" else f."costEur" end
                          else case when o.quantity > 0 then p.at_open else p.at_first end end)::numeric, 2)::float as "startCost",
              case when o.quantity > 0 and o."valueEur" > 0 then round(o."valueEur"::numeric, 2)::float end as "openingValue"
         from held h
         join assets a on a.id = h."assetId"
         join banks b on b.id = a."bankId"
         left join at_end e on e."assetId" = h."assetId"
         left join at_open o on o."assetId" = h."assetId"
         left join put_in p on p."assetId" = h."assetId"
         left join first_buy f on f."assetId" = h."assetId"
         left join has_ops x on x."assetId" = h."assetId"
        order by b.name, a.name`,
      // Balances dated 1 January count as held at the start of the year.
      monthEnd, `${y}-01-01`
    );

    const sections: Array<{ id: string; kind: string; bankId: string | null }> = await prisma.$queryRawUnsafe(
      `select id, kind, "bankId" from closing_sections where year = $1`, y
    );
    const rows: Array<{ id: string; assetId: string | null }> = await prisma.$queryRawUnsafe(
      `select r.id, r."assetId" from closing_rows r join closing_sections s on s.id = r."sectionId" where s.year = $1`, y
    );

    if (!sections.some((s) => s.kind === "cash")) {
      await prisma.$executeRawUnsafe(`update closing_sections set position = position + 1 where year = $1`, y);
      const cash: Array<{ id: string }> = await prisma.$queryRawUnsafe(
        `insert into closing_sections (year, name, position, "inTotal", kind) values ($1, 'Liquidez', 0, true, 'cash') returning id`, y
      );
      await prisma.$executeRawUnsafe(
        `insert into closing_rows ("sectionId", name, position, "bankId")
         select $1, name, (row_number() over (order by name))::int - 1, id from banks order by name`,
        cash[0].id
      );
    }

    const sectionOfBank = new Map(sections.filter((s) => s.kind === "bank").map((s) => [s.bankId, s.id]));
    const rowOfAsset = new Map(rows.filter((r) => r.assetId).map((r) => [r.assetId, r.id]));
    for (const a of assets) {
      let sectionId = sectionOfBank.get(a.bankId);
      if (!sectionId) {
        const created: Array<{ id: string }> = await prisma.$queryRawUnsafe(
          `insert into closing_sections (year, name, position, "inTotal", kind, "bankId") values ($1, $2, $3, true, 'bank', $4) returning id`,
          y, a.bankName, await nextPosition("closing_sections", "year", y), a.bankId
        );
        sectionId = created[0].id;
        sectionOfBank.set(a.bankId, sectionId);
      }
      if (!rowOfAsset.has(a.id)) {
        const created: Array<{ id: string }> = await prisma.$queryRawUnsafe(
          `insert into closing_rows ("sectionId", name, position, "assetId", "bankId") values ($1, $2, $3, $4, $5) returning id`,
          sectionId, a.name, await nextPosition("closing_rows", "sectionId", sectionId), a.id, a.bankId
        );
        rowOfAsset.set(a.id, created[0].id);
      }
    }

    const key = String(m);
    const set = (column: string, k: string, v: string) =>
      `case when ${v} is null then r.${column} - '${k}' else jsonb_set(r.${column}, array['${k}'], to_jsonb(${v})) end`;
    await prisma.$executeRawUnsafe(
      `update closing_rows r
          set cells = ${set("cells", "0", "v.start")} || case when v.val is null then '{}'::jsonb else jsonb_build_object($1::text, v.val) end,
              costs = ${set("costs", "0", "v.start")} || case when v.cost is null then '{}'::jsonb else jsonb_build_object($1::text, v.cost) end,
              "openingValue" = v.opening
         from jsonb_to_recordset($2::jsonb) as v(id text, val numeric, cost numeric, start numeric, opening numeric)
        where r.id = v.id`,
      key,
      JSON.stringify(assets.map((a) => ({ id: rowOfAsset.get(a.id), val: a.value, cost: a.cost, start: a.startCost, opening: a.openingValue })))
    );
    if (m > 0) {
      // A month without the asset clears any old value there.
      const gone = assets.filter((a) => a.value === null).map((a) => rowOfAsset.get(a.id));
      if (gone.length) {
        await prisma.$executeRawUnsafe(
          `update closing_rows set cells = cells - $1, costs = costs - $1 where id = any($2::text[])`, key, gone
        );
      }
    }
    // Inside each bank: funds first, then stocks and the rest, each from the biggest position to the smallest.
    await prisma.$executeRawUnsafe(
      `with ranked as (
         select r.id, row_number() over (
                  partition by r."sectionId"
                  order by case t.code when 'FUND' then 0 when 'STOCK' then 1 when 'ETF' then 2 when 'CRYPTO' then 3
                                       when 'REAL_ESTATE' then 4 when 'METAL' then 5 else 9 end,
                           coalesce(a.quantity * a."marketPriceEur", 0) desc, r.name
                ) - 1 as pos
           from closing_rows r
           join closing_sections s on s.id = r."sectionId"
           left join assets a on a.id = r."assetId"
           left join asset_types t on t.id = a."assetTypeId"
          where s.year = $1 and s.kind = 'bank'
       )
       update closing_rows r set position = ranked.pos from ranked where r.id = ranked.id`,
      y
    );
    res.json({ assets: assets.filter((a) => a.value !== null).length, monthEnd });
  }));

  app.post("/api/v2/closings/sections", handler(async (req, res) => {
    const y = year(req.body.year);
    const position = await nextPosition("closing_sections", "year", y);
    await prisma.$executeRawUnsafe(
      `insert into closing_sections (year, name, position, "inTotal") values ($1, $2, $3, $4)`,
      y, text(req.body.name, "El nombre"), position, req.body.inTotal !== false
    );
    res.status(201).json({ ok: true });
  }));

  app.patch("/api/v2/closings/sections/:id", handler(async (req, res) => {
    if (req.body.move) await move("closing_sections", "year", String(req.params.id), Number(req.body.move));
    if (req.body.name !== undefined) {
      await prisma.$executeRawUnsafe(`update closing_sections set name = $1 where id = $2`, text(req.body.name, "El nombre"), req.params.id);
    }
    if (req.body.inTotal !== undefined) {
      await prisma.$executeRawUnsafe(`update closing_sections set "inTotal" = $1 where id = $2`, !!req.body.inTotal, req.params.id);
    }
    res.json({ ok: true });
  }));

  app.delete("/api/v2/closings/sections/:id", handler(async (req, res) => {
    await prisma.$executeRawUnsafe(`delete from closing_sections where id = $1`, req.params.id);
    res.json({ ok: true });
  }));

  app.post("/api/v2/closings/rows", handler(async (req, res) => {
    const sectionId = text(req.body.sectionId, "La sección");
    const position = await nextPosition("closing_rows", "sectionId", sectionId);
    const created: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `insert into closing_rows ("sectionId", name, position) values ($1, $2, $3) returning id`,
      sectionId, text(req.body.name, "El nombre"), position
    );
    res.status(201).json({ id: created[0].id });
  }));

  // Body: { name } | { move: -1|1 } | { cell: "0".."12", value }
  app.patch("/api/v2/closings/rows/:id", handler(async (req, res) => {
    const id = String(req.params.id);
    if (req.body.move) await move("closing_rows", "sectionId", id, Number(req.body.move));
    if (req.body.name !== undefined) {
      await prisma.$executeRawUnsafe(`update closing_rows set name = $1 where id = $2`, text(req.body.name, "El nombre"), id);
    }
    if (req.body.cell !== undefined) {
      const key = String(req.body.cell);
      if (!/^(\d|1[0-2])$/.test(key)) throw new HttpError(400, "Mes no valido.");
      const value = parseCell(req.body.value);
      await prisma.$executeRawUnsafe(
        value === null
          ? `update closing_rows set cells = cells - $1 where id = $2`
          : `update closing_rows set cells = jsonb_set(cells, array[$1], $3::jsonb) where id = $2`,
        ...(value === null ? [key, id] : [key, id, JSON.stringify(value)])
      );
    }
    res.json({ ok: true });
  }));

  app.delete("/api/v2/closings/rows/:id", handler(async (req, res) => {
    await prisma.$executeRawUnsafe(`delete from closing_rows where id = $1`, req.params.id);
    res.json({ ok: true });
  }));
}
