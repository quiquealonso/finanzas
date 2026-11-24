import "dotenv/config";
import { AsyncLocalStorage } from "async_hooks";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Multi-user access. Every table with personal data has a "userId" (or hangs from a table that has one) and
 * Postgres row level security (back/supabase/users.sql) only shows the rows of the user in `app.user_id` to the
 * role `finanzas_app`. So the queries of the app need no user filter of their own:
 *
 *   - Each HTTP request runs inside `withUser(<user of the session token>)` (see auth.ts → requireUser).
 *   - `prisma` (exported below) runs every query of that context in a short transaction that first sets
 *     `app.user_id` and switches to `finanzas_app`. New rows get the user from the column default.
 *   - Outside any user context (nightly jobs, scripts) it is the plain client: the database owner, which sees
 *     every user (prices are shared: one sync updates the assets of everybody).
 *
 * Interactive transactions (`prisma.$transaction(async (tx) => ...)`) are scoped the same way, and batch ones
 * (`prisma.$transaction([...])`) get the scope as their first statement.
 */

/**
 * Prisma 7 talks to Postgres through the `pg` driver (driver adapter). It uses DIRECT_URL: the Supabase pooler in
 * SESSION mode (port 5432). In transaction mode (DATABASE_URL, port 6543) Prisma 7 + pg hang after a few queries
 * (tested 2026-11-24), so the app no longer uses it. Session mode allows 15 connections on the free plan: the app
 * keeps at most 8 and the scripts 3 (scripts/prisma-client.js). Options only the old engine understood
 * (pgbouncer=true…) are dropped.
 */
export function createClient(url = process.env.DIRECT_URL || process.env.DATABASE_URL): PrismaClient {
  // Without a URL (CI, tests) the client is created but never connects.
  const u = new URL(url || "postgresql://localhost/none");
  for (const option of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) u.searchParams.delete(option);
  // Supabase: TLS, like the old engine (sslmode=prefer, certificate not checked).
  const adapter = new PrismaPg({ connectionString: u.toString(), ssl: url ? { rejectUnauthorized: false } : false, max: 8, idleTimeoutMillis: 10_000 });
  // Prisma 7 runs batch $transaction([...]) as an interactive one, with a 5 s limit by default: the heavy reports
  // (Mensual, Calendario) need more.
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 60_000 } });
}

export const base = createClient();

/**
 * Raw query on shared tables (no user), with exact doubles: Sentimiento, Valoraciones and the fund finder read their
 * ratios and returns through it. In a short transaction because only a transaction-local extra_float_digits gets
 * through the Supabase pooler (see scopeSql below).
 */
export function sharedQuery<T = any>(sql: string, ...args: unknown[]): Promise<T[]> {
  return base
    .$transaction([base.$executeRawUnsafe(`select set_config('extra_float_digits', '3', true)`), base.$queryRawUnsafe<T[]>(sql, ...args)])
    .then((r) => r[1] as T[]);
}

const context = new AsyncLocalStorage<{ userId: string }>();

export const USERS = ["user1", "user2"] as const;
export const DEFAULT_USER = "user1";

/** Runs `fn` as `userId`: every query inside only sees that user's data. */
export function withUser<T>(userId: string, fn: () => T): T {
  return context.run({ userId }, fn);
}

export function currentUser(): string | null {
  return context.getStore()?.userId ?? null;
}

const RAW = Symbol("raw prisma promise");
// extra_float_digits: the Supabase pooler sets it to 0 (15 significant digits for double precision); 3 gives back the
// exact value, as Prisma 6 did with its binary protocol. Only a transaction-local setting gets through the pooler.
const scopeSql = `select set_config('app.user_id', $1, true), set_config('role', 'finanzas_app', true), set_config('extra_float_digits', '3', true)`;
const scope = (client: any, userId: string) => client.$executeRawUnsafe(scopeSql, userId);

/** A lazy query: runs scoped when awaited, and can still go into a batch $transaction as the raw query. */
function scoped(raw: any, userId: string): any {
  let running: Promise<any> | null = null;
  const run = () => (running ??= base.$transaction([scope(base, userId), raw]).then((r: any[]) => r[1]));
  return {
    [RAW]: raw,
    then: (ok: any, ko: any) => run().then(ok, ko),
    catch: (ko: any) => run().catch(ko),
    finally: (f: any) => run().finally(f),
  };
}

function scopedTransaction(userId: string) {
  return (arg: any, options?: any) => {
    if (typeof arg === "function") {
      return base.$transaction(async (tx: any) => {
        await scope(tx, userId);
        return arg(tx);
      }, options);
    }
    const items = (arg as any[]).map((item) => item?.[RAW] ?? item);
    return base.$transaction([scope(base, userId), ...items], options).then((r: any[]) => r.slice(1));
  };
}

/** Model delegate (prisma.asset...) whose methods return scoped queries. */
function scopedModel(model: any, userId: string): any {
  return new Proxy(model, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== "function") return value;
      return (...args: any[]) => scoped(value.apply(target, args), userId);
    },
  });
}

export const prisma: PrismaClient = new Proxy(base, {
  get(target: any, prop) {
    const userId = context.getStore()?.userId;
    const value = target[prop];
    if (!userId) return typeof value === "function" ? value.bind(target) : value;
    if (prop === "$transaction") return scopedTransaction(userId);
    if (prop === "$queryRawUnsafe" || prop === "$executeRawUnsafe" || prop === "$queryRaw" || prop === "$executeRaw") {
      return (...args: any[]) => scoped(value.apply(target, args), userId);
    }
    if (typeof prop === "string" && !prop.startsWith("$") && value && typeof value === "object") {
      return scopedModel(value, userId);
    }
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as PrismaClient;
