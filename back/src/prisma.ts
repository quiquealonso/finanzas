import { AsyncLocalStorage } from "async_hooks";
import { PrismaClient } from "@prisma/client";

/**
 * Multi-user access. Every table with personal data has a "userId" (or hangs from a table that has one) and
 * Postgres row level security (back/supabase/users.sql) only shows the rows of the user in `app.user_id` to the
 * role `finanzas_app`. So the queries of the app need no user filter of their own:
 *
 *   - Each HTTP request runs inside `withUser(<id from the x-user-id header>)` (see index.ts).
 *   - `prisma` (exported below) runs every query of that context in a short transaction that first sets
 *     `app.user_id` and switches to `finanzas_app`. New rows get the user from the column default.
 *   - Outside any user context (nightly jobs, scripts) it is the plain client: the database owner, which sees
 *     every user (prices are shared: one sync updates the assets of everybody).
 *
 * Interactive transactions (`prisma.$transaction(async (tx) => ...)`) are scoped the same way, and batch ones
 * (`prisma.$transaction([...])`) get the scope as their first statement.
 */

export const base = new PrismaClient();

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
const scopeSql = `select set_config('app.user_id', $1, true), set_config('role', 'finanzas_app', true)`;
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
