import { Express, Request, Response } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { currentUser, DEFAULT_USER, prisma, withUser } from "./prisma";
import { handler, HttpError } from "./portfolio";

/**
 * Day-to-day banking with Open Banking (page Gastos). PSD2 obliges every EU bank to let a licensed "account
 * information" provider read balances and movements when the account holder agrees in the bank's own app. Enable
 * Banking is that provider here, free for people who only link their own accounts ("restricted" mode).
 *
 *  - Only ACCOUNT INFORMATION is ever requested: nothing here can make payments or move money.
 *  - The app never sees the bank password: the consent is given in the bank's app/web and lasts until `validUntil`
 *    (about 180 days); it can be revoked at any time (here, in the bank, or in Enable Banking's control panel).
 *  - Private key of the Enable Banking application: ~/.finanzas/enablebanking.pem (never in the repository), and its
 *    id in back/.env (EB_APP_ID). Both are put there by the user.
 *
 * Flow: connect → bank's consent screen → /api/banking/callback (with a one-time state) → session → accounts →
 * first read of the movements of this year (right away: many banks only give more than 90 days in the first hour).
 */
const API = "https://api.enablebanking.com";
const KEY_FILE = path.join(os.homedir(), ".finanzas", "enablebanking.pem");
// Enable Banking only accepts https return URLs: the bank sends the user to a small bridge page on GitHub Pages
// (front/public/banco-vuelta.html), which passes code and state on to /api/banking/callback on this computer.
const REDIRECT_URL = () => process.env.EB_REDIRECT_URL?.trim() || "https://quiquealonso.github.io/finanzas/banco-vuelta.html";
const FRONT_URL = () => process.env.FRONT_URL?.trim() || "http://localhost:4200";
const MAX_CONSENT_DAYS = 180;

export const bankingConfigured = () => !!process.env.EB_APP_ID?.trim() && fs.existsSync(KEY_FILE);

function token(): string {
  const key = fs.readFileSync(KEY_FILE, "utf8");
  return jwt.sign({ iss: "enablebanking.com", aud: "api.enablebanking.com" }, key, {
    algorithm: "RS256", keyid: process.env.EB_APP_ID!.trim(), expiresIn: 3600, header: { alg: "RS256", typ: "JWT" },
  });
}

async function eb<T = any>(method: "GET" | "POST" | "DELETE", url: string, body?: unknown): Promise<T> {
  if (!bankingConfigured()) throw new HttpError(400, "Falta configurar Enable Banking (EB_APP_ID y la clave enablebanking.pem).");
  const res = await fetch(API + url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : {};
  if (!res.ok) {
    const msg = data?.message ?? data?.error ?? `${res.status}`;
    throw new HttpError(res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : 400, `Enable Banking: ${msg}${data?.error ? ` (${data.error})` : ""}`);
  }
  return data as T;
}

// ---------------------------------------------------------------- categories

export type Category = { code: string; name: string; kind: "expense" | "income" | "internal"; color: string };
export const CATEGORIES: Category[] = [
  { code: "supermercado", name: "Supermercado", kind: "expense", color: "#16a34a" },
  { code: "restaurantes", name: "Restaurantes y bares", kind: "expense", color: "#f97316" },
  { code: "transporte", name: "Transporte y gasolina", kind: "expense", color: "#0ea5e9" },
  { code: "compras", name: "Compras", kind: "expense", color: "#a855f7" },
  { code: "ocio", name: "Ocio y viajes", kind: "expense", color: "#ec4899" },
  { code: "suscripciones", name: "Suscripciones", kind: "expense", color: "#6366f1" },
  { code: "hogar", name: "Casa y suministros", kind: "expense", color: "#14b8a6" },
  { code: "salud", name: "Salud", kind: "expense", color: "#ef4444" },
  { code: "educacion", name: "Educación", kind: "expense", color: "#eab308" },
  { code: "comisiones", name: "Comisiones e impuestos", kind: "expense", color: "#64748b" },
  { code: "efectivo", name: "Cajero", kind: "expense", color: "#78716c" },
  { code: "bizum", name: "Bizum y transferencias", kind: "expense", color: "#06b6d4" },
  { code: "otros_gastos", name: "Otros gastos", kind: "expense", color: "#94a3b8" },
  { code: "nomina", name: "Nómina", kind: "income", color: "#22c55e" },
  { code: "bizum_in", name: "Bizum y transferencias recibidas", kind: "income", color: "#2dd4bf" },
  { code: "otros_ingresos", name: "Otros ingresos", kind: "income", color: "#84cc16" },
  { code: "inversion", name: "Inversión y traspasos", kind: "internal", color: "#8b5cf6" },
];
const CATEGORY = new Map(CATEGORIES.map((c) => [c.code, c]));

/** Built-in rules (merchant names common in Spain). Checked after the user's own rules. */
const BUILTIN: Array<[RegExp, string, ("out" | "in")?]> = [
  [/N[OÓ]MINA|SALARIO|PAYROLL/, "nomina", "in"],
  [/INTERES|INTEREST|DIVIDEND|REMUNERACI[OÓ]N/, "otros_ingresos", "in"],
  [/MYINVESTOR|TRADE ?REPUBLIC|BINANCE|MINTOS|URBANITAE|WECITY|INDEXA|COINBASE|KRAKEN|NEVERLESS|SAVINGS PLAN|SAVEBACK|ROUND ?UP|BUY TRADE|SELL TRADE|TRASPASO/, "inversion"],
  [/BIZUM/, "bizum"],
  [/MERCADONA|CARREFOUR|LIDL|ALDI|\bDIA\b|EROSKI|ALCAMPO|CONSUM|HIPERCOR|AHORRAMAS|SUPERCOR|BM SUPERMERCADOS|SUPERMERCADO|CAPRABO|GADIS|FROIZ|SIMPLY|SPAR\b/, "supermercado"],
  [/NETFLIX|SPOTIFY|HBO|DISNEY|PRIME VIDEO|AMAZON PRIME|APPLE\.COM|ICLOUD|GOOGLE ?\*|YOUTUBE|DAZN|MOVISTAR ?\+|CHATGPT|OPENAI|ANTHROPIC|CLAUDE\.AI|BASIC.?FIT|ALTAFIT|MCFIT|GIMNASIO|\bGYM\b|PATREON|TWITCH/, "suscripciones"],
  [/RESTAURANTE|CAFETER|\bBAR\b|BURGER|MCDONALD|TELEPIZZA|GLOVO|JUST ?EAT|UBER ?EATS|STARBUCKS|\bKFC\b|DOMINO|MONTADITOS|\bVIPS\b|\bTGB\b|FOSTER|TABERNA|CERVECER|PIZZ|SUSHI|KEBAB|DELIVEROO|FIVE GUYS|GOIKO/, "restaurantes"],
  [/RENFE|CABIFY|\bUBER\b|\bBOLT\b|REPSOL|CEPSA|\bGALP\b|SHELL|\bBP\b|\bEMT\b|METRO DE|AUTOPISTA|PARKING|APARCAMIENTO|BLABLACAR|IRYO|OUIGO|GASOLINERA|BICIMAD|FREE ?NOW|ALSA|TAXI|PEAJE|BALLENOIL|PLENOIL/, "transporte"],
  [/AMAZON|AMZN|ALIEXPRESS|\bZARA\b|PRIMARK|DECATHLON|IKEA|MEDIA ?MARKT|CORTE INGLES|SHEIN|PULL ?& ?BEAR|BERSHKA|\bH ?& ?M\b|MANGO|LEROY|WALLAPOP|VINTED|\bFNAC\b|PCCOMPONENTES|STRADIVARIUS|LEFTIES|SPRINGFIELD|NIKE|ADIDAS|TEMU/, "compras"],
  [/ALQUILER|IBERDROLA|ENDESA|NATURGY|HOLALUZ|CANAL DE ISABEL|\bAGUA\b|MOVISTAR|VODAFONE|ORANGE|\bDIGI\b|\bO2\b|JAZZTEL|MASMOVIL|LOWI|PEPEPHONE|COMUNIDAD DE PROP|\bIBI\b|SEGURO HOGAR|FINETWORK|SIMYO/, "hogar"],
  [/FARMACIA|CLINICA|DENTAL|HOSPITAL|SANITAS|ADESLAS|\bDKV\b|OPTICA|FISIO|ASISA|MAPFRE SALUD/, "salud"],
  [/UNIVERSIDAD|MATRICULA|ACADEMIA|UDEMY|COURSERA|LIBRERIA|CASA DEL LIBRO|COLEGIO/, "educacion"],
  [/\bCINE|YELMO|CINESA|TICKETMASTER|ENTRADAS|STEAM|PLAYSTATION|NINTENDO|BOOKING|AIRBNB|RYANAIR|VUELING|IBERIA|\bHOTEL|EASYJET|EXPEDIA|TEATRO|CONCIERTO|MUSEO/, "ocio"],
  [/COMISI[OÓ]N|IMPUESTO|\bAEAT\b|HACIENDA|\bTASA\b|MULTA|\bDGT\b|SEGURIDAD SOCIAL|CUOTA TARJETA|INTERESES DEUDORES/, "comisiones"],
  [/CAJERO|REINTEGRO|RETIRADA EFECTIVO|DISPOSICI[OÓ]N EFECTIVO|\bATM\b/, "efectivo"],
];

type Rule = { pattern: string; category: string; internal: boolean };

/** Category of a movement: the user's rules first, then a transfer to one of the user's own accounts, then the built-in ones. */
export function classify(t: { amount: number; description: string; counterparty: string | null; counterpartyIban: string | null },
                  rules: Rule[], ownIbans: Set<string>): { category: string; internal: boolean; source: string } {
  const text = `${t.description} ${t.counterparty ?? ""}`.toUpperCase();
  for (const r of rules) if (text.includes(r.pattern.toUpperCase())) return { category: r.category, internal: r.internal, source: "learned" };
  if (t.counterpartyIban && ownIbans.has(t.counterpartyIban.replace(/\s/g, ""))) return { category: "inversion", internal: true, source: "rule" };
  for (const [re, code, only] of BUILTIN) {
    if (only === "in" && t.amount <= 0) continue;
    if (only === "out" && t.amount >= 0) continue;
    if (!re.test(text)) continue;
    if (code === "bizum" && t.amount > 0) return { category: "bizum_in", internal: false, source: "rule" };
    return { category: code, internal: CATEGORY.get(code)?.kind === "internal", source: "rule" };
  }
  return { category: t.amount > 0 ? "otros_ingresos" : "otros_gastos", internal: false, source: "default" };
}

async function rulesAndIbans(): Promise<{ rules: Rule[]; own: Set<string> }> {
  const rules = await prisma.$queryRawUnsafe<Rule[]>(`select pattern, category, internal from spend_rules order by length(pattern) desc`);
  const ibans = await prisma.$queryRawUnsafe<Array<{ iban: string }>>(`select iban from bank_accounts where iban is not null`);
  return { rules, own: new Set(ibans.map((r) => r.iban.replace(/\s/g, ""))) };
}

/** (Re)classifies the movements not set by hand (all, or the ones without category). */
async function classifyAll(onlyNew: boolean): Promise<number> {
  const { rules, own } = await rulesAndIbans();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; amount: unknown; description: string; counterparty: string | null; counterpartyIban: string | null }>>(
    `select id, amount, description, counterparty, "counterpartyIban" from bank_transactions
      where ${onlyNew ? "category is null" : `coalesce("categorySource", '') <> 'user'`}`
  );
  for (const r of rows) {
    const c = classify({ ...r, amount: Number(r.amount) }, rules, own);
    await prisma.$executeRawUnsafe(`update bank_transactions set category = $2, internal = $3, "categorySource" = $4 where id = $1`, r.id, c.category, c.internal, c.source);
  }
  return rows.length;
}

// ---------------------------------------------------------------- sync

type EbAccount = { uid: string; account_id?: { iban?: string }; name?: string; details?: string; product?: string; currency?: string; identification_hash?: string };
type EbTx = {
  entry_reference?: string | null; transaction_amount: { amount: string; currency: string }; credit_debit_indicator: "CRDT" | "DBIT";
  status?: string; booking_date?: string; value_date?: string; transaction_date?: string;
  creditor?: { name?: string } | null; debtor?: { name?: string } | null;
  creditor_account?: { iban?: string } | null; debtor_account?: { iban?: string } | null;
  remittance_information?: string[] | null; merchant_category_code?: string | null; note?: string | null;
};

const yearStart = () => `${new Date().getFullYear()}-01-01`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Saves the accounts of a new consent (an account already known keeps its movements: only its uid changes). */
async function saveAccounts(linkId: string, accounts: EbAccount[]): Promise<void> {
  for (const a of accounts) {
    const iban = a.account_id?.iban?.replace(/\s/g, "") ?? null;
    const accountKey = iban ?? a.identification_hash ?? a.uid;
    const name = a.name || a.product || a.details || (iban ? `Cuenta ···${iban.slice(-4)}` : "Cuenta");
    await prisma.$executeRawUnsafe(
      `insert into bank_accounts ("linkId", uid, "accountKey", name, iban, currency) values ($1, $2, $3, $4, $5, $6)
       on conflict ("userId", "accountKey") do update set "linkId" = excluded."linkId", uid = excluded.uid, name = excluded.name`,
      linkId, a.uid, accountKey, name, iban, a.currency ?? "EUR"
    );
  }
}

const BALANCE_ORDER = ["CLAV", "ITAV", "XPCD", "ITBD", "CLBD", "OPAV"];

/** Reads balances and booked movements of every account of the active consents. `first`: the long first read. */
async function syncLinks(linkIds?: string[], first = false): Promise<{ added: number; accounts: number; errors: string[] }> {
  const links = await prisma.$queryRawUnsafe<Array<{ id: string; aspsp: string; validUntil: Date }>>(
    `select id, aspsp, "validUntil" from bank_links where status = 'active' ${linkIds ? "and id = any($1::text[])" : ""}`, ...(linkIds ? [linkIds] : [])
  );
  let added = 0, accounts = 0;
  const errors: string[] = [];
  for (const link of links) {
    if (new Date(link.validUntil) < new Date()) {
      await prisma.$executeRawUnsafe(`update bank_links set status = 'expired' where id = $1`, link.id);
      errors.push(`${link.aspsp}: el permiso ha caducado; vuelve a conectar.`);
      continue;
    }
    try {
      const accs = await prisma.$queryRawUnsafe<Array<{ id: string; uid: string; accountKey: string }>>(
        `select id, uid, "accountKey" from bank_accounts where "linkId" = $1`, link.id);
      for (const acc of accs) {
        accounts++;
        // Balance: the "available" one when the bank gives it.
        const bal = await eb<{ balances: Array<{ balance_amount: { amount: string; currency: string }; balance_type: string }> }>("GET", `/accounts/${acc.uid}/balances`);
        const best = [...bal.balances].sort((a, b) => rank(a.balance_type) - rank(b.balance_type))[0];
        if (best) await prisma.$executeRawUnsafe(`update bank_accounts set balance = $2, currency = $3, "balanceAt" = now() where id = $1`, acc.id, Number(best.balance_amount.amount), best.balance_amount.currency);
        // Movements: this year on the first read; then from a week before the last one saved.
        const [last] = await prisma.$queryRawUnsafe<Array<{ d: Date | null }>>(`select max("bookingDate") as d from bank_transactions where "accountId" = $1`, acc.id);
        const from = last?.d && !first ? day(new Date(new Date(last.d).getTime() - 7 * 86_400_000)) : yearStart();
        const seen = new Map<string, number>();
        let continuation: string | null = null;
        do {
          const q = new URLSearchParams({ date_from: from, transaction_status: "BOOK", strategy: first ? "longest" : "default" });
          if (continuation) q.set("continuation_key", continuation);
          const page = await eb<{ transactions: EbTx[]; continuation_key?: string | null }>("GET", `/accounts/${acc.uid}/transactions?${q}`);
          for (const t of page.transactions ?? []) added += await saveTx(acc, t, seen);
          continuation = page.continuation_key ?? null;
        } while (continuation);
      }
      await prisma.$executeRawUnsafe(`update bank_links set "lastSyncAt" = now(), "lastError" = null where id = $1`, link.id);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await prisma.$executeRawUnsafe(`update bank_links set "lastError" = $2 where id = $1`, link.id, msg);
      errors.push(`${link.aspsp}: ${msg}`);
    }
  }
  await classifyAll(true);
  return { added, accounts, errors };
}
const rank = (type: string) => { const i = BALANCE_ORDER.indexOf(type); return i < 0 ? 99 : i; };

/** One movement; returns 1 when it is new. Same day, amount and text twice (two coffees) are told apart by order. */
async function saveTx(acc: { id: string; accountKey: string }, t: EbTx, seen: Map<string, number>): Promise<number> {
  const date = t.booking_date ?? t.value_date ?? t.transaction_date;
  if (!date) return 0;
  const sign = t.credit_debit_indicator === "DBIT" ? -1 : 1;
  const amount = sign * Math.abs(Number(t.transaction_amount.amount));
  const out = sign < 0;
  const counterparty = (out ? t.creditor?.name : t.debtor?.name) ?? null;
  const counterpartyIban = ((out ? t.creditor_account?.iban : t.debtor_account?.iban) ?? null)?.replace(/\s/g, "") ?? null;
  const description = (t.remittance_information ?? []).join(" ").replace(/\s+/g, " ").trim() || counterparty || t.note || "";
  let key: string;
  if (t.entry_reference) key = `${acc.accountKey}|e|${t.entry_reference}`;
  else {
    const base = createHash("sha1").update(`${date}|${amount}|${description}|${counterparty ?? ""}`).digest("hex").slice(0, 20);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    key = `${acc.accountKey}|h|${base}|${n}`;
  }
  const r = await prisma.$executeRawUnsafe(
    `insert into bank_transactions ("accountId", key, "bookingDate", amount, currency, description, counterparty, "counterpartyIban", mcc, status)
     values ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, 'BOOK') on conflict ("userId", key) do nothing`,
    acc.id, key, date, amount, t.transaction_amount.currency, description, counterparty, counterpartyIban, t.merchant_category_code ?? null
  );
  return Number(r);
}

// ---------------------------------------------------------------- routes

// One-time states of the bank consent: state -> app user (the bank's redirect comes without our token).
const pending = new Map<string, { user: string; at: number; aspsp: string; country: string }>();

/** The bank's redirect after the consent (no token): register before the user middleware. */
export function registerBankingCallback(app: Express): void {
  app.get("/api/banking/callback", async (req: Request, res: Response) => {
    const page = (title: string, text: string, ok = false) =>
      res.send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px;background:#111;color:#eee;max-width:640px">
        <h2>${title}</h2><p>${text}</p><p><a style="color:#a5b4fc" href="${FRONT_URL()}/gastos">${ok ? "Ver mis gastos" : "Volver a la app"}</a></p></body>`);
    const state = String(req.query.state ?? "");
    const p = pending.get(state);
    pending.delete(state);
    if (!p || Date.now() - p.at > 30 * 60_000) return void page("Enlace caducado", "Vuelve a pulsar «Conectar» en la página Gastos.");
    if (req.query.error) return void page("No conectado", `El banco no ha dado el permiso: ${escapeHtml(String(req.query.error_description ?? req.query.error))}.`);
    try {
      const s = await eb<{ session_id: string; accounts: EbAccount[]; access?: { valid_until?: string } }>("POST", "/sessions", { code: String(req.query.code ?? "") });
      const result = await withUser(p.user, async () => {
        const validUntil = s.access?.valid_until ?? new Date(Date.now() + 90 * 86_400_000).toISOString();
        const [link] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `insert into bank_links (aspsp, country, "sessionId", "validUntil") values ($1, $2, $3, $4::timestamptz) returning id`,
          p.aspsp, p.country, s.session_id, validUntil
        );
        // An older consent of the same bank and country is replaced by this one (Trade Republic ES and DE are two).
        await prisma.$executeRawUnsafe(`update bank_links set status = 'replaced' where aspsp = $1 and country = $2 and id <> $3 and status = 'active'`, p.aspsp, p.country, link.id);
        await saveAccounts(link.id, s.accounts ?? []);
        return syncLinks([link.id], true);
      });
      const errs = result.errors.length ? `<br>Avisos: ${escapeHtml(result.errors.join(" · "))}` : "";
      page(`${escapeHtml(p.aspsp)} conectado`, `${result.accounts} cuenta(s) y ${result.added} movimientos de este año leídos (solo lectura).${errs}`, true);
    } catch (e: any) {
      page("No se pudo conectar", escapeHtml(String(e?.message ?? e)));
    }
  });
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const maskIban = (iban: string | null) => (iban ? `${iban.slice(0, 4)} ···· ${iban.slice(-4)}` : null);

export function registerBankingRoutes(app: Express): void {
  app.get("/api/v2/banking/status", handler(async (_req, res) => {
    const links = await prisma.$queryRawUnsafe<any[]>(
      `select id, aspsp, country, "validUntil", status, "lastSyncAt", "lastError", "createdAt" from bank_links
        where status in ('active', 'expired') order by "createdAt"`);
    const accounts = await prisma.$queryRawUnsafe<any[]>(
      `select a.id, a."linkId", a.name, a.iban, a.currency, a.balance::float as balance, a."balanceAt", a.hidden,
              (select count(*)::int from bank_transactions t where t."accountId" = a.id) as movements
         from bank_accounts a order by a.name`);
    res.json({
      configured: bankingConfigured(),
      redirectUrl: REDIRECT_URL(),
      categories: CATEGORIES,
      links: links.map((l) => ({ ...l, accounts: accounts.filter((a) => a.linkId === l.id).map((a) => ({ ...a, iban: maskIban(a.iban) })) })),
    });
  }));

  // Banks Enable Banking can reach in a country (to pick BBVA, Trade Republic…).
  app.get("/api/v2/banking/banks", handler(async (req, res) => {
    const country = String(req.query.country ?? "ES").toUpperCase().slice(0, 2);
    const data = await eb<{ aspsps: Array<{ name: string; country: string; logo?: string; maximum_consent_validity?: number; psu_types?: string[]; beta?: boolean }> }>(
      "GET", `/aspsps?country=${country}&psu_type=personal&service=AIS`);
    res.json({ banks: data.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo ?? null, beta: !!a.beta, days: a.maximum_consent_validity ? Math.floor(a.maximum_consent_validity / 86400) : null })) });
  }));

  // Link to the bank's own consent screen (read only), for the current user.
  app.post("/api/v2/banking/connect", handler(async (req, res) => {
    const aspsp = String(req.body?.aspsp ?? "").trim();
    const country = String(req.body?.country ?? "ES").toUpperCase().slice(0, 2);
    if (!aspsp) throw new HttpError(400, "Elige un banco.");
    const list = await eb<{ aspsps: Array<{ name: string; maximum_consent_validity?: number }> }>("GET", `/aspsps?country=${country}&psu_type=personal&service=AIS`);
    const bank = list.aspsps.find((a) => a.name === aspsp);
    if (!bank) throw new HttpError(400, `Enable Banking no tiene «${aspsp}» en ${country}.`);
    const days = Math.min(MAX_CONSENT_DAYS, Math.floor((bank.maximum_consent_validity ?? 90 * 86400) / 86400));
    const state = randomUUID();
    pending.set(state, { user: currentUser() ?? DEFAULT_USER, at: Date.now(), aspsp, country });
    const r = await eb<{ url: string }>("POST", "/auth", {
      access: { valid_until: new Date(Date.now() + days * 86_400_000 - 60_000).toISOString() },
      aspsp: { name: aspsp, country }, state, redirect_url: REDIRECT_URL(), psu_type: "personal", language: "es",
    });
    res.json({ url: r.url, days });
  }));

  // Read again (balances and new movements). Banks allow a few background reads a day: on demand, not every minute.
  app.post("/api/v2/banking/sync", handler(async (_req, res) => {
    res.json(await syncLinks());
  }));

  // Revoke a consent: the session is closed at Enable Banking (the bank stops giving data). Movements are kept.
  app.post("/api/v2/banking/links/:id/revoke", handler(async (req, res) => {
    const [link] = await prisma.$queryRawUnsafe<Array<{ sessionId: string }>>(`select "sessionId" from bank_links where id = $1`, req.params.id);
    if (!link) throw new HttpError(404, "No existe.");
    await eb("DELETE", `/sessions/${link.sessionId}`).catch(() => undefined);
    await prisma.$executeRawUnsafe(`update bank_links set status = 'revoked' where id = $1`, req.params.id);
    res.json({ ok: true });
  }));

  app.get("/api/v2/banking/transactions", handler(async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? "")) ? String(req.query.from) : yearStart();
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select t.id, to_char(t."bookingDate", 'YYYY-MM-DD') as date, t.amount::float as amount, t.currency, t.description,
              t.counterparty, t.category, t."categorySource", t.internal, t.note, a.name as account, l.aspsp as bank
         from bank_transactions t join bank_accounts a on a.id = t."accountId" join bank_links l on l.id = a."linkId"
        where t."bookingDate" >= $1::date and not a.hidden
        order by t."bookingDate" desc, t."createdAt" desc`, from);
    res.json({ transactions: rows });
  }));

  // Change the category of a movement; with `learn`, also a rule for every movement with that text (now and later).
  app.patch("/api/v2/banking/transactions/:id", handler(async (req, res) => {
    const category = String(req.body?.category ?? "");
    const cat = CATEGORY.get(category);
    if (!cat) throw new HttpError(400, "Categoría desconocida.");
    const internal = cat.kind === "internal";
    const n = await prisma.$executeRawUnsafe(
      `update bank_transactions set category = $2, internal = $3, "categorySource" = 'user' where id = $1`, req.params.id, category, internal);
    if (!n) throw new HttpError(404, "No existe.");
    const learn = String(req.body?.learn ?? "").trim();
    let applied = 0;
    if (learn.length >= 3) {
      await prisma.$executeRawUnsafe(
        `insert into spend_rules (pattern, category, internal) values ($1, $2, $3)
         on conflict ("userId", lower(pattern)) do update set category = excluded.category, internal = excluded.internal`, learn, category, internal);
      applied = await classifyAll(false);
    }
    res.json({ ok: true, applied });
  }));
}
