import { Express, NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { base, USERS, withUser } from "./prisma";

// Login with password (see docs/02-arquitectura.md#login).
// - Passwords: BCrypt hash in users."passwordHash" (supabase/auth.sql). Set only with `npm run set-password`.
// - Session: a JWT signed with AUTH_SECRET (back/.env), valid TOKEN_HOURS, sent as "Authorization: Bearer …".
//   The user of every request comes from the token, never from something the client can choose.
// - Brute force: at most MAX_FAILS failed attempts per IP and per user every WINDOW_MS (429 after that).

const TOKEN_HOURS = 12;
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;

type Claims = { sub: string; name: string };

function secret(): string {
  const s = process.env.AUTH_SECRET ?? "";
  if (s.length < 32) throw new Error("Falta AUTH_SECRET en back/.env (créalo con `npm run set-password`).");
  return s;
}

/** Failed attempts per key ("ip:…", "user:…"): timestamps inside the window. */
const fails = new Map<string, number[]>();
function tooMany(key: string): boolean {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  fails.set(key, list);
  return list.length >= MAX_FAILS;
}
function fail(key: string): void {
  fails.set(key, [...(fails.get(key) ?? []), Date.now()]);
}

/** Routes without a user: the login itself and the list of users for the entry screen. */
export function registerAuthRoutes(app: Express): void {
  app.get("/api/v2/users", async (_req: Request, res: Response) => {
    const users = await base.$queryRawUnsafe<any[]>(`select id, name, "passwordHash" is not null as "hasPassword" from users order by id`);
    res.json({ users });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const userId = String(req.body?.user ?? "");
      const password = String(req.body?.password ?? "");
      const keys = [`ip:${req.ip}`, `user:${userId}`];
      if (keys.some(tooMany)) {
        res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
        return;
      }
      const [row] = await base.$queryRawUnsafe<any[]>(`select id, name, "passwordHash" from users where id = $1`, userId);
      if (row && !row.passwordHash) {
        res.status(409).json({ error: "Este usuario aún no tiene contraseña. Créala en el servidor con: npm run set-password" });
        return;
      }
      // Same answer for an unknown user and a wrong password (do not reveal which users exist).
      const ok = !!row && password.length > 0 && (await bcrypt.compare(password, row.passwordHash));
      if (!ok) {
        keys.forEach(fail);
        res.status(401).json({ error: "Usuario o contraseña incorrectos." });
        return;
      }
      keys.forEach((k) => fails.delete(k));
      const claims: Claims = { sub: row.id, name: row.name };
      const token = jwt.sign(claims, secret(), { algorithm: "HS256", expiresIn: `${TOKEN_HOURS}h` });
      res.json({ token, user: { id: row.id, name: row.name } });
    } catch (error) {
      console.error("[auth] login:", (error as Error).message);
      res.status(500).json({ error: "No se pudo iniciar sesión." });
    }
  });
}

/** Every other /api route needs a valid token; the request then runs as that user (row level security). */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  try {
    const claims = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as Claims;
    if (!(USERS as readonly string[]).includes(claims.sub)) throw new Error("usuario");
    withUser(claims.sub, () => next());
  } catch {
    res.status(401).json({ error: "Sesión caducada o no válida. Vuelve a entrar." });
  }
}
