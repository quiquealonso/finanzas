import { Express } from "express";
import { prisma } from "./prisma";
import { handler, HttpError } from "./portfolio";

// Target allocation (see supabase/allocation.sql). The whole plan is saved at once, replacing the previous one.

type TargetRow = { typeCode: string; assetId: string | null; name: string | null; pct: number };

function parseRows(value: unknown): TargetRow[] {
  if (!Array.isArray(value)) throw new HttpError(400, "Formato no valido.");
  return value.map((raw: any) => {
    const typeCode = String(raw?.typeCode ?? "").trim();
    const pct = Number(raw?.pct);
    if (!typeCode) throw new HttpError(400, "Falta el tipo.");
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, "Porcentaje no valido.");
    const assetId = raw?.assetId ? String(raw.assetId) : null;
    const name = !assetId && raw?.name ? String(raw.name).trim().slice(0, 60) || null : null;
    return { typeCode, assetId, name, pct };
  });
}

export function registerAllocationRoutes(app: Express): void {
  app.get("/api/v2/allocation-targets", handler(async (_req, res) => {
    res.json(await prisma.$queryRawUnsafe(
      `select "typeCode", "assetId", name, pct::float as pct from allocation_targets order by position`
    ));
  }));

  app.put("/api/v2/allocation-targets", handler(async (req, res) => {
    const rows = parseRows(req.body?.rows);
    await prisma.$transaction([
      prisma.$executeRawUnsafe(`delete from allocation_targets`),
      ...rows.map((r, position) =>
        prisma.$executeRawUnsafe(
          `insert into allocation_targets ("typeCode", "assetId", name, pct, position) values ($1, $2, $3, $4, $5)`,
          r.typeCode, r.assetId, r.name, r.pct, position
        )
      )
    ]);
    res.json({ ok: true, rows: rows.length });
  }));
}
