import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { PortfolioStore } from '../../core/portfolio.store';
import { BenchmarkData, TYPE_COLORS } from '../../core/portfolio.models';
import { MultiSelectComponent, MultiOption } from '../../shared/multi-select.component';
import { formatDay, formatMoney0, formatSignedMoney, formatSignedPercent, signClass } from '../../shared/format.utils';
import { CompareChartComponent, CompareLine } from './compare-chart.component';
import { addDays, axisOf, indexCurve, portfolioCurve, SameMoney, sameMoney, SeriesPoint, Stats, statsOf } from './compare.engine';

type Mode = 'all' | 'bank' | 'type';
type Period = '1M' | '3M' | 'YTD' | '1A' | '3A' | '5A' | 'ALL';
type Saved = { mode: Mode; bench: string[]; period: Period; ref: string; banks: string[]; types: string[] };

const KEY = 'finanzas.compare';
const DEFAULTS: Saved = { mode: 'all', bench: ['sp500', 'msci-world'], period: '1A', ref: 'sp500', banks: [], types: [] };
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: '1M', label: '1M' }, { id: '3M', label: '3M' }, { id: 'YTD', label: 'YTD' }, { id: '1A', label: '1A' },
  { id: '3A', label: '3A' }, { id: '5A', label: '5A' }, { id: 'ALL', label: 'Todo' },
];
const BENCH_COLORS: Record<string, string> = {
  'sp500': '#ef4444', 'msci-world': '#0ea5e9', 'msci-acwi': '#14b8a6', 'nasdaq100': '#a855f7', 'msci-em': '#f59e0b',
  'eurostoxx50': '#3b82f6', 'ibex35': '#e11d48', 'bonds': '#64748b', 'gold': '#ca8a04', 'bitcoin': '#f97316', '60-40': '#10b981',
};
const BANK_COLORS = ['#6366f1', '#0891b2', '#d946ef', '#16a34a', '#ea580c', '#2563eb', '#be123c', '#65a30d', '#7c3aed'];

/** A line of the comparison: a part of the portfolio or an index, with its curve over the axis and its figures. */
type Row = {
  id: string; label: string; color: string; kind: 'mine' | 'index'; note?: string;
  curve: number[]; stats: Stats;
  /** Part of the portfolio that started (had money) after the start of the period. */
  since?: string;
  /** Index in the axis where its figures start (the day before `since`, or 0): indexes are compared from there too. */
  startIdx: number;
};

/**
 * "Comparar": the portfolio, a bank or a type of asset against the best known indexes (S&P 500, MSCI World…), with
 * the same yardstick (TTWROR vs. the index in euros with dividends). See compare.engine.ts for the maths.
 */
@Component({
  selector: 'app-compare-page',
  standalone: true,
  imports: [MultiSelectComponent, CompareChartComponent],
  templateUrl: './compare-page.component.html',
  styleUrl: './compare-page.component.css'
})
export class ComparePageComponent {
  private readonly api = inject(PortfolioApi);
  protected readonly store = inject(PortfolioStore);
  protected readonly PERIODS = PERIODS;
  protected readonly Math = Math;
  protected readonly money = formatMoney0;
  protected readonly signedMoney = formatSignedMoney;
  protected readonly day = formatDay;
  protected readonly sign = signClass;
  protected readonly pct = (v: number | null, d = 1) => (v === null ? '—' : formatSignedPercent(v, d));
  protected readonly plain = (v: number | null) => (v === null ? '—' : `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`);
  protected readonly pp = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} p.p.`;

  private readonly saved = readSaved();
  protected readonly mode = signal<Mode>(this.saved.mode);
  protected readonly bench = signal<string[]>(this.saved.bench);
  protected readonly period = signal<Period>(this.saved.period);
  protected readonly ref = signal<string>(this.saved.ref);
  protected readonly pickBanks = signal<string[]>(this.saved.banks);
  protected readonly pickTypes = signal<string[]>(this.saved.types);
  /** Part of the portfolio of the "Con el mismo dinero" box. */
  protected readonly moneyOf = signal<string>('all');
  /** Lines hidden by a click on the legend. */
  protected readonly hidden = signal<string[]>([]);

  protected readonly benchmarks = signal<BenchmarkData[]>([]);
  protected readonly benchError = signal<string | null>(null);
  protected readonly benchLoading = signal(true);
  /** Series of each bank / type, loaded on demand ("bank:<id>", "type:<code>"). */
  private readonly segSeries = signal<Record<string, SeriesPoint[]>>({});
  protected readonly segLoading = signal(false);

  constructor() {
    // Indexes: once, from the first day of the portfolio (a little before, for the close of the day before).
    effect(() => {
      const first = this.store.overview()?.series[0]?.date;
      if (!first || untracked(() => this.benchmarks().length)) return;
      this.api.benchmarks(addDays(first.slice(0, 10), -10))
        .then((r) => {
          this.benchmarks.set(r.benchmarks);
          if (r.failed.length) this.benchError.set(`Sin datos ahora mismo de: ${r.failed.join(', ')}.`);
        })
        .catch(() => this.benchError.set('No se pudieron cargar los índices. Prueba en un rato.'))
        .finally(() => this.benchLoading.set(false));
    });
    // Series of the banks or types shown (again after any change in the portfolio: store.version).
    effect(() => {
      this.store.version();
      const keys = this.segments().map((s) => s.key).filter((k) => k !== 'all');
      void this.loadSegments(keys);
    });
    effect(() => {
      const s: Saved = { mode: this.mode(), bench: this.bench(), period: this.period(), ref: this.ref(), banks: this.pickBanks(), types: this.pickTypes() };
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
    });
  }

  private loadedVersion = -1;
  private async loadSegments(keys: string[]): Promise<void> {
    const version = untracked(() => this.store.version());
    if (version !== this.loadedVersion) {
      this.loadedVersion = version;
      this.segSeries.set({});
    }
    const have = untracked(() => this.segSeries());
    const missing = keys.filter((k) => !have[k]);
    if (!missing.length) return;
    this.segLoading.set(true);
    try {
      const got = await Promise.all(missing.map(async (k) => {
        const [kind, id] = k.split(':');
        return [k, await this.api.series(kind === 'bank' ? [id] : [], kind === 'type' ? [id] : [])] as const;
      }));
      this.segSeries.update((m) => ({ ...m, ...Object.fromEntries(got) }));
    } finally {
      this.segLoading.set(false);
    }
  }

  // ---------------------------------------------------------------- options

  /** Banks and types with something that is not cash (the "Reinversión" account alone is not compared). */
  protected readonly bankOptions = computed<MultiOption[]>(() => {
    const assets = this.store.assets().filter((a) => !a.isLiquidity);
    return this.store.banks().filter((b) => assets.some((a) => a.bankId === b.id))
      .map((b, i) => ({ id: b.id, label: b.name, color: BANK_COLORS[i % BANK_COLORS.length] }));
  });
  protected readonly typeOptions = computed<MultiOption[]>(() => {
    const assets = this.store.assets().filter((a) => !a.isLiquidity);
    return this.store.types().filter((t) => !t.isLiquidity && assets.some((a) => a.typeCode === t.code))
      .map((t) => ({ id: t.code, label: t.name, color: TYPE_COLORS[t.code] }));
  });
  protected readonly benchOptions = computed<MultiOption[]>(() =>
    this.benchmarks().map((b) => ({ id: b.id, label: b.name, color: BENCH_COLORS[b.id], hint: b.group === 'Otros' ? 'otros' : '' })));

  /** Parts of the portfolio being compared ("all" is always there, as the reference line). */
  protected readonly segments = computed(() => {
    const all = { key: 'all', label: 'Toda la cartera', color: this.mode() === 'all' ? '#6366f1' : 'var(--text-2)' };
    if (this.mode() === 'bank') {
      const pick = this.pickBanks();
      return [all, ...this.bankOptions().filter((o) => !pick.length || pick.includes(o.id)).map((o) => ({ key: `bank:${o.id}`, label: o.label, color: o.color! }))];
    }
    if (this.mode() === 'type') {
      const pick = this.pickTypes();
      return [all, ...this.typeOptions().filter((o) => !pick.length || pick.includes(o.id)).map((o) => ({ key: `type:${o.id}`, label: o.label, color: o.color! }))];
    }
    return [all];
  });

  private readonly chosenBench = computed(() => {
    const pick = this.bench();
    return this.benchmarks().filter((b) => !pick.length || pick.includes(b.id));
  });

  // ---------------------------------------------------------------- period and figures

  private readonly whole = computed<SeriesPoint[]>(() => this.store.overview()?.series ?? []);

  protected readonly from = computed(() => {
    const s = this.whole();
    if (!s.length) return '';
    const last = s[s.length - 1].date.slice(0, 10);
    const y = Number(last.slice(0, 4));
    const back = (months: number) => {
      const d = new Date(last + 'T12:00:00Z');
      d.setUTCMonth(d.getUTCMonth() - months);
      return addDays(d.toISOString().slice(0, 10), 1);
    };
    switch (this.period()) {
      case '1M': return back(1);
      case '3M': return back(3);
      case 'YTD': return `${y}-01-01`;
      case '1A': return back(12);
      case '3A': return back(36);
      case '5A': return back(60);
      default: return s[0].date.slice(0, 10);
    }
  });

  protected readonly axis = computed(() => axisOf(this.whole(), this.from()));

  protected readonly rows = computed<Row[]>(() => {
    const axis = this.axis();
    if (axis.length < 2) return [];
    const series = this.segSeries();
    const mine: Row[] = [];
    for (const s of this.segments()) {
      const points = s.key === 'all' ? this.whole() : series[s.key];
      if (!points?.length) continue;
      const inPeriod = points.filter((p) => p.date.slice(0, 10) >= axis[0]);
      if (!inPeriod.some((p) => p.value > 0)) continue; // nothing in this bank / type during the period
      const curve = portfolioCurve(points, axis);
      const startValue = inPeriod[0]?.date.slice(0, 10) === axis[0] ? inPeriod[0].value : 0;
      const firstWithMoney = inPeriod.find((p) => p.value > 0)?.date.slice(0, 10);
      const since = startValue <= 0 && firstWithMoney && firstWithMoney > axis[0] ? firstWithMoney : undefined;
      // Started later: its figures (and the indexes it is compared with) count from the day before it had money.
      const startIdx = since ? Math.max(0, axis.indexOf(since) - 1) : 0;
      mine.push({
        id: s.key, label: s.label, color: s.color, kind: 'mine', curve, since, startIdx,
        stats: statsOf(curve.slice(startIdx), axis.slice(startIdx)),
      });
    }
    const indexes: Row[] = [];
    for (const b of this.chosenBench()) {
      const curve = indexCurve(b.closes, axis);
      if (!curve) continue;
      indexes.push({ id: b.id, label: b.name, color: BENCH_COLORS[b.id] ?? '#94a3b8', kind: 'index', note: b.note, curve, stats: statsOf(curve, axis), startIdx: 0 });
    }
    return [...mine, ...indexes];
  });

  /** Indexes left out because they did not exist yet at the start of the period. */
  protected readonly tooYoung = computed(() => {
    const start = this.axis()[0];
    return this.chosenBench().filter((b) => b.first && start && b.first > start).map((b) => `${b.name} (desde ${formatDay(b.first!)})`);
  });

  protected readonly lines = computed<CompareLine[]>(() => {
    const hidden = this.hidden();
    return this.rows().filter((r) => !hidden.includes(r.id)).map((r) => ({
      id: r.id, label: r.label, color: r.color, values: r.curve, dashed: r.kind === 'index', bold: r.id === 'all',
    }));
  });

  /** The index the "vs." column and the headline use: the chosen one, or the first shown. */
  protected readonly refRow = computed<Row | null>(() => {
    const idx = this.rows().filter((r) => r.kind === 'index');
    return idx.find((r) => r.id === this.ref()) ?? idx[0] ?? null;
  });
  protected readonly indexRows = computed(() => this.rows().filter((r) => r.kind === 'index'));

  protected readonly headline = computed(() => {
    const mine = this.rows().find((r) => r.id === 'all');
    const ref = this.refRow();
    if (!mine || !ref) return null;
    return { mine: mine.stats.total, ref: ref.stats.total, refName: ref.label, ahead: (mine.stats.total - ref.stats.total) * 100 };
  });

  /** How many of the indexes shown the selected part beats. */
  protected readonly beaten = computed(() => {
    const mine = this.rows().find((r) => r.id === 'all');
    const idx = this.indexRows();
    if (!mine || !idx.length) return null;
    return { won: idx.filter((r) => mine.stats.total > r.stats.total).length, of: idx.length };
  });

  // ---------------------------------------------------------------- same money

  protected readonly moneyOptions = computed(() => this.rows().filter((r) => r.kind === 'mine'));

  protected readonly same = computed(() => {
    const axis = this.axis();
    const key = this.moneyOptions().some((r) => r.id === this.moneyOf()) ? this.moneyOf() : 'all';
    const points = key === 'all' ? this.whole() : this.segSeries()[key];
    if (!points?.length || axis.length < 2) return null;
    const label = this.moneyOptions().find((r) => r.id === key)?.label ?? '';
    const out: Array<{ id: string; label: string; color: string; r: SameMoney }> = [];
    for (const b of this.chosenBench()) {
      const r = sameMoney(points, b.closes, axis);
      if (r) out.push({ id: b.id, label: b.name, color: BENCH_COLORS[b.id], r });
    }
    if (!out.length) return null;
    return { key, label, put: out[0].r.put, real: out[0].r.real, items: out.sort((a, b) => b.r.inIndex - a.r.inIndex) };
  });

  // ---------------------------------------------------------------- actions

  protected toggleLine(id: string): void {
    this.hidden.update((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  }

  protected setBench(ids: string[]): void {
    this.bench.set(ids);
  }

  /** Percentage points ahead of the reference index, over the same days (a bank or type may start later). */
  protected vs(r: Row): number | null {
    const ref = this.refRow();
    if (!ref || r.id === ref.id) return null;
    const c = ref.curve;
    const refTotal = c[c.length - 1] / c[r.startIdx] - 1;
    return (r.stats.total - refTotal) * 100;
  }
}

function readSaved(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s === 'object') return { ...DEFAULTS, ...s };
  } catch {
    /* storage blocked or bad JSON */
  }
  return { ...DEFAULTS };
}
