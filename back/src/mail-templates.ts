import { Express } from "express";
import { randomUUID } from "crypto";
import { currentUser, DEFAULT_USER, prisma } from "./prisma";
import { handler, HttpError } from "./portfolio";
import { getMail, gmailConnected, listMails, Mail } from "./gmail";
import { askGeminiJson, GeminiError, geminiConfigured } from "./gemini";

// Mail templates made by the users (supabase/mail-templates.sql). When a bank has no template (MyInvestor and BBVA
// are in mail-import.ts), the user can teach the app to read it:
//   1. candidates: e-mails of that bank that look like trades (Gmail, read-only, headers and snippet only);
//   2. generate: with the user's explicit consent, the chosen e-mails go to Gemini WITHOUT personal data (account
//      numbers, IBAN, ID numbers, e-mail addresses, phones and the name after a greeting are masked) and it proposes
//      one regular expression per field; the app tests them on the REAL e-mails and asks again if a field fails;
//   3. save: the template is kept for everybody with that bank, with who made it.

export type Kind = "buy" | "sell";
export type TemplateFields = {
  /** Regular expressions with ONE capture group, applied to "subject \n body" (case-insensitive). */
  kind: { pattern: string; buy: string[]; sell: string[] };
  date: { pattern: string; order: "dmy" | "ymd" | "mdy" };
  name: { pattern: string };
  isin?: { pattern: string } | null;
  quantity: { pattern: string };
  price?: { pattern: string } | null;
  amount: { pattern: string };
  currency?: { pattern: string } | null;
  defaultCurrency: string;
  /** Decimal separator of the numbers in these e-mails. */
  decimal: "," | ".";
};
export type MailTemplate = { id: string; label: string; bankPattern: string; query: string; fields: TemplateFields; what: string };
export type TemplateOp = {
  broker: string; kind: Kind; date: string; name: string; isin: string | null; quantity: number; price: number; fee: number;
  currency: string; fxToEur: number | null; amount: number; key: string;
};

const MAX_TEXT = 6000;
const MAX_PATTERN = 400;

// ---------------------------------------------------------------- reading an e-mail with a template

const textOf = (m: Mail) => `${m.subject}\n${m.body ?? ""}`.replace(/[ \t ]+/g, " ").slice(0, MAX_TEXT * 3);

function grab(pattern: string | undefined, text: string): string | null {
  if (!pattern || pattern.length > MAX_PATTERN) return null;
  try {
    const m = new RegExp(pattern, "i").exec(text);
    return (m?.[1] ?? null)?.trim() || null;
  } catch {
    return null;
  }
}

/** "1.234,56" (decimal ",") or "1,234.56" (decimal ".") → 1234.56. */
export function parseNumber(s: string | null, decimal: "," | "."): number | null {
  if (!s) return null;
  let t = s.replace(/[^\d.,-]/g, "");
  t = decimal === "," ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTHS: Record<string, string> = {
  ene: "01", jan: "01", feb: "02", mar: "03", abr: "04", apr: "04", may: "05", jun: "06", jul: "07", ago: "08", aug: "08",
  sep: "09", set: "09", oct: "10", nov: "11", dic: "12", dec: "12",
};

function parseDate(s: string | null, order: TemplateFields["date"]["order"]): string | null {
  if (!s) return null;
  const word = /(\d{1,2})\s*(?:de\s+)?([a-zé]{3})[a-zé]*\.?\s*(?:de\s+)?(\d{4})/i.exec(s);
  if (word && MONTHS[word[2].toLowerCase()]) return `${word[3]}-${MONTHS[word[2].toLowerCase()]}-${word[1].padStart(2, "0")}`;
  const p = s.split(/[^\d]+/).filter(Boolean);
  if (p.length < 3) return null;
  let [y, m, d] = order === "ymd" ? [p[0], p[1], p[2]] : order === "mdy" ? [p[2], p[0], p[1]] : [p[2], p[1], p[0]];
  if (y.length === 2) y = `20${y}`;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}

/** Every field it could read, and which required ones failed (to test a template and to ask the AI again). */
export function readWithTemplate(label: string, f: TemplateFields, mail: Mail): { op: TemplateOp | null; missing: string[] } {
  const text = textOf(mail);
  const missing: string[] = [];
  const kindWord = grab(f.kind?.pattern, text)?.toLowerCase() ?? "";
  const kind: Kind | null = f.kind?.sell?.some((w) => kindWord.includes(w.toLowerCase())) ? "sell"
    : f.kind?.buy?.some((w) => kindWord.includes(w.toLowerCase())) ? "buy" : null;
  if (!kind) missing.push("kind");
  const date = parseDate(grab(f.date?.pattern, text), f.date?.order ?? "dmy");
  if (!date) missing.push("date");
  const name = grab(f.name?.pattern, text);
  if (!name) missing.push("name");
  const quantity = parseNumber(grab(f.quantity?.pattern, text), f.decimal);
  if (!quantity || quantity <= 0) missing.push("quantity");
  const amount = parseNumber(grab(f.amount?.pattern, text), f.decimal);
  if (!amount || amount <= 0) missing.push("amount");
  if (missing.length) return { op: null, missing };
  const price = parseNumber(grab(f.price?.pattern ?? undefined, text), f.decimal) ?? amount! / quantity!;
  const isin = grab(f.isin?.pattern ?? undefined, text)?.toUpperCase() ?? null;
  const currency = (grab(f.currency?.pattern ?? undefined, text) ?? f.defaultCurrency ?? "EUR").toUpperCase().slice(0, 3);
  const fee = Math.max(0, Math.round((kind === "buy" ? amount! - quantity! * price : quantity! * price - amount!) * 100) / 100);
  return {
    op: {
      broker: label, kind: kind!, date: date!, name: name!, isin: isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin) ? isin : null,
      quantity: quantity!, price, fee: fee < amount! * 0.05 ? fee : 0, currency, fxToEur: currency === "EUR" ? 1 : null, amount: amount!,
      key: `${label}|${date}|${kind}|${name!.toUpperCase()}|${quantity}|${amount}|${currency}`,
    },
    missing,
  };
}

// ---------------------------------------------------------------- templates in the database

let cache: { at: number; list: MailTemplate[] } | null = null;

export async function userTemplates(): Promise<MailTemplate[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const list = await prisma.$queryRawUnsafe<MailTemplate[]>(
    `select id, label, "bankPattern", query, fields, what from mail_templates where status = 'active' order by "createdAt"`
  );
  cache = { at: Date.now(), list };
  return list;
}

/** Template made by a user for this bank name, if any. */
export async function userTemplateFor(bankName: string): Promise<MailTemplate | null> {
  for (const t of await userTemplates()) {
    try {
      if (new RegExp(t.bankPattern, "i").test(bankName)) return t;
    } catch {
      /* bad pattern: skip */
    }
  }
  return null;
}

export async function markUsed(id: string): Promise<void> {
  await prisma.$executeRawUnsafe(`update mail_templates set uses = uses + 1, "lastUsedAt" = now() where id = $1`, id).catch(() => undefined);
}

// ---------------------------------------------------------------- personal data out before anything leaves

/** Masks what identifies the person: e-mails, IBAN, ID numbers, phones, long account numbers and the name after a greeting. */
export function maskPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g, (m) => (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(m) ? m : "[iban]"))
    .replace(/\b\d{8}[A-HJ-NP-TV-Z]\b|\b[XYZ]\d{7}[A-Z]\b/gi, "[dni]")
    .replace(/(?<![\w.,])(?:\+34[ ]?)?[6789]\d{2}[ ]?\d{3}[ ]?\d{3}(?!\d|[.,]\d)/g, "[teléfono]")
    // Account or contract numbers (digits, maybe with spaces). Not inside an ISIN or a word, not dates
    // (2026-11-20, 20/11/2026) nor amounts (1.234,56).
    .replace(/(?<![\w.,\/-])\d[\d ]{7,}\d(?![\w\/-]|[.,]\d)/g, "[número]")
    .replace(/\b(Estimad[oa]s?|Hola|Dear|Sr\.?|Sra\.?|Don|Doña|Titular|Cliente|Nombre)\b[:\s]+[^\n,.:;]{2,60}/gi, "$1 [nombre]");
}

// ---------------------------------------------------------------- creating a template (job with visible steps)

type Event = { n: number; level: "info" | "ok" | "ai" | "warn" | "error"; text: string };
type Draft = { label: string; bankPattern: string; query: string; fields: TemplateFields; what: string };
type Job = {
  id: string; userId: string; bank: { id: string; name: string }; phase: "running" | "done" | "error"; events: Event[];
  draft: Draft | null; model: string | null; results: Array<{ id: string; date: string; subject: string; op: TemplateOp | null; missing: string[] }>;
  saved: string | null;
};
const jobs = new Map<string, Job>();
const log = (job: Job, level: Event["level"], text: string) => job.events.push({ n: job.events.length, level, text });

const FIELD = { type: "OBJECT", properties: { pattern: { type: "STRING" } }, required: ["pattern"] };
export const TEMPLATE_SCHEMA = {
  type: "OBJECT",
  properties: {
    query: { type: "STRING" },
    what: { type: "STRING" },
    fields: {
      type: "OBJECT",
      properties: {
        kind: { type: "OBJECT", properties: { pattern: { type: "STRING" }, buy: { type: "ARRAY", items: { type: "STRING" } }, sell: { type: "ARRAY", items: { type: "STRING" } } }, required: ["pattern", "buy", "sell"] },
        date: { type: "OBJECT", properties: { pattern: { type: "STRING" }, order: { type: "STRING", enum: ["dmy", "ymd", "mdy"] } }, required: ["pattern", "order"] },
        name: FIELD, isin: { ...FIELD, nullable: true }, quantity: FIELD, price: { ...FIELD, nullable: true }, amount: FIELD,
        currency: { ...FIELD, nullable: true },
        defaultCurrency: { type: "STRING" },
        decimal: { type: "STRING", enum: [",", "."] },
      },
      required: ["kind", "date", "name", "quantity", "amount", "defaultCurrency", "decimal"],
    },
  },
  required: ["query", "what", "fields"],
};

const FIELD_NAMES: Record<string, string> = { kind: "compra o venta", date: "fecha", name: "producto", quantity: "títulos", amount: "importe" };

export function prompt(bank: string, samples: Array<{ fromDomain: string; subject: string; body: string }>, feedback: string): string {
  return `Eres un asistente técnico de una app de finanzas personales. El usuario quiere que la app lea automáticamente los
correos de confirmación de operaciones (compras y ventas de acciones, fondos o ETFs) del banco o bróker "${bank}".
Te paso ${samples.length} correo(s) de ejemplo, con los datos personales ya tapados ([nombre], [número], [iban]…).

Devuelve una plantilla en JSON:
- "query": búsqueda de Gmail que encuentre SOLO este tipo de correos de este banco, por ejemplo: from:dominio.com "frase fija del asunto". Sin fechas.
- "what": qué correos lee, en español y en pocas palabras (p. ej. "confirmaciones de compra y venta de acciones").
- "fields": una expresión regular de JavaScript por campo, con UN SOLO grupo de captura, que se aplicará al texto
  "asunto + salto de línea + cuerpo" (sin distinguir mayúsculas; los espacios seguidos ya vienen como uno solo).
  · kind: captura la palabra de la operación; "buy" y "sell" son palabras (en minúsculas) que aparecen en esa captura.
  · date: fecha de la operación (no la del envío si son distintas); "order" dice el orden día/mes/año.
  · name: nombre del producto (acción, fondo o ETF) tal como aparece.
  · isin (si aparece), quantity (títulos o participaciones), price (precio por título, si aparece), amount (importe total de la operación), currency (si aparece; si no, null y pon defaultCurrency).
  · decimal: separador decimal de los números de estos correos.
Las expresiones deben funcionar en TODOS los ejemplos, no depender de los datos tapados ni de los valores concretos
(nada de nombres de producto o cantidades escritas a mano), y ser sencillas (sin anidar cuantificadores).
${feedback ? `\nIntento anterior: ${feedback}\nCorrígelo.\n` : ""}
Ejemplos:
${samples.map((s, i) => `--- Correo ${i + 1} (remitente: ${s.fromDomain})\nAsunto: ${s.subject}\n${s.body}`).join("\n\n")}`;
}

async function generate(job: Job, mailIds: string[]): Promise<void> {
  try {
    log(job, "info", `Leyendo ${mailIds.length} correo(s) de ${job.bank.name} (solo lectura)…`);
    const mails: Mail[] = [];
    for (const id of mailIds) mails.push(await getMail(id));
    log(job, "ok", `${mails.length} correo(s) descargado(s).`);
    log(job, "info", "Tapando datos personales: nombre, números de cuenta, IBAN, DNI, teléfonos y correos…");
    const samples = mails.map((m) => ({
      fromDomain: /@([\w.-]+)/.exec(m.from)?.[1] ?? "desconocido",
      subject: maskPersonal(m.subject),
      body: maskPersonal((m.body ?? "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n")).slice(0, MAX_TEXT),
    }));
    const masked = samples.reduce((s, x) => s + (x.body.match(/\[(nombre|número|iban|dni|teléfono|correo)\]/g)?.length ?? 0), 0);
    log(job, "ok", `${masked} dato(s) personal(es) tapado(s). Solo sale el texto de la operación.`);

    let feedback = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(job, "ai", attempt === 1 ? "La IA está estudiando el formato de los correos…" : `La IA corrige la plantilla (intento ${attempt})…`);
      const { data, model } = await askGeminiJson<{ query: string; what: string; fields: TemplateFields }>(
        prompt(job.bank.name, samples, feedback), TEMPLATE_SCHEMA, (m) => log(job, "ai", `Consultando el modelo ${m}…`)
      );
      job.model = model;
      log(job, "ai", "Plantilla propuesta. Probándola con tus correos reales…");
      job.results = mails.map((m) => ({ id: m.id, date: m.date, subject: m.subject, ...readWithTemplate(job.bank.name, data.fields, m) }));
      const failed = job.results.filter((r) => !r.op);
      for (const r of job.results) {
        if (r.op) log(job, "ok", `✓ ${r.op.kind === "buy" ? "Compra" : "Venta"} · ${r.op.date} · ${r.op.name} · ${r.op.quantity} títulos · ${r.op.amount} ${r.op.currency}`);
        else log(job, "warn", `No se pudo leer: ${r.missing.map((x) => FIELD_NAMES[x] ?? x).join(", ")} (${r.subject.slice(0, 60)})`);
      }
      job.draft = {
        label: job.bank.name,
        bankPattern: job.bank.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*"),
        query: String(data.query ?? "").replace(/\bafter:\S+/gi, "").trim().slice(0, 300),
        fields: data.fields,
        what: String(data.what ?? "confirmaciones de operaciones").slice(0, 120),
      };
      if (!failed.length && job.draft.query) {
        log(job, "ok", `La plantilla lee bien ${job.results.length} de ${job.results.length} correos. Revísala y guárdala.`);
        job.phase = "done";
        return;
      }
      feedback = `${failed.map((r) => `en "${maskPersonal(r.subject).slice(0, 80)}" no se pudo leer: ${r.missing.join(", ")}`).join("; ")}${job.draft.query ? "" : "; falta query"}.`;
    }
    log(job, "error", "La IA no ha conseguido una plantilla que lea todos los correos. Prueba con otros ejemplos.");
    job.phase = "error";
  } catch (e: any) {
    log(job, "error", e instanceof GeminiError ? `La IA no está disponible ahora (${e.message}).` : String(e?.message ?? e));
    job.phase = "error";
  }
}

// ---------------------------------------------------------------- routes

export function registerMailTemplateRoutes(app: Express): void {
  /** Every template made by users (shared), with who made it. */
  app.get("/api/v2/mail-templates", handler(async (_req, res) => {
    res.json(await prisma.$queryRawUnsafe(
      `select t.id, t.label, t.what, t.status, t.samples, t.model, t.uses, t."lastUsedAt", t."createdAt", u.name as "createdBy",
              t."createdBy" = public.app_user() as mine
         from mail_templates t join users u on u.id = t."createdBy" order by t."createdAt" desc`
    ));
  }));

  /** E-mails of a bank that look like trades, to pick the examples (headers and snippet only). */
  app.post("/api/v2/mail-templates/candidates", handler(async (req, res) => {
    if (!gmailConnected()) throw new HttpError(400, "Conecta Gmail primero (solo lectura).");
    const [bank] = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(`select id, name from banks where id = $1`, String(req.body?.bankId ?? ""));
    if (!bank) throw new HttpError(404, "Banco no encontrado.");
    const words = '(compra OR venta OR operación OR operacion OR orden OR ejecutada OR ejecución OR confirmación OR suscripción OR reembolso OR order OR trade)';
    const extra = String(req.body?.from ?? "").trim().replace(/[^\w.@-]/g, "");
    const query = `${extra ? `from:${extra}` : `"${bank.name.replace(/"/g, "")}"`} ${words} newer_than:2y`;
    res.json({ query, mails: await listMails(query, 20) });
  }));

  /** Step 2: the AI proposes the template and the app tests it (job with progress, like the fund finder). */
  app.post("/api/v2/mail-templates/generate", handler(async (req, res) => {
    if (req.body?.consent !== true) throw new HttpError(400, "Hace falta tu permiso para enviar los ejemplos (sin datos personales) a la IA.");
    if (!geminiConfigured()) throw new HttpError(400, "Falta GEMINI_API_KEY en back/.env.");
    const ids = (Array.isArray(req.body?.mailIds) ? req.body.mailIds : []).map(String).slice(0, 3);
    if (!ids.length) throw new HttpError(400, "Elige al menos un correo de ejemplo.");
    const [bank] = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(`select id, name from banks where id = $1`, String(req.body?.bankId ?? ""));
    if (!bank) throw new HttpError(404, "Banco no encontrado.");
    const job: Job = { id: randomUUID(), userId: currentUser() ?? DEFAULT_USER, bank, phase: "running", events: [], draft: null, model: null, results: [], saved: null };
    jobs.set(job.id, job);
    void generate(job, ids);
    res.status(202).json({ jobId: job.id });
  }));

  app.get("/api/v2/mail-templates/job/:id", handler(async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.userId !== (currentUser() ?? DEFAULT_USER)) throw new HttpError(404, "No encontrado.");
    const after = Number(req.query.after ?? -1);
    res.json({ ...job, events: job.events.filter((e) => e.n > after) });
  }));

  /** Step 3: keeps the tested template (from the job, never from the browser). */
  app.post("/api/v2/mail-templates", handler(async (req, res) => {
    const job = jobs.get(String(req.body?.jobId ?? ""));
    if (!job || job.userId !== (currentUser() ?? DEFAULT_USER) || job.phase !== "done" || !job.draft) throw new HttpError(400, "No hay ninguna plantilla probada para guardar.");
    if (job.saved) return void res.json({ id: job.saved });
    const d = job.draft;
    const [row] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `insert into mail_templates (label, "bankPattern", query, fields, what, samples, model) values ($1, $2, $3, $4::jsonb, $5, $6, $7) returning id`,
      d.label, d.bankPattern, d.query, JSON.stringify(d.fields), d.what, job.results.length, job.model
    );
    job.saved = row.id;
    cache = null;
    res.json({ id: row.id });
  }));

  app.delete("/api/v2/mail-templates/:id", handler(async (req, res) => {
    const n = await prisma.$executeRawUnsafe(`delete from mail_templates where id = $1 and "createdBy" = public.app_user()`, String(req.params.id));
    if (!n) throw new HttpError(403, "Solo quien creó la plantilla puede borrarla.");
    cache = null;
    res.json({ ok: true });
  }));
}
