import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, Observable } from 'rxjs';
import { PortfolioStore } from '../core/portfolio.store';
import { demoState, isDemo, setDemoState } from './demo-mode';
import { mailCandidates, MAIL_EVENTS } from './demo-mail';

/**
 * Demo mode: answers every call to the back with the saved answers of the "demo" user (public/demo/*.json, made by
 * back/scripts/demo-fixtures.js). Nothing reaches a server. Changes are accepted and forgotten (a toast says so),
 * except the risk profile and the saved funds, kept in this browser so the guided tour can use them.
 */

const files = new Map<string, Promise<any>>();

/** public/demo/<name>.json, loaded once. */
function file(name: string): Promise<any> {
  if (!files.has(name)) {
    files.set(
      name,
      fetch(new URL(`demo/${name}.json`, document.baseURI)).then((r) => (r.ok ? r.json() : Promise.reject(new Error('404'))))
    );
  }
  return files.get(name)!.catch(() => {
    files.delete(name);
    return undefined;
  });
}

/** Same rule as back/scripts/demo-fixtures.js → keyOf. */
function keyOf(path: string, params: URLSearchParams): string {
  const q = [...params.entries()].filter(([, v]) => v !== '').sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}-${v}`).join('_');
  return (path + (q ? '__' + q : '')).replace(/[^a-zA-Z0-9_-]+/g, '_');
}

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

class DemoError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
const missing = (text = 'No está disponible en la demo.') => new DemoError(404, text);

// ---------------------------------------------------------------- simulated jobs

type Job = { kind: 'funds' | 'mail'; start: number; profile?: string; zones?: string[]; applied?: number };
const jobs = new Map<string, Job>();
const STEP_MS = 420;

async function fundJob(id: string, after: number): Promise<unknown> {
  const job = jobs.get(id);
  if (!job) throw missing('Búsqueda no encontrada.');
  const bundle = await file('bundle_fund_finder');
  const saved = bundle?.[job.profile ?? 'equilibrado'] ?? bundle?.['equilibrado'];
  const zoneNames = (job.zones ?? []).join(', ') || 'Global';
  const events = [
    { level: 'info', text: `Demo: búsqueda real hecha antes para este perfil (zona Global). Has elegido: ${zoneNames}.` },
    ...(saved?.events ?? []),
  ].map((e: any, n: number) => ({ ...e, n }));
  const shown = Math.min(events.length, Math.floor((Date.now() - job.start) / STEP_MS) + 1);
  const running = shown < events.length;
  return {
    ...saved,
    id,
    phase: running ? 'running' : 'done',
    events: events.slice(0, shown).filter((e) => e.n > after),
    picks: running ? [] : saved?.picks ?? [],
  };
}

async function mailJob(id: string, after: number): Promise<unknown> {
  const job = jobs.get(id);
  if (!job) throw missing('Importación no encontrada.');
  const setup = await file('v2_mail-import_setup');
  const overview = await file('v2_overview');
  const candidates = mailCandidates(setup, overview);
  const events = MAIL_EVENTS.map((text, n) => ({ n, level: n === MAIL_EVENTS.length - 1 ? 'ok' : 'info', text }));
  const shown = Math.min(events.length, Math.floor((Date.now() - job.start) / STEP_MS) + 1);
  const scanning = shown < events.length;
  const applied = job.applied;
  return {
    id, userName: 'Demo', source: 'demo',
    phase: applied !== undefined ? 'done' : scanning ? 'scanning' : 'review',
    total: candidates.length, processed: scanning ? Math.floor((shown / events.length) * candidates.length) : candidates.length,
    created: applied ?? 0, linked: applied !== undefined ? candidates.filter((c) => c.status === 'exists').length : 0,
    skipped: 0, failed: 0,
    events: events.slice(0, shown).filter((e) => e.n > after),
    candidates: scanning ? [] : candidates,
  };
}

// ---------------------------------------------------------------- answers

type Risk = { latest: any; history: any[] };

async function answer(req: HttpRequest<unknown>, toast: (text: string) => void): Promise<unknown> {
  const url = new URL(req.urlWithParams, location.href);
  const path = url.pathname.replace(/^.*?\/api\//, '');
  const params = url.searchParams;
  const method = req.method;
  const body = (req.body ?? {}) as any;
  let m: RegExpMatchArray | null;

  // --- what the demo keeps in this browser
  if (path === 'v2/risk-profile') {
    const risk = demoState<Risk>('risk', { latest: null, history: [] });
    if (method === 'GET') return risk;
    const row = { ...body, id: `demo-${Date.now()}`, createdAt: new Date().toISOString() };
    setDemoState('risk', { latest: row, history: [row, ...risk.history] });
    return { id: row.id, createdAt: row.createdAt };
  }
  if (path === 'v2/saved-funds') {
    const list = demoState<any[]>('savedFunds', []);
    if (method === 'GET') return list;
    const add = (body.picks ?? []).map((p: any) => ({ id: `demo-${p.isin}-${body.profile}`, isin: p.isin, profile: body.profile, zones: body.zones ?? [], data: p, createdAt: new Date().toISOString() }));
    setDemoState('savedFunds', [...add, ...list.filter((x) => !add.some((a: any) => a.id === x.id))]);
    return { saved: add.length };
  }
  if ((m = path.match(/^v2\/saved-funds\/(.+)$/)) && method === 'DELETE') {
    setDemoState('savedFunds', demoState<any[]>('savedFunds', []).filter((x) => x.id !== m![1]));
    return { ok: true };
  }

  // --- simulated jobs
  if (path === 'v2/fund-finder' && method === 'POST') {
    const id = `funds-${Date.now()}`;
    jobs.set(id, { kind: 'funds', start: Date.now(), profile: body.profile, zones: body.regions });
    return { jobId: id };
  }
  if ((m = path.match(/^v2\/fund-finder\/(.+)$/))) return fundJob(m[1], Number(params.get('after') ?? -1));
  if (path === 'v2/mail-import/scan') {
    const id = `mail-${Date.now()}`;
    jobs.set(id, { kind: 'mail', start: Date.now() });
    return { jobId: id };
  }
  if ((m = path.match(/^v2\/mail-import\/([^/]+)\/apply$/))) {
    const job = jobs.get(m[1]);
    if (job) job.applied = (body.keys ?? []).length;
    toast('Demo: las operaciones no se guardan de verdad.');
    return { ok: true };
  }
  if ((m = path.match(/^v2\/mail-import\/(mail-.+)$/))) return mailJob(m[1], Number(params.get('after') ?? -1));
  if (path === 'v2/gmail/status') return { configured: true, connected: true, email: 'demo@ejemplo.com' };
  if (path === 'v2/users') return { users: [] };

  // --- Gastos: no real banks in the demo
  if (path === 'v2/banking/connect') throw missing('En la demo no se conectan bancos de verdad: los movimientos de BBVA y Trade Republic que ves son inventados.');
  if (path === 'v2/banking/sync') return { added: 0, accounts: 2, errors: [] };

  // --- every other change: accepted and forgotten
  if (method !== 'GET') {
    toast('Demo: los cambios no se guardan. Prueba lo que quieras.');
    const same = await file(keyOf(path, new URLSearchParams()));
    return same ?? { ok: true, id: 'demo' };
  }

  // --- saved answers
  if (path === 'v2/series') return { series: await series(params) };
  if ((m = path.match(/^v2\/calendar\/(\d{4}-\d{2}-\d{2})$/))) {
    const days = await file('bundle_calendar_days');
    return days?.[m[1]] ?? { date: m[1], assets: [] };
  }
  if ((m = path.match(/^v2\/valuations\/company\/(.+)$/))) {
    const one = (await file('bundle_valuations_company'))?.[decodeURIComponent(m[1])];
    if (!one) throw missing('En la demo solo están las fichas de las empresas más grandes de cada índice.');
    return one;
  }
  if ((m = path.match(/^v2\/sentiment\/stock\/(.+)$/))) {
    const one = (await file('bundle_sentiment_stock'))?.[decodeURIComponent(m[1])];
    if (!one) throw missing('En la demo solo está el detalle de las empresas más comentadas.');
    return one;
  }
  if ((m = path.match(/^v2\/assets\/([^/]+)\/price$/))) {
    const a = ((await file('v2_overview'))?.assets ?? []).find((x: any) => x.id === m![1]);
    if (!a) throw missing();
    return { priceLocal: a.priceLocal, currency: a.currency, fxToEur: a.priceLocal ? a.priceEur / a.priceLocal : 1, priceEur: a.priceEur, date: params.get('date'), source: 'demo' };
  }
  if (path === 'v2/valuations') params.delete('run');
  if (path === 'v2/magic-formula') params.delete('run');
  if (path === 'v2/movements') {
    const limit = Number(params.get('limit') ?? 500);
    params.set('limit', String(limit <= 50 ? 50 : limit <= 200 ? 200 : 500));
  }
  const data = (await file(keyOf(path, params))) ?? (await file(keyOf(path, new URLSearchParams())));
  if (data === undefined) throw missing();
  return data;
}

/** Series of a bank/type filter: the sum of the saved series of every bank × type pair inside it. */
async function series(params: URLSearchParams): Promise<unknown[]> {
  const banks = (params.get('banks') ?? '').split(',').filter(Boolean);
  const types = (params.get('types') ?? '').split(',').filter(Boolean);
  if (!banks.length && !types.length) return (await file('v2_series'))?.series ?? [];
  const pairs: Record<string, any[]> = (await file('bundle_series_pairs')) ?? {};
  const byDate = new Map<string, any>();
  for (const [key, points] of Object.entries(pairs)) {
    const [bank, type] = key.split('|');
    if ((banks.length && !banks.includes(bank)) || (types.length && !types.includes(type))) continue;
    for (const p of points) {
      const acc = byDate.get(p.date) ?? { date: p.date };
      for (const [k, v] of Object.entries(p)) if (typeof v === 'number') acc[k] = (acc[k] ?? 0) + v;
      byDate.set(p.date, acc);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** One "changes are not saved" toast every few seconds, not one per request. */
let lastToast = 0;

export const demoInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isDemo() || !req.url.includes('/api/')) return next(req);
  const store = inject(PortfolioStore);
  const toast = (text: string) => {
    if (Date.now() - lastToast > 4000) store.toast('ok', text);
    lastToast = Date.now();
  };
  return from(
    (async (): Promise<HttpEvent<unknown>> => {
      await wait(120);
      try {
        const body = await answer(req, toast);
        return new HttpResponse({ status: 200, body: structuredClone(body), url: req.url });
      } catch (e) {
        const status = e instanceof DemoError ? e.status : 500;
        throw new HttpErrorResponse({ status, error: { message: (e as Error).message, error: (e as Error).message }, url: req.url });
      }
    })()
  ) as Observable<HttpEvent<unknown>>;
};
