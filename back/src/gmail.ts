import { Express, Request, Response } from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { currentUser, DEFAULT_USER, USERS } from "./prisma";
import { handler, HttpError } from "./portfolio";

// Read-only Gmail access (OAuth 2.0, scope gmail.readonly) for the e-mail import.
// Secrets never live in the project: the OAuth client (downloaded from Google Cloud) and each app user's token are
// in ~/.finanzas (gmail-client.json, gmail-token-<user>.json). Nothing here can send, change or delete e-mail.

const DIR = path.join(os.homedir(), ".finanzas");
const CLIENT_FILE = process.env.GMAIL_CLIENT_FILE || path.join(DIR, "gmail-client.json");
const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const tokenFile = (user: string) => path.join(DIR, `gmail-token-${user}.json`);

type Client = { client_id: string; client_secret: string; redirect_uris: string[]; auth_uri: string; token_uri: string };
type Token = { refresh_token: string; access_token?: string; expires_at?: number; email?: string };
export type Attachment = { id: string; filename: string; mimeType: string };
export type Mail = { id: string; from: string; date: string; subject: string; body?: string; attachments?: Attachment[] };

function client(): Client | null {
  try {
    const j = JSON.parse(fs.readFileSync(CLIENT_FILE, "utf8"));
    return (j.web ?? j.installed) as Client;
  } catch {
    return null;
  }
}

function readToken(user: string): Token | null {
  try {
    return JSON.parse(fs.readFileSync(tokenFile(user), "utf8"));
  } catch {
    return null;
  }
}

function saveToken(user: string, token: Token): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(tokenFile(user), JSON.stringify(token), { mode: 0o600 });
}

export function gmailConnected(user = currentUser() ?? DEFAULT_USER): boolean {
  return !!client() && !!readToken(user)?.refresh_token;
}

async function tokenRequest(params: Record<string, string>): Promise<any> {
  const c = client();
  if (!c) throw new HttpError(400, "Falta el fichero del cliente de Google (gmail-client.json).");
  const res = await fetch(c.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new HttpError(400, `Google: ${body.error_description ?? body.error ?? res.status}`);
  return body;
}

/** A valid access token for the user (refreshed with the stored refresh token when it expires). */
async function accessToken(user: string): Promise<string> {
  const t = readToken(user);
  if (!t?.refresh_token) throw new HttpError(400, "Gmail no está conectado.");
  if (t.access_token && (t.expires_at ?? 0) > Date.now() + 60_000) return t.access_token;
  try {
    const r = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    saveToken(user, { ...t, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000 });
    return r.access_token;
  } catch (e) {
    // Revoked or expired (apps in "testing" mode: every 7 days): connect again.
    fs.rmSync(tokenFile(user), { force: true });
    throw new HttpError(400, "El permiso de Gmail ha caducado: vuelve a conectar Gmail.");
  }
}

async function gmail(user: string, url: string): Promise<any> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${url}`, {
    headers: { Authorization: `Bearer ${await accessToken(user)}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gmail ${res.status}`);
  return res.json();
}

/** Plain text of an HTML e-mail body: cells and rows become spaces and line breaks. */
function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ");
}

function bodyText(payload: any): string {
  const decode = (data: string) => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const parts: any[] = [];
  const walk = (p: any) => { parts.push(p); (p.parts ?? []).forEach(walk); };
  walk(payload);
  const plain = parts.find((p) => p.mimeType === "text/plain" && p.body?.data);
  if (plain) return decode(plain.body.data);
  const html = parts.find((p) => p.mimeType === "text/html" && p.body?.data);
  return html ? htmlToText(decode(html.body.data)) : "";
}

/** PDF and other files attached to a message (to download with attachment()). */
function attachmentsOf(payload: any): Attachment[] {
  const out: Attachment[] = [];
  const walk = (p: any) => {
    if (p.filename && p.body?.attachmentId) out.push({ id: p.body.attachmentId, filename: p.filename, mimeType: p.mimeType });
    (p.parts ?? []).forEach(walk);
  };
  walk(payload);
  return out;
}

/** Bytes of an attachment. */
export async function attachment(messageId: string, attachmentId: string): Promise<Buffer> {
  const r = await gmail(currentUser() ?? DEFAULT_USER, `messages/${messageId}/attachments/${attachmentId}`);
  return Buffer.from(String(r.data).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** E-mails matching a Gmail search (e.g. `from:myinvestor after:2026/01/01`), oldest first. */
export async function searchMails(query: string, onProgress?: (n: number) => void): Promise<Mail[]> {
  const user = currentUser() ?? DEFAULT_USER;
  const ids: string[] = [];
  let pageToken = "";
  do {
    const r = await gmail(user, `messages?maxResults=100&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${pageToken}` : ""}`);
    ids.push(...(r.messages ?? []).map((m: any) => m.id));
    pageToken = r.nextPageToken ?? "";
  } while (pageToken && ids.length < 1000);
  const mails: Mail[] = [];
  for (const id of ids) {
    const m = await gmail(user, `messages/${id}?format=full`);
    const header = (name: string) => m.payload?.headers?.find((h: any) => h.name.toLowerCase() === name)?.value ?? "";
    mails.push({
      id, from: header("from"), subject: header("subject"),
      date: new Date(Number(m.internalDate)).toISOString().slice(0, 10),
      body: bodyText(m.payload),
      attachments: attachmentsOf(m.payload),
    });
    onProgress?.(mails.length);
  }
  return mails.sort((a, b) => a.date.localeCompare(b.date));
}

// One-time states of the consent screen: state -> app user (the callback comes from Google, without our header).
const pending = new Map<string, { user: string; at: number }>();

/** Routes that must work without the user header (Google's redirect): register before the user middleware. */
export function registerGmailCallback(app: Express): void {
  app.get("/api/v2/gmail/callback", async (req: Request, res: Response) => {
    const page = (title: string, text: string) =>
      res.send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;padding:40px;background:#111;color:#eee">
        <h2>${title}</h2><p>${text}</p><p>Puedes cerrar esta pestaña y volver a la app.</p></body>`);
    const state = String(req.query.state ?? "");
    const p = pending.get(state);
    pending.delete(state);
    if (!p || Date.now() - p.at > 10 * 60_000) return void page("Enlace caducado", "Vuelve a pulsar «Conectar Gmail» en la app.");
    if (req.query.error) return void page("No conectado", "Has cancelado el permiso en Google.");
    try {
      const c = client()!;
      const r = await tokenRequest({ grant_type: "authorization_code", code: String(req.query.code ?? ""), redirect_uri: c.redirect_uris[0] });
      if (!r.refresh_token) throw new Error("Google no ha dado permiso permanente; vuelve a intentarlo.");
      const profile = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${r.access_token}` },
      }).then((x) => x.json() as any).catch(() => ({}));
      saveToken(p.user, { refresh_token: r.refresh_token, access_token: r.access_token, expires_at: Date.now() + r.expires_in * 1000, email: profile.emailAddress });
      page("Gmail conectado", `La app ya puede leer (solo leer) los correos de ${profile.emailAddress ?? "tu cuenta"}.`);
    } catch (e: any) {
      page("No se pudo conectar", String(e?.message ?? e));
    }
  });
}

export function registerGmailRoutes(app: Express): void {
  app.get("/api/v2/gmail/status", handler(async (_req, res) => {
    const user = currentUser() ?? DEFAULT_USER;
    res.json({ configured: !!client(), connected: gmailConnected(user), email: readToken(user)?.email ?? null });
  }));

  // Link to Google's consent screen (read-only), for the current app user.
  app.post("/api/v2/gmail/connect", handler(async (_req, res) => {
    const c = client();
    if (!c) throw new HttpError(400, "Falta el fichero del cliente de Google (gmail-client.json).");
    const user = currentUser() ?? DEFAULT_USER;
    if (!(USERS as readonly string[]).includes(user)) throw new HttpError(400, "Usuario no valido.");
    const state = randomUUID();
    pending.set(state, { user, at: Date.now() });
    const url = new URL(c.auth_uri);
    url.search = new URLSearchParams({
      client_id: c.client_id, redirect_uri: c.redirect_uris[0], response_type: "code", scope: SCOPE,
      access_type: "offline", prompt: "consent", state,
    }).toString();
    res.json({ url: url.toString() });
  }));

  app.post("/api/v2/gmail/disconnect", handler(async (_req, res) => {
    fs.rmSync(tokenFile(currentUser() ?? DEFAULT_USER), { force: true });
    res.json({ ok: true });
  }));
}
