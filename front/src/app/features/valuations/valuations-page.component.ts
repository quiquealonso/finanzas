import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { formatDay } from '../../shared/format.utils';
import { ListView, ViewToggleComponent } from '../../shared/view-toggle.component';
import { ConfirmService } from '../../shared/confirm-dialog.component';

const API = 'http://localhost:3000/api/v2';
const PICK_KEY = 'valuations.metrics';
const FUND_KEY = 'valuations.fund';

type MetricKey = 'pe' | 'divYield' | 'payout' | 'pb' | 'ps' | 'evEbitda' | 'fcfYield' | 'roe' | 'roic' | 'opMargin' | 'netMargin' | 'netDebtEbitda' | 'revGrowth' | 'epsGrowth' | 'earningsYield' | 'mom12';
type Metric = { key: MetricKey; label: string; short: string; group: string; kind: 'x' | 'pct'; better: 'low' | 'high'; help: string };

/** The metrics of each photo (back/src/valuations.ts). better = which side is "cheaper" or "better". */
export const METRICS: Metric[] = [
  { key: 'pe', label: 'PER', short: 'PER', group: 'Precio', kind: 'x', better: 'low', help: 'Capitalización / beneficio neto de los últimos 12 meses. Cuántos años de beneficio pagas. Sin dato si pierde dinero.' },
  { key: 'pb', label: 'Precio / valor contable', short: 'P/VC', group: 'Precio', kind: 'x', better: 'low', help: 'Capitalización / patrimonio neto. Por debajo de 1 cotiza por menos de lo que vale en libros.' },
  { key: 'ps', label: 'Precio / ventas', short: 'P/Ventas', group: 'Precio', kind: 'x', better: 'low', help: 'Capitalización / ventas de los últimos 12 meses.' },
  { key: 'evEbitda', label: 'EV / EBITDA', short: 'EV/EBITDA', group: 'Precio', kind: 'x', better: 'low', help: 'Valor empresa (capitalización + deuda − caja) / EBITDA. Compara empresas con distinta deuda.' },
  { key: 'earningsYield', label: 'Rentabilidad por beneficios', short: 'EBIT/EV', group: 'Precio', kind: 'pct', better: 'high', help: 'EBIT / valor empresa (la de la fórmula mágica). Más alto = más barata.' },
  { key: 'divYield', label: 'Rentabilidad por dividendo', short: 'Dividendo', group: 'Dividendos y caja', kind: 'pct', better: 'high', help: 'Dividendos pagados en el último año fiscal / capitalización.' },
  { key: 'payout', label: 'Payout', short: 'Payout', group: 'Dividendos y caja', kind: 'pct', better: 'low', help: 'Parte del beneficio que se va en dividendos. Más de 100 % no es sostenible.' },
  { key: 'fcfYield', label: 'Rentabilidad flujo de caja libre', short: 'FCF yield', group: 'Dividendos y caja', kind: 'pct', better: 'high', help: '(Flujo de caja operativo − inversiones) del último año / capitalización.' },
  { key: 'roe', label: 'ROE', short: 'ROE', group: 'Calidad', kind: 'pct', better: 'high', help: 'Beneficio neto / patrimonio neto: lo que gana con el dinero de los accionistas.' },
  { key: 'roic', label: 'Rentabilidad sobre el capital', short: 'ROIC', group: 'Calidad', kind: 'pct', better: 'high', help: 'EBIT / (capital circulante + activo fijo). Calidad del negocio (fórmula mágica).' },
  { key: 'opMargin', label: 'Margen operativo', short: 'M. operativo', group: 'Calidad', kind: 'pct', better: 'high', help: 'EBIT / ventas.' },
  { key: 'netMargin', label: 'Margen neto', short: 'M. neto', group: 'Calidad', kind: 'pct', better: 'high', help: 'Beneficio neto / ventas.' },
  { key: 'netDebtEbitda', label: 'Deuda neta / EBITDA', short: 'DN/EBITDA', group: 'Deuda', kind: 'x', better: 'low', help: 'Años de EBITDA para pagar la deuda neta. Negativo = más caja que deuda. Más de 3 es mucha deuda.' },
  { key: 'revGrowth', label: 'Crecimiento de ventas', short: 'Ventas 1a', group: 'Crecimiento', kind: 'pct', better: 'high', help: 'Ventas de los últimos 12 meses frente a los 12 anteriores.' },
  { key: 'epsGrowth', label: 'Crecimiento del beneficio', short: 'Benef. 1a', group: 'Crecimiento', kind: 'pct', better: 'high', help: 'Beneficio neto de los últimos 12 meses frente a los 12 anteriores.' },
  { key: 'mom12', label: 'Subida en 12 meses', short: 'Precio 12m', group: 'Crecimiento', kind: 'pct', better: 'high', help: 'Cambio del precio en un año (solo empresas con precios diarios: S&P 500).' }
];
const DEFAULT_PICK: MetricKey[] = ['pe', 'evEbitda', 'pb', 'divYield', 'fcfYield', 'roe', 'netDebtEbitda', 'revGrowth'];

type Row = { symbol: string; name: string; sector: string | null; industry: string | null; priceUsd: number | null; marketCapUsd: number; metrics: Partial<Record<MetricKey, number | null>>; annualOnly: boolean };
type Data = {
  run: { id: string; runDate: string; period: string; companies: number } | null;
  runs: Array<{ id: string; runDate: string }>;
  fund: string; funds: Array<{ id: string; label: string }>;
  rows: Row[]; theses: Array<{ symbol: string; stance: number }>;
  job: { running: boolean };
};
type Thesis = { symbol: string; name: string; stance: number; thesis: string; targetPrice: number | null; priceAtWrite: number | null; createdAt: string; updatedAt: string; price?: number | null };
type Company = {
  symbol: string; price: number | null; thesis: Thesis | null;
  history: Array<{ runDate: string; period: string; name: string; sector: string | null; industry: string | null; priceUsd: number | null; marketCapUsd: number; metrics: Partial<Record<MetricKey, number | null>>; raw: Record<string, number | boolean | null> }>;
};
type Scored = Row & { score: number | null; pct: Partial<Record<MetricKey, number>> };
type JobEvent = { text: string; level: 'info' | 'ok' | 'warn' };

/**
 * "Valoraciones": the usual valuation metrics of every company of a fund, as they were on the day of each weekly
 * photo. The user picks the metrics: they become the columns and a combined score (average percentile, each one
 * in its good direction). Plus the user's investment theses. Not investment advice.
 */
@Component({
  selector: 'app-valuations-page',
  standalone: true,
  imports: [FormsModule, ViewToggleComponent],
  templateUrl: './valuations-page.component.html',
  styleUrl: './valuations-page.component.css'
})
export class ValuationsPageComponent implements OnDestroy {
  private readonly confirmDialog = inject(ConfirmService);
  private readonly http = inject(HttpClient);
  protected readonly day = formatDay;
  protected readonly METRICS = METRICS;
  protected readonly groups = [...new Set(METRICS.map((m) => m.group))];

  protected readonly fund = signal(read(FUND_KEY, 'sp500'));
  protected readonly runId = signal<string | null>(null);
  protected readonly data = signal<Data | null>(null);
  protected readonly theses = signal<Thesis[]>([]);
  protected readonly company = signal<Company | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly running = signal(false);
  protected readonly events = signal<JobEvent[]>([]);

  protected readonly picked = signal<MetricKey[]>(readPick());
  protected readonly search = signal('');
  protected readonly sector = signal('');
  protected readonly complete = signal(false);
  protected readonly sortKey = signal<'score' | MetricKey | 'marketCapUsd'>('score');
  protected readonly sortDesc = signal(true);
  protected readonly view = signal<ListView>('table');
  protected readonly showMetrics = signal(false);

  /** Thesis editor of the open company. */
  protected draft = { stance: 1, thesis: '', targetPrice: null as number | null };
  protected readonly saving = signal(false);

  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.load();
    void this.loadTheses();
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
  }

  protected async load(): Promise<void> {
    try {
      const params: Record<string, string> = { fund: this.fund() };
      if (this.runId()) params['run'] = this.runId()!;
      const d = await firstValueFrom(this.http.get<Data>(`${API}/valuations`, { params }));
      this.data.set(d);
      this.error.set(null);
      if (d.job.running && !this.poll) this.watch();
    } catch {
      this.error.set('No se han podido cargar las valoraciones. ¿Está el backend arrancado?');
    }
  }

  private async loadTheses(): Promise<void> {
    try {
      this.theses.set((await firstValueFrom(this.http.get<{ theses: Thesis[] }>(`${API}/theses`))).theses);
    } catch {
      this.theses.set([]);
    }
  }

  protected pickFund(f: string): void {
    this.fund.set(f);
    this.sector.set('');
    write(FUND_KEY, f);
    void this.load();
  }

  protected pickRun(id: string): void {
    this.runId.set(id);
    void this.load();
  }

  protected toggle(k: MetricKey): void {
    const cur = this.picked();
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    this.picked.set(METRICS.map((m) => m.key).filter((key) => next.includes(key)));
    write(PICK_KEY, JSON.stringify(this.picked()));
    if (this.sortKey() !== 'score' && this.sortKey() !== 'marketCapUsd' && !next.includes(this.sortKey() as MetricKey)) this.sortKey.set('score');
  }

  protected resetPick(): void {
    this.picked.set([...DEFAULT_PICK]);
    write(PICK_KEY, JSON.stringify(DEFAULT_PICK));
  }

  protected sortBy(k: 'score' | MetricKey | 'marketCapUsd'): void {
    if (this.sortKey() === k) this.sortDesc.set(!this.sortDesc());
    else {
      this.sortKey.set(k);
      // First click: the "good" side on top.
      const m = METRICS.find((x) => x.key === k);
      this.sortDesc.set(!m || m.better === 'high');
    }
  }

  protected async refresh(): Promise<void> {
    await firstValueFrom(this.http.post(`${API}/valuations/refresh`, {}));
    this.watch();
  }

  private watch(): void {
    this.running.set(true);
    if (this.poll) clearInterval(this.poll);
    this.poll = setInterval(async () => {
      try {
        const j = await firstValueFrom(this.http.get<{ running: boolean; events: JobEvent[] }>(`${API}/valuations/job`));
        this.events.set(j.events);
        if (!j.running) {
          clearInterval(this.poll!);
          this.poll = null;
          this.running.set(false);
          this.runId.set(null);
          await this.load();
        }
      } catch {
        /* backend restarting */
      }
    }, 2000);
  }

  protected metric(k: MetricKey): Metric {
    return METRICS.find((m) => m.key === k)!;
  }

  protected readonly sectors = computed(() => [...new Set((this.data()?.rows ?? []).map((r) => r.sector ?? 'Otros'))].sort());
  protected readonly thesisOf = computed(() => new Map((this.data()?.theses ?? []).map((t) => [t.symbol, t.stance])));

  /** Rows of the fund after the filters, with the percentile of each picked metric and the combined score. */
  protected readonly scored = computed<Scored[]>(() => {
    const term = this.search().trim().toLowerCase();
    const sector = this.sector();
    const picked = this.picked();
    let rows = (this.data()?.rows ?? []).filter((r) =>
      (!term || r.symbol.toLowerCase().includes(term) || r.name.toLowerCase().includes(term)) &&
      (!sector || (r.sector ?? 'Otros') === sector)
    );
    if (this.complete()) rows = rows.filter((r) => picked.every((k) => r.metrics[k] != null));
    // Percentile 0..1 inside the filtered rows, 1 = best side of the metric.
    const pct = new Map<string, Partial<Record<MetricKey, number>>>();
    for (const r of rows) pct.set(r.symbol, {});
    for (const k of picked) {
      const m = this.metric(k);
      const vals = rows.filter((r) => r.metrics[k] != null).sort((a, b) => a.metrics[k]! - b.metrics[k]!);
      vals.forEach((r, i) => {
        const p = vals.length > 1 ? i / (vals.length - 1) : 0.5;
        pct.get(r.symbol)![k] = m.better === 'high' ? p : 1 - p;
      });
    }
    return rows.map((r) => {
      const ps = pct.get(r.symbol)!;
      const known = picked.filter((k) => ps[k] != null).length;
      // A missing metric counts as a bad one (percentile 25): it is often missing because the company loses money.
      // A company needs at least half of the picked metrics to get a score.
      const score = picked.length && known >= Math.ceil(picked.length / 2)
        ? picked.reduce((s, k) => s + (ps[k] ?? 0.25), 0) / picked.length
        : null;
      return { ...r, pct: ps, score };
    });
  });

  protected readonly rows = computed(() => {
    const k = this.sortKey();
    const desc = this.sortDesc();
    const val = (r: Scored) => (k === 'score' ? r.score : k === 'marketCapUsd' ? r.marketCapUsd : r.metrics[k]) ?? null;
    return [...this.scored()].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va == null && vb == null) return b.marketCapUsd - a.marketCapUsd;
      if (va == null) return 1;
      if (vb == null) return -1;
      return desc ? vb - va : va - vb;
    });
  });

  /** Median of each picked metric in the filtered rows. */
  protected readonly medians = computed(() => {
    const out: Partial<Record<MetricKey, number | null>> = {};
    for (const k of this.picked()) {
      const v = this.scored().map((r) => r.metrics[k]).filter((x): x is number => x != null).sort((a, b) => a - b);
      out[k] = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
    }
    return out;
  });

  protected fmt(k: MetricKey, v: number | null | undefined): string {
    if (v == null) return '—';
    const m = this.metric(k);
    if (m.kind === 'pct') return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0).replace('.', ',')} %`;
    return `${v.toFixed(Math.abs(v) < 10 ? 1 : 0).replace('.', ',')}x`;
  }

  /** Cell tint from the percentile: green = good side, red = bad side. */
  protected tint(p: number | undefined): string {
    if (p == null) return 'transparent';
    const d = p - 0.5;
    const a = Math.min(0.5, Math.abs(d) * 0.9);
    return d >= 0 ? `rgba(34, 160, 90, ${a})` : `rgba(220, 80, 50, ${a})`;
  }

  protected money(v: number | null | undefined): string {
    if (v == null) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e12) return `${(v / 1e12).toFixed(2).replace('.', ',')} B$`;
    if (abs >= 1e9) return `${(v / 1e9).toFixed(1).replace('.', ',')} mil M$`;
    return `${(v / 1e6).toFixed(0)} M$`;
  }

  protected price(v: number | null | undefined): string {
    return v == null ? '—' : `${v.toFixed(2).replace('.', ',')} $`;
  }

  protected change(from: number | null | undefined, to: number | null | undefined): number | null {
    return from && to ? to / from - 1 : null;
  }

  protected signed(v: number | null): string {
    return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')} %`;
  }

  protected stanceLabel(s: number): string {
    return s > 0 ? 'Alcista' : s < 0 ? 'Bajista' : 'En vigilancia';
  }

  // ---------------- company detail and thesis

  protected async open(symbol: string): Promise<void> {
    if (this.company()?.symbol === symbol) {
      this.company.set(null);
      return;
    }
    try {
      const c = await firstValueFrom(this.http.get<Company>(`${API}/valuations/company/${encodeURIComponent(symbol)}`));
      this.company.set(c);
      this.draft = { stance: c.thesis?.stance ?? 1, thesis: c.thesis?.thesis ?? '', targetPrice: c.thesis?.targetPrice ?? null };
      setTimeout(() => document.getElementById('valuation-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch {
      this.error.set(`No se ha podido abrir ${symbol}.`);
    }
  }

  /** Every metric of the open company with its percentile in the current list (all rows, not only picked). */
  protected readonly detailMetrics = computed(() => {
    const c = this.company();
    if (!c) return [];
    const now = c.history[0];
    const rows = this.data()?.rows ?? [];
    return METRICS.map((m) => {
      const v = now.metrics[m.key] ?? null;
      const vals = rows.map((r) => r.metrics[m.key]).filter((x): x is number => x != null).sort((a, b) => a - b);
      let p: number | undefined;
      if (v != null && vals.length > 1) {
        const below = vals.filter((x) => x < v).length;
        p = below / (vals.length - 1);
        if (m.better === 'low') p = 1 - p;
      }
      const med = vals.length ? vals[Math.floor(vals.length / 2)] : null;
      return { ...m, value: v, pct: p, median: med };
    });
  });

  protected async saveThesis(): Promise<void> {
    const c = this.company();
    if (!c) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.http.put(`${API}/theses/${encodeURIComponent(c.symbol)}`, this.draft));
      await Promise.all([this.loadTheses(), this.load()]);
      const fresh = await firstValueFrom(this.http.get<Company>(`${API}/valuations/company/${encodeURIComponent(c.symbol)}`));
      this.company.set(fresh);
    } catch {
      this.error.set('No se ha podido guardar la tesis.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteThesis(): Promise<void> {
    const c = this.company();
    if (!c?.thesis || !(await this.confirmDialog.ask(`¿Borrar tu tesis de ${c.symbol}?`))) return;
    await firstValueFrom(this.http.delete(`${API}/theses/${encodeURIComponent(c.symbol)}`));
    this.draft = { stance: 1, thesis: '', targetPrice: null };
    this.company.set({ ...c, thesis: null });
    await Promise.all([this.loadTheses(), this.load()]);
  }
}

function read(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* blocked storage: the choice lasts this visit */
  }
}

function readPick(): MetricKey[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PICK_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.every((k) => METRICS.some((m) => m.key === k))) return saved;
  } catch {
    /* ignore */
  }
  return [...DEFAULT_PICK];
}
