import { Express, NextFunction, Request, Response } from "express";
import { currentUser } from "./prisma";

// How this back end runs (see docs/07-despliegue.md). On the owner's computer everything is on (defaults). On the
// public server (back/deploy/.env):
//   INTEGRATIONS=off     Gmail, Open Banking and AI mail templates are off: their tokens and keys never leave the
//                        owner's computer, which keeps syncing them into the shared database.
//   BACKGROUND_JOBS=off  No timers (sentiment, valuations, wallets, Hyperliquid): the owner's computer runs them, so
//                        they do not run twice against the same database.
//   OWNER_USER=user1     The only user that can start the jobs that write shared data or spend API quota.

export const integrationsOn = (): boolean => process.env.INTEGRATIONS?.trim().toLowerCase() !== "off";
export const backgroundJobs = (): boolean => process.env.BACKGROUND_JOBS?.trim().toLowerCase() !== "off";
export const ownerUser = (): string => process.env.OWNER_USER?.trim() || "user1";

/** Routes that read the owner's Gmail or banks, or use their keys (Google, Enable Banking, Gemini). */
const INTEGRATION_ROUTES: RegExp[] = [
  /^\/api\/v2\/gmail(\/|$)/,
  /^\/api\/v2\/mail-import\/scan$/,
  /^\/api\/v2\/mail-templates\/(candidates|generate)$/,
  /^\/api\/v2\/banking\/(connect|sync)$/,
  /^\/api\/v2\/banking\/links\/[^/]+\/revoke$/,
  /^\/api\/banking\/callback$/,
];

/** Write or refresh shared data (prices, FX, sentiment, valuations) or spend quota: only the owner. */
const OWNER_ROUTES: Array<[method: string, path: RegExp]> = [
  ["POST", /^\/api\/v2\/prices\/sync$/],
  ["POST", /^\/api\/prices\/sync-month$/],
  ["POST", /^\/api\/fx-rate$/],
  ["POST", /^\/api\/v2\/sentiment\/refresh$/],
  ["POST", /^\/api\/v2\/valuations\/refresh$/],
  ["PUT", /^\/assets\/bulk-market-config$/],
];

/** Before the routes without a session (OAuth callbacks): integrations switched off on this server. */
export function integrationGuard(req: Request, res: Response, next: NextFunction): void {
  if (!integrationsOn() && INTEGRATION_ROUTES.some((r) => r.test(req.path))) {
    res.status(403).json({ error: "Desactivado en el servidor: Gmail y los bancos solo se sincronizan desde el ordenador del dueño." });
    return;
  }
  next();
}

/** After requireUser: the shared-data routes, only for the owner. */
export function ownerGuard(req: Request, res: Response, next: NextFunction): void {
  if (OWNER_ROUTES.some(([m, r]) => m === req.method && r.test(req.path)) && currentUser() !== ownerUser()) {
    res.status(403).json({ error: "Solo el dueño de la app puede lanzar esta actualización." });
    return;
  }
  next();
}

/** Who can call the API from a browser: CORS_ORIGINS (comma separated). Empty = only the local front. */
export function allowedOrigins(): string[] {
  const list = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return list.length ? list : ["http://localhost:4200", "http://127.0.0.1:4200"];
}

export function registerServerMode(app: Express): void {
  app.use(integrationGuard);
}
