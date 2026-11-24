import { Express } from "express";
import { prisma } from "./prisma";
import { handler, HttpError } from "./portfolio";

// Investor risk profile (see supabase/risk-profile.sql). The questionnaire and the scoring live in the front
// (features/risk-profile/risk-questions.ts); the back keeps each result of the user, with its history.

const PROFILES = ["conservador", "moderado", "equilibrado", "dinamico", "agresivo"];
const pct = (v: unknown) => Math.max(0, Math.min(100, Math.round(Number(v))));

export function registerRiskProfileRoutes(app: Express): void {
  // Latest result and the history (newest first).
  app.get("/api/v2/risk-profile", handler(async (_req, res) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, answers, capacity, tolerance, knowledge, score, profile, "createdAt"
         from risk_profiles order by "createdAt" desc limit 20`
    );
    res.json({ latest: rows[0] ?? null, history: rows });
  }));

  app.post("/api/v2/risk-profile", handler(async (req, res) => {
    const b = req.body ?? {};
    if (!b.answers || typeof b.answers !== "object") throw new HttpError(400, "Faltan las respuestas.");
    if (!PROFILES.includes(String(b.profile))) throw new HttpError(400, "Perfil no válido.");
    const [row] = await prisma.$queryRawUnsafe<any[]>(
      `insert into risk_profiles (answers, capacity, tolerance, knowledge, score, profile)
       values ($1::jsonb, $2, $3, $4, $5, $6) returning id, "createdAt"`,
      JSON.stringify(b.answers), pct(b.capacity), pct(b.tolerance), pct(b.knowledge), pct(b.score), String(b.profile)
    );
    res.json(row);
  }));
}
