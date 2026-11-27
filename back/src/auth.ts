import { Express, NextFunction, Request, Response } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { base, USERS, withUser } from "./prisma";

// Login with password (see docs/02-arquitectura.md#login).
// - Passwords: BCrypt hash in users."passwordHash" (supabase/auth.sql). The owner's users get theirs with
//   `npm run set-password`; other people register themselves (below) and start with an empty portfolio.
// - Login with the user name (users.username; for user1/user2 it is the id unless changed). The list of users is
//   never sent to the browser.
// - Session: a JWT signed with AUTH_SECRET (back/.env), valid TOKEN_HOURS, sent as "Authorization: Bearer …".
//   The user of every request comes from the token, never from something the client can choose.
// - Brute force: at most MAX_FAILS failed attempts per IP and per user every WINDOW_MS (429 after that).
// - Registration: only with REGISTER_CODE (a word the owner tells in person) and at most REGISTER_MAX accounts
//   (default 5). Without REGISTER_CODE it is closed.

const TOKEN_HOURS = 12;
const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const MIN_PASSWORD = 12;
/** Ids of self-registered users. */
const REGISTERED_ID = /^u_[0-9a-f]{16}$/;
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,29}$/;

type Claims = { sub: string; name: string };

function secret(): string {
  const s = process.env.AUTH_SECRET ?? "";
  if (s.length < 32) throw new Error("Falta AUTH_SECRET en back/.env (créalo con `npm run set-password`).");
  return s;
}

const registerCode = (): string => process.env.REGISTER_CODE?.trim() ?? "";
const registerMax = (): number => {
  const n = Number(process.env.REGISTER_MAX ?? 5);
  return Number.isInteger(n) && n >= 0 ? n : 5;
};

/** Same time whatever the input (no hint of how many characters were right). */
function sameText(a: string, b: string): boolean {
  const h = (s: string) => crypto.createHash("sha256").update(s).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

/** Failed attempts per key ("ip:…", "user:…", "register:…"): timestamps inside the window. */
const fails = new Map<string, number[]>();
function tooMany(key: string): boolean {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) fails.set(key, list);
  else fails.delete(key);
  return list.length >= MAX_FAILS;
}
function fail(key: string): void {
  fails.set(key, [...(fails.get(key) ?? []), Date.now()]);
}

function tokenFor(row: { id: string; name: string }) {
  const claims: Claims = { sub: row.id, name: row.name };
  return { token: jwt.sign(claims, secret(), { algorithm: "HS256", expiresIn: `${TOKEN_HOURS}h` }), user: { id: row.id, name: row.name } };
}

class UserError extends Error {}

async function registrationState(): Promise<{ open: boolean; left?: number }> {
  if (registerCode().length < 6) return { open: false };
  const [{ n }] = await base.$queryRawUnsafe<any[]>(`select count(*)::int as n from users where "registeredAt" is not null`);
  const left = Math.max(0, registerMax() - n);
  return { open: left > 0, left };
}

/** Routes without a user: login, registration and whether registration is open. */
export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/register", async (_req: Request, res: Response) => {
    try {
      res.json(await registrationState());
    } catch {
      res.json({ open: false });
    }
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const username = String(req.body?.user ?? "").trim().toLowerCase().slice(0, 60);
      const password = String(req.body?.password ?? "").slice(0, 200);
      const keys = [`ip:${req.ip}`, `user:${username}`];
      if (keys.some(tooMany)) {
        res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
        return;
      }
      const [row] = await base.$queryRawUnsafe<any[]>(
        `select id, name, "passwordHash" from users where lower(coalesce(username, id)) = $1 and id <> 'demo'`, username
      );
      // Same answer for an unknown user, a user without password and a wrong password (do not reveal which exist).
      const ok = !!row?.passwordHash && password.length > 0 && (await bcrypt.compare(password, row.passwordHash));
      if (!ok) {
        keys.forEach(fail);
        res.status(401).json({ error: "Usuario o contraseña incorrectos." });
        return;
      }
      keys.forEach((k) => fails.delete(k));
      res.json(tokenFor(row));
    } catch (error) {
      console.error("[auth] login:", (error as Error).message);
      res.status(500).json({ error: "No se pudo iniciar sesión." });
    }
  });

  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const ipKey = `register:${req.ip}`;
      if (tooMany(ipKey)) {
        res.status(429).json({ error: "Demasiados intentos. Espera 15 minutos." });
        return;
      }
      const state = await registrationState();
      if (!state.open) {
        res.status(403).json({ error: "El registro está cerrado." });
        return;
      }
      const code = String(req.body?.code ?? "").trim().slice(0, 200);
      const username = String(req.body?.user ?? "").trim().toLowerCase();
      const name = String(req.body?.name ?? "").trim().replace(/\s+/g, " ");
      const password = String(req.body?.password ?? "");
      if (!sameText(code, registerCode())) {
        fail(ipKey);
        res.status(403).json({ error: "El código de registro no es correcto." });
        return;
      }
      if (!USERNAME.test(username)) throw new UserError("El usuario: de 3 a 30 letras minúsculas, números, punto, guion o guion bajo.");
      if (name.length < 1 || name.length > 40) throw new UserError("El nombre: de 1 a 40 caracteres.");
      if (password.length < MIN_PASSWORD || password.length > 200) throw new UserError(`La contraseña: mínimo ${MIN_PASSWORD} caracteres.`);
      if (password.toLowerCase().includes(username)) throw new UserError("La contraseña no puede contener el usuario.");
      const hash = await bcrypt.hash(password, 12);
      const id = `u_${crypto.randomBytes(8).toString("hex")}`;
      // One registration at a time (advisory lock), so two at once cannot pass the limit.
      const created = await base.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`select pg_advisory_xact_lock(hashtext('finanzas.register'))`);
        const [{ n }] = await tx.$queryRawUnsafe<any[]>(`select count(*)::int as n from users where "registeredAt" is not null`);
        if (n >= registerMax()) return "full";
        const [taken] = await tx.$queryRawUnsafe<any[]>(`select 1 from users where lower(coalesce(username, id)) = $1`, username);
        if (taken) return "taken";
        await tx.$executeRawUnsafe(
          `insert into users (id, name, username, "passwordHash", "registeredAt") values ($1, $2, $3, $4, now())`, id, name, username, hash
        );
        return "ok";
      });
      if (created === "full") {
        res.status(403).json({ error: "El registro está cerrado: ya no quedan plazas." });
        return;
      }
      if (created === "taken") throw new UserError("Ese usuario ya existe: elige otro.");
      fails.delete(ipKey);
      knownUsers.set(id, Date.now());
      console.log(`[auth] registro: nuevo usuario ${id}`);
      res.status(201).json(tokenFor({ id, name }));
    } catch (error) {
      if (error instanceof UserError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error("[auth] registro:", (error as Error).message);
      res.status(500).json({ error: "No se pudo crear la cuenta." });
    }
  });
}

/** Self-registered users that exist (checked in the database at most once a minute each). */
const knownUsers = new Map<string, number>();
async function registeredUserExists(id: string): Promise<boolean> {
  const seen = knownUsers.get(id);
  if (seen && Date.now() - seen < 60_000) return true;
  const [row] = await base.$queryRawUnsafe<any[]>(`select 1 from users where id = $1 and "registeredAt" is not null`, id);
  if (row) knownUsers.set(id, Date.now());
  else knownUsers.delete(id);
  return !!row;
}

/** Every other /api route needs a valid token; the request then runs as that user (row level security). */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const deny = () => void res.status(401).json({ error: "Sesión caducada o no válida. Vuelve a entrar." });
  let claims: Claims;
  try {
    claims = jwt.verify(token, secret(), { algorithms: ["HS256"] }) as Claims;
  } catch {
    return deny();
  }
  // The owner's users (fixed list). "demo" has no password and never logs in.
  if ((USERS as readonly string[]).includes(claims.sub) && claims.sub !== "demo") {
    withUser(claims.sub, () => next());
    return;
  }
  if (typeof claims.sub !== "string" || !REGISTERED_ID.test(claims.sub)) return deny();
  registeredUserExists(claims.sub).then(
    (ok) => (ok ? withUser(claims.sub, () => next()) : deny()),
    () => void res.status(503).json({ error: "Base de datos no disponible. Prueba en un momento." })
  );
}
