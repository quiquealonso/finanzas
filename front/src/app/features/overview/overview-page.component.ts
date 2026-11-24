import { Component, computed, effect, inject, signal } from '@angular/core';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { AssetRow, IntradayData, TYPE_COLORS } from '../../core/portfolio.models';
import { DonutChartComponent, DonutSegment } from '../../shared/donut-chart.component';
import { ListView, ViewToggleComponent } from '../../shared/view-toggle.component';
import { PortfolioStore } from '../../core/portfolio.store';
import { LineChartComponent } from '../../shared/line-chart.component';
import { AssetFilterComponent } from '../../shared/asset-filter.component';
import {
  formatDay,
  formatMonth,
  formatMoney,
  formatMoney0,
  formatSignedMoney,
  formatSignedPercent,
  signClass
} from '../../shared/format.utils';

type Range = '1D' | '1S' | '1M' | '3M' | 'YTD' | '1A' | 'ALL' | 'CUSTOM';
type Point = { date: string; value: number; cost: number; realized: number; result: number; opening?: number };

/**
 * Result of a period from the point before it starts (start) to its last point (end). Every result figure of the
 * app uses this, so they all agree with each other and with the calendar:
 *   - gain: change of the running daily result (price moves only; buying, selling or paying in never count).
 *   - contributed: money that came in or out at market value (value change not explained by the gain), including
 *     positions loaded with an opening balance.
 *   - pct: Modified Dietz, the usual way to measure a return with money coming in: gain over the start value plus
 *     each contribution weighted by the share of the period it was invested.
 *   - startValue: value at the start plus the positions loaded later with an opening balance (`opening`): they
 *     were already held, only not tracked yet, so they count as there from the start and not as money put in.
 */
function periodStats(points: Point[]) {
  const start = points[0];
  const end = points[points.length - 1];
  const day = (d: string) => Date.parse(d.slice(0, 10) + 'T12:00:00Z') / 86_400_000;
  const span = Math.max(1, day(end.date) - day(start.date));
  let base = start.value, contributed = 0, opened = 0;
  for (let i = 1; i < points.length; i++) {
    const flow = points[i].value - points[i - 1].value - (points[i].result - points[i - 1].result);
    const open = points[i].opening ?? 0;
    opened += open;
    contributed += flow - open;
    base += open + (flow - open) * Math.max(0, (day(end.date) - day(points[i].date)) / span);
  }
  const gain = end.result - start.result;
  return {
    start, end, gain, contributed, base, startValue: start.value + opened,
    realized: (end.realized ?? 0) - (start.realized ?? 0),
    pct: base > 0 ? gain / base : 0
  };
}

/**
 * Two standard returns of a period, from the same daily points (start = the point before the period):
 *   - ttwror: true time-weighted rate of return. Daily returns chained, so money coming in or out never moves it:
 *     the one to compare with an index. Daily return = gain of the day / (value the day before + money put in that
 *     day), as if the money came in at the start of the day (keeps a first day with a buy sane).
 *   - irr: internal rate of return (XIRR), annualized. Start value and every contribution as money put in on its
 *     day, end value as money taken out: the return of the money as it really went in. Null under 90 days
 *     (annualizing a few weeks gives meaningless figures) or when it has no solution.
 */
function periodReturns(points: Point[]): { ttwror: number; irr: number | null } {
  const day = (d: string) => Date.parse(d.slice(0, 10) + 'T12:00:00Z') / 86_400_000;
  let growth = 1;
  const flows: Array<{ t: number; amount: number }> = [{ t: day(points[0].date), amount: -points[0].value }];
  for (let i = 1; i < points.length; i++) {
    const gain = points[i].result - points[i - 1].result;
    const flow = points[i].value - points[i - 1].value - gain;
    const base = points[i - 1].value + Math.max(0, flow);
    if (base > 0) growth *= 1 + gain / base;
    // Opening balances were already held: in at the start of the period, not on the day they were loaded.
    const open = points[i].opening ?? 0;
    if (open) flows.push({ t: flows[0].t, amount: -open });
    if (Math.abs(flow - open) > 0.005) flows.push({ t: day(points[i].date), amount: -(flow - open) });
  }
  const end = points[points.length - 1];
  flows.push({ t: day(end.date), amount: end.value });
  const span = day(end.date) - flows[0].t;
  return { ttwror: growth - 1, irr: span >= 90 ? xirr(flows) : null };
}

/** Annual rate that makes the net present value of the flows zero (bisection: robust, no starting guess). */
function xirr(flows: Array<{ t: number; amount: number }>): number | null {
  const t0 = flows[0].t;
  const npv = (r: number) => flows.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.t - t0) / 365), 0);
  let lo = -0.99, hi = 10;
  let fLo = npv(lo), fHi = npv(hi);
  if (!isFinite(fLo) || !isFinite(fHi) || fLo * fHi > 0) return null;
  for (let i = 0; i < 200 && hi - lo > 1e-7; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (fMid * fLo > 0) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

/** The points of a period: the last one before `from` (its start) and every one from `from` on. */
function pointsFrom(all: Point[], from: string): Point[] {
  const idx = all.findIndex((p) => p.date >= from);
  if (idx < 0) return [];
  return all.slice(Math.max(0, idx - 1));
}
/** Colours of the banks in the round chart (in order of value). */
const BANK_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#65a30d', '#64748b', '#be123c', '#0d9488', '#a16207'];

@Component({
  selector: 'app-overview-page',
  standalone: true,
  imports: [LineChartComponent, AssetFilterComponent, DonutChartComponent, ViewToggleComponent],
  templateUrl: './overview-page.component.html',
  styleUrl: './overview-page.component.css'
})
export class OverviewPageComponent {
  protected readonly store = inject(PortfolioStore);
  private readonly api = inject(PortfolioApi);

  protected readonly range = signal<Range>('1D');
  protected readonly ranges: Array<{ id: Range; label: string }> = [
    { id: '1D', label: '1D' },
    { id: '1S', label: '1S' },
    { id: '1M', label: '1M' },
    { id: '3M', label: '3M' },
    { id: 'YTD', label: 'YTD' },
    { id: '1A', label: '1A' },
    { id: 'ALL', label: 'Todo' },
    { id: 'CUSTOM', label: 'Personalizado' }
  ];
  protected readonly rangeTitles: Partial<Record<Range, string>> = {
    YTD: 'Año hasta hoy: desde el 1 de enero',
    '1A': 'Un año: los últimos 12 meses',
    ALL: 'Desde el primer día con datos',
    CUSTOM: 'Elige las fechas de inicio y fin'
  };

  /** First and last day with data: the limits of the custom range. */
  protected readonly firstDay = computed(() => this.baseSeries()[0]?.date.slice(0, 10) ?? '');
  protected readonly lastDay = computed(() => {
    const s = this.baseSeries();
    return s.length ? s[s.length - 1].date.slice(0, 10) : '';
  });
  /** Custom range; empty means "not chosen yet": 3 months back up to the last day. */
  private readonly customFromSet = signal('');
  private readonly customToSet = signal('');
  protected readonly customTo = computed(() => this.customToSet() || this.lastDay());
  protected readonly customFrom = computed(() => {
    if (this.customFromSet()) return this.customFromSet();
    const last = this.lastDay();
    if (!last) return '';
    const d = new Date(`${last}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 3);
    const from = d.toISOString().slice(0, 10);
    return from < this.firstDay() ? this.firstDay() : from;
  });

  protected setCustom(which: 'from' | 'to', value: string): void {
    if (!value) return;
    if (which === 'from') {
      this.customFromSet.set(value);
      if (value > this.customTo()) this.customToSet.set(value);
    } else {
      this.customToSet.set(value);
      if (value < this.customFrom()) this.customFromSet.set(value);
    }
  }
  protected readonly monthView = signal<ListView>('table');
  protected readonly syncing = signal(false);
  protected readonly intraday = signal<IntradayData | null>(null);

  constructor() {
    // Hourly points are only needed for the 1D view; reload them after any change.
    effect(() => {
      this.store.version();
      if (this.range() === '1D') void this.loadIntraday();
    });
    effect(() => {
      this.store.version();
      const banks = this.bankFilter(), types = this.typeFilter();
      if (banks.length || types.length) void this.loadFilteredSeries(banks, types);
      else this.filteredSeries.set(null);
    });
  }

  // ---- Bank / type filter (same component as Activos) ----
  protected readonly bankFilter = signal<string[]>([]);
  protected readonly typeFilter = signal<string[]>([]);
  protected readonly filtering = computed(() => this.bankFilter().length > 0 || this.typeFilter().length > 0);
  /** Series of the selected assets, loaded from the back when the filter changes (null = loading or no filter). */
  private readonly filteredSeries = signal<Point[] | null>(null);
  protected readonly loadingSeries = signal(false);
  private seriesRequest = 0;

  /** Daily series everything on this page is computed from: the whole portfolio or the selection. */
  protected readonly baseSeries = computed<Point[]>(() =>
    this.filtering() ? (this.filteredSeries() ?? []) : ((this.store.overview()?.series ?? []) as Point[])
  );

  protected picked(a: AssetRow): boolean {
    const banks = this.bankFilter(), types = this.typeFilter();
    return (!banks.length || banks.includes(a.bankId)) && (!types.length || types.includes(a.typeCode));
  }

  /** Totals of the selected assets (null without filter: the overview figures are used). Same maths as Activos. */
  protected readonly selection = computed(() => {
    if (!this.filtering()) return null;
    const matching = this.store.assets().filter((a) => this.picked(a));
    const value = matching.reduce((s, a) => s + a.valueEur, 0);
    const cost = matching.filter((a) => !a.isLiquidity).reduce((s, a) => s + a.costEur, 0);
    const realized = matching.filter((a) => !a.isLiquidity).reduce((s, a) => s + (a.realizedEur ?? 0), 0);
    const pnl = matching.reduce((s, a) => s + a.pnlEur, 0) + realized;
    const day = matching.reduce((s, a) => s + a.dayChangeEur, 0);
    return {
      value, pnl, pnlPct: cost - realized > 0 ? pnl / (cost - realized) : 0,
      day, dayPct: value - day > 0 ? day / (value - day) : 0
    };
  });

  private async loadFilteredSeries(banks: string[], types: string[]): Promise<void> {
    const req = ++this.seriesRequest;
    this.loadingSeries.set(true);
    try {
      const series = (await this.api.series(banks, types)) as Point[];
      if (req === this.seriesRequest) this.filteredSeries.set(series);
    } catch (error) {
      if (req === this.seriesRequest) this.store.error(error, 'No se pudo cargar la serie de la selección.');
    } finally {
      if (req === this.seriesRequest) this.loadingSeries.set(false);
    }
  }

  private async loadIntraday(): Promise<void> {
    try {
      this.intraday.set(await this.api.intraday());
    } catch {
      this.intraday.set(null);
    }
  }

  protected readonly fmt = { formatDay, formatMoney, formatMoney0, formatSignedMoney, formatSignedPercent, signClass };
  protected readonly typeColors = TYPE_COLORS;

  /** Money from sales waiting to be reinvested. */
  protected readonly pendingCash = computed(() =>
    (this.store.overview()?.assets ?? []).filter((a) => a.isLiquidity).reduce((s, a) => s + a.valueEur, 0)
  );

  /**
   * Chart: the dashed line is the money put in net of what sales already returned, so a sale whose
   * money stays pending reinvestment (or is reinvested) doesn't move it.
   */
  protected readonly chartPoints = computed(() =>
    this.series().map((p) => ({ ...p, cost: p.cost - (p.realized ?? 0) }))
  );

  protected readonly series = computed(() => {
    const all = this.baseSeries();
    if (!all.length) return [];
    const last = all[all.length - 1].date;
    const r = this.range();
    let from = '';
    if (r === 'ALL') return all;
    if (r === '1D') {
      const intra = this.filtering() ? null : this.intraday();
      if (intra?.points.length) {
        const hour = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
        const realized = this.store.overview()?.realizedEur ?? 0;
        const points = intra.points.map((p) => ({ date: p.ts, value: p.value, cost: p.cost, realized, label: hour.format(new Date(p.ts)) }));
        const prev = intra.previousClose;
        return prev
          ? [{ date: prev.date, value: prev.value, cost: prev.cost, realized, label: `Cierre ${prev.date.slice(8)}/${prev.date.slice(5, 7)}` }, ...points]
          : points;
      }
      // No hourly data yet: from the close before the last stock market close up to today.
      const closeDay = this.store.overview()?.lastCloseDay;
      const idx = closeDay ? all.findIndex((p) => p.date === closeDay) : all.length - 1;
      return all.slice(Math.max(0, (idx < 0 ? all.length - 1 : idx) - 1));
    }
    if (r === 'CUSTOM') {
      // From the close before the first chosen day, so that day's move counts.
      const to = this.customTo();
      return pointsFrom(all, this.customFrom()).filter((p) => p.date.slice(0, 10) <= to);
    }
    if (r === 'YTD') from = `${last.slice(0, 4)}-01-01`;
    else {
      const d = new Date(`${last}T12:00:00Z`);
      if (r === '1A') d.setUTCFullYear(d.getUTCFullYear() - 1);
      else d.setUTCDate(d.getUTCDate() - (r === '1S' ? 7 : r === '1M' ? 30 : 90));
      from = d.toISOString().slice(0, 10);
    }
    // Starts at the point before the period, so the first day's move counts.
    return pointsFrom(all, from);
  });

  /** Result in the selected period (see periodStats). */
  protected readonly periodResult = computed(() => {
    const s = this.series();
    const o = this.store.overview();
    // One day: the same figure as the "last close" change at the top.
    if (this.range() === '1D' && o) {
      const sel = this.selection();
      return sel
        ? { pnl: sel.day, pct: sel.dayPct, realized: 0, from: '', to: '' }
        : { pnl: o.dayChangeEur, pct: o.dayChangePct, realized: 0, from: '', to: '' };
    }
    if (s.length < 2) return null;
    const p = periodStats(s as Point[]);
    // Whole history: over all the money that was ever in play (start value + net money put in). Modified Dietz
    // inflates it over long periods with large, late contributions.
    if (this.range() === 'ALL') {
      const inPlay = p.startValue + p.contributed;
      return { pnl: p.gain, pct: inPlay > 0 ? p.gain / inPlay : 0, realized: p.realized, from: p.start.date, to: p.end.date };
    }
    return { pnl: p.gain, pct: p.pct, realized: p.realized, from: p.start.date, to: p.end.date };
  });

  /**
   * Yearly returns over the whole history (or of the selection), not of the chart period: TTWROR annualized
   * ((1 + total)^(365 / days) - 1, as it is under a year) and the IRR, already yearly.
   */
  protected readonly annual = computed(() => {
    const all = this.baseSeries() as Point[];
    if (all.length < 2) return null;
    const r = periodReturns(all);
    const day = (d: string) => Date.parse(d.slice(0, 10) + 'T12:00:00Z') / 86_400_000;
    const days = day(all[all.length - 1].date) - day(all[0].date);
    const ttwror = days >= 365 ? Math.pow(1 + r.ttwror, 365 / days) - 1 : r.ttwror;
    return { ttwror, irr: r.irr, from: all[0].date.slice(0, 10), annualized: days >= 365 };
  });

  /** Title of the period figure in the middle of the card. */
  protected readonly periodLabel = computed(() => {
    const labels: Record<Range, string> = {
      '1D': 'Hoy', '1S': 'Última semana', '1M': 'Último mes', '3M': 'Últimos 3 meses',
      YTD: 'Año hasta hoy', '1A': 'Último año', ALL: 'Desde el inicio', CUSTOM: ''
    };
    const r = this.range();
    if (r !== 'CUSTOM') return labels[r];
    const p = this.periodResult();
    return p?.from ? `${formatDay(this.customFrom())} – ${formatDay(p.to)}` : 'Periodo';
  });

  /** Result of every calendar year (see periodStats); money put in or taken out is shown apart. */
  protected readonly years = computed(() => {
    const all = this.baseSeries() as Point[];
    if (!all.length) return [];
    const years = [...new Set(all.map((p) => p.date.slice(0, 4)))];
    return years
      .map((year) => {
        const points = pointsFrom(all, `${year}-01-01`).filter((p) => p.date <= `${year}-12-31`);
        const s = periodStats(points);
        return {
          year,
          partial: s.end.date < `${year}-12-31`,
          from: s.start.date,
          to: s.end.date,
          startValue: s.startValue,
          endValue: s.end.value,
          contributed: s.contributed,
          realized: s.realized,
          total: s.gain,
          pct: s.pct,
          ttwror: periodReturns(points).ttwror
        };
      })
      // A selection may not exist yet in early periods: those rows are all zero.
      .filter((r) => r.startValue > 0 || r.contributed !== 0 || r.total !== 0)
      .reverse();
  });

  /** Same as the years table, month by month. */
  protected readonly months = computed(() => {
    const all = this.baseSeries() as Point[];
    if (!all.length) return [];
    const keys = [...new Set(all.map((p) => p.date.slice(0, 7)))];
    return keys
      .map((month) => {
        const points = pointsFrom(all, `${month}-01`).filter((p) => p.date <= lastDayOf(month));
        const s = periodStats(points);
        // Daily gains of the month (the first point is the close before it).
        const days = points.slice(1).map((p, i) => ({ date: p.date.slice(0, 10), gain: p.result - points[i].result }));
        const moving = days.filter((d) => Math.abs(d.gain) > 0.5);
        const best = moving.length ? moving.reduce((a, b) => (b.gain > a.gain ? b : a)) : null;
        const worst = moving.length ? moving.reduce((a, b) => (b.gain < a.gain ? b : a)) : null;
        return {
          month,
          label: formatMonth(month),
          partial: s.end.date < lastDayOf(month),
          startValue: s.startValue,
          endValue: s.end.value,
          contributed: s.contributed,
          gain: s.gain,
          pct: s.pct,
          ttwror: periodReturns(points).ttwror,
          up: moving.filter((d) => d.gain > 0).length,
          down: moving.filter((d) => d.gain < 0).length,
          best: best && best.gain > 0 ? best : null,
          worst: worst && worst.gain < 0 ? worst : null
        };
      })
      // A selection may not exist yet in early periods: those rows are all zero.
      .filter((r) => r.startValue > 0 || r.contributed !== 0 || r.gain !== 0)
      .reverse();
  });

  protected readonly allocation = computed(() => {
    const o = this.store.overview();
    if (!o || o.totalEur <= 0) return [];
    return o.allocation
      .map((a) => ({ ...a, pct: a.valueEur / o.totalEur, color: TYPE_COLORS[a.code] ?? 'var(--text-3)' }))
      .sort((x, y) => y.valueEur - x.valueEur);
  });

  protected readonly byBank = computed(() => {
    const o = this.store.overview();
    if (!o) return [];
    const map = new Map<string, { name: string; value: number; pnl: number }>();
    for (const a of o.assets) {
      const row = map.get(a.bankId) ?? { name: a.bankName, value: 0, pnl: 0 };
      row.value += a.valueEur;
      row.pnl += a.pnlEur;
      map.set(a.bankId, row);
    }
    return [...map.values()]
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((b, i) => ({ ...b, color: BANK_COLORS[i % BANK_COLORS.length] }));
  });

  protected readonly typeSlices = computed<DonutSegment[]>(() =>
    this.allocation().map((a) => ({ key: a.code, label: a.name, value: a.valueEur, color: a.color }))
  );
  protected readonly bankSlices = computed<DonutSegment[]>(() =>
    this.byBank().map((b) => ({
      key: b.name, label: b.name, value: b.value, color: b.color,
      extra: Math.abs(b.pnl) >= 0.5 ? formatSignedMoney(b.pnl) : undefined, extraClass: signClass(b.pnl)
    }))
  );

  protected lastSyncLabel(): string {
    const sync = this.store.overview()?.lastSync;
    if (!sync?.finishedAt) return 'Precios sin sincronizar';
    const d = new Date(sync.finishedAt);
    const when = d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `Precios del ${when}${sync.assetsFailed ? ` · ${sync.assetsFailed} con error` : ''}`;
  }

  protected async syncNow(): Promise<void> {
    this.syncing.set(true);
    try {
      const r = await this.api.syncPrices();
      await this.store.changed(r.assetsFailed ? `Precios actualizados (${r.assetsFailed} con error)` : 'Precios actualizados');
    } catch (error) {
      this.store.error(error, 'No se pudieron actualizar los precios.');
    } finally {
      this.syncing.set(false);
    }
  }
}

function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
