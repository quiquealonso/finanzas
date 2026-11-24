import { Express } from "express";
import { prisma } from "./prisma";
import { handler } from "./portfolio";

// Magic Formula screen (see supabase/magic-formula.sql). Runs are written by back/scripts/magic-formula.js
// from the weekly Thursday task; the app only reads them.

export function registerMagicFormulaRoutes(app: Express): void {
  // ?run=<id> picks an older run; by default the newest. Also returns the previous run's symbols, to mark new entries.
  app.get("/api/v2/magic-formula", handler(async (req, res) => {
    const runs: Array<{ id: string; runDate: string; minCapUsd: number; universe: number; period: string }> = await prisma.$queryRawUnsafe(
      `select id, to_char("runDate", 'YYYY-MM-DD') as "runDate", "minCapUsd"::float as "minCapUsd", universe, period
         from magic_formula_runs order by "runDate" desc limit 26`
    );
    const index = Math.max(0, runs.findIndex((r) => r.id === req.query.run));
    const run = runs[index] ?? null;
    if (!run) {
      res.json({ run: null, runs: [], picks: [], previous: [] });
      return;
    }
    const picks = await prisma.$queryRawUnsafe(
      `select rank, symbol, name, sector, industry, "marketCapUsd"::float as "marketCapUsd", "priceUsd"::float as "priceUsd",
              "ebitUsd"::float as "ebitUsd", "evUsd"::float as "evUsd", "earningsYield"::float as "earningsYield", roc::float as roc,
              "rankEy", "rankRoc", "annualOnly"
         from magic_formula_picks where "runId" = $1 order by rank`,
      run.id
    );
    const prev = runs[index + 1];
    const previous: Array<{ symbol: string }> = prev
      ? await prisma.$queryRawUnsafe(`select symbol from magic_formula_picks where "runId" = $1`, prev.id)
      : [];
    res.json({ run, runs: runs.map((r) => ({ id: r.id, runDate: r.runDate })), picks, previous: prev ? previous.map((p) => p.symbol) : null });
  }));
}
