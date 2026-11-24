import { Express } from "express";
import { prisma } from "./prisma";
import { handler, HttpError } from "./portfolio";

// Savings goals (see supabase/goals.sql). The viability analysis runs in the front end from the overview series;
// here we only store the goals and measure how much each asset's price moves (its volatility).

const COLUMNS = `id, name, "targetEur"::float as "targetEur", to_char("targetDate", 'YYYY-MM-DD') as "targetDate",
  "monthlyEur"::float as "monthlyEur", "startValueEur"::float as "startValueEur",
  to_char("startDate", 'YYYY-MM-DD') as "startDate", position`;

function amount(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new HttpError(400, `${label} no valido.`);
  return parsed;
}

function date(value: unknown): string {
  const raw = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw new HttpError(400, "Fecha no valida.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  if (raw <= today) throw new HttpError(400, "La fecha del objetivo tiene que ser futura.");
  return raw;
}

function name(value: unknown): string {
  const parsed = String(value ?? "").trim();
  if (!parsed) throw new HttpError(400, "El nombre es obligatorio.");
  return parsed.slice(0, 80);
}

// null/"" = use the recurring plans; 0 is a valid "no more contributions".
function monthly(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new HttpError(400, "Aportacion mensual no valida.");
  return parsed;
}

export function registerGoalRoutes(app: Express): void {
  app.get("/api/v2/goals", handler(async (_req, res) => {
    const goals = await prisma.$queryRawUnsafe(`select ${COLUMNS} from goals order by position, "targetDate"`);
    // Annualised volatility of each asset's price over the last year (daily log changes, calendar days).
    // Zero prices are gaps in the data, and jumps over ~78% in a day are bad quotes, not real moves.
    const risk = await prisma.$queryRawUnsafe(
      `with p as (
         select "assetId", "priceEur"::float as price,
                lag("priceEur"::float) over (partition by "assetId" order by date) as prev
           from daily_asset_snapshots
          where date >= current_date - 365
       ), r as (
         select "assetId", ln(price / prev) as lr from p where price > 0 and prev > 0
       )
       select "assetId", count(*)::int as days,
              coalesce(stddev_samp(lr) filter (where abs(lr) < 0.58), 0) * sqrt(365) as volatility
         from r group by "assetId"`
    );
    res.json({ goals, risk });
  }));

  app.post("/api/v2/goals", handler(async (req, res) => {
    const total: Array<{ value: number }> = await prisma.$queryRawUnsafe(
      `select coalesce(sum(quantity * "marketPriceEur"), 0)::float as value from assets where quantity > 0`
    );
    const rows = await prisma.$queryRawUnsafe(
      `insert into goals (name, "targetEur", "targetDate", "monthlyEur", "startValueEur", position)
       values ($1, $2, $3::date, $4, $5, (select coalesce(max(position) + 1, 0) from goals))
       returning ${COLUMNS}`,
      name(req.body.name), amount(req.body.targetEur, "Importe"), date(req.body.targetDate), monthly(req.body.monthlyEur),
      total[0]?.value ?? 0
    );
    res.json((rows as unknown[])[0]);
  }));

  app.patch("/api/v2/goals/:id", handler(async (req, res) => {
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (column: string, value: unknown, cast = "") => {
      values.push(value);
      sets.push(`"${column}" = $${values.length}${cast}`);
    };
    if (req.body.name !== undefined) add("name", name(req.body.name));
    if (req.body.targetEur !== undefined) add("targetEur", amount(req.body.targetEur, "Importe"));
    if (req.body.targetDate !== undefined) add("targetDate", date(req.body.targetDate), "::date");
    if (req.body.monthlyEur !== undefined) add("monthlyEur", monthly(req.body.monthlyEur));
    if (!sets.length) throw new HttpError(400, "Nada que cambiar.");
    values.push(req.params.id);
    const rows = (await prisma.$queryRawUnsafe(
      `update goals set ${sets.join(", ")} where id = $${values.length} returning ${COLUMNS}`,
      ...values
    )) as unknown[];
    if (!rows.length) throw new HttpError(404, "Objetivo no encontrado.");
    res.json(rows[0]);
  }));

  app.delete("/api/v2/goals/:id", handler(async (req, res) => {
    await prisma.$executeRawUnsafe(`delete from goals where id = $1`, req.params.id);
    res.json({ ok: true });
  }));
}
