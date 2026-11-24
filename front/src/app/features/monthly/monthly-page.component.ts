import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { MonthlyData, MonthlyPoint, TYPE_COLORS } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatDay,
  formatMoney0,
  formatMonth,
  formatPrice,
  formatSignedMoney,
  formatSignedPercent,
  signClass
} from '../../shared/format.utils';

type Mode = 'price' | 'change' | 'value' | 'return';
type GroupBy = 'asset' | 'bank' | 'type';

type Cell = { main: string; sub: string | null; tone: number; cls: string } | null;

type Row = {
  id: string;
  name: string;
  bankName: string;
  typeCode: string;
  typeName: string;
  currency: string;
  cells: Cell[];
  first: MonthlyPoint | null;
  now: MonthlyPoint | null;
  priceChange: number | null;
  positionReturn: number | null;
  raw: Array<MonthlyPoint | null>;
  /** Second line under the name (bank for an asset, number of assets for a group). */
  sub: string;
  color: string | null;
  /** Result in the period (calendar rules: price moves and sales; buying or paying in never count). */
  gain: number | null;
  /** Money put in (or taken out, negative) in the period: value change not explained by the gain. */
  contributed: number | null;
  /** Return within the shown period (TTWROR, month by month). */
  periodReturn: number | null;
};

type Stats = { gain: number; contributed: number; pct: number | null };

/**
 * Result of the period, the same figures as the calendar and the overview:
 *   - gain: change of the running result (price moves and sales; buying or paying in never count),
 *   - money put in: value change not explained by the gain,
 *   - pct: TTWROR chained month by month: each month gain / (value at its start + money put in during it), so
 *     money coming in late never blows it up (Modified Dietz does, with monthly columns).
 * Start = first column (0 when the asset didn't exist yet).
 */
function periodStats(raw: Array<MonthlyPoint | null>): Stats {
  const pts = raw.map((p) => ({ value: p?.value ?? 0, result: p?.result ?? 0, known: !!p }));
  if (!pts.some((p) => p.known)) return { gain: 0, contributed: 0, pct: null };
  let growth = 1, any = false;
  for (let i = 1; i < pts.length; i++) {
    const gain = pts[i].result - pts[i - 1].result;
    const flow = pts[i].value - pts[i - 1].value - gain;
    const base = pts[i - 1].value + Math.max(0, flow);
    if (base > 0) { growth *= 1 + gain / base; any = true; }
  }
  const start = pts[0], end = pts[pts.length - 1];
  const gain = end.result - start.result;
  return { gain, contributed: end.value - start.value - gain, pct: any ? growth - 1 : null };
}

function statsFields(s: Stats): { gain: number; contributed: number; periodReturn: number | null } {
  return { gain: s.gain, contributed: s.contributed, periodReturn: s.pct };
}

@Component({
  selector: 'app-monthly-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './monthly-page.component.html',
  styleUrl: './monthly-page.component.css'
})
export class MonthlyPageComponent {
  private readonly api = inject(PortfolioApi);
  protected readonly store = inject(PortfolioStore);

  protected readonly data = signal<MonthlyData | null>(null);
  protected readonly loading = signal(false);
  protected readonly mode = signal<Mode>('price');
  protected readonly groupBy = signal<GroupBy>('bank');
  protected readonly groupOptions: Array<{ id: GroupBy; label: string }> = [
    { id: 'asset', label: 'activo' },
    { id: 'bank', label: 'banco' },
    { id: 'type', label: 'tipo' }
  ];
  /** Banks and types have no price: the price mode falls back to value there. */
  protected readonly effectiveMode = computed<Mode>(() => (this.groupBy() !== 'asset' && this.mode() === 'price' ? 'value' : this.mode()));
  protected readonly visibleModes = computed(() => this.modes.filter((m) => this.groupBy() === 'asset' || m.id !== 'price'));
  /** '' = whole history; otherwise only that calendar year. */
  protected readonly year = signal<string>(new Date().getFullYear().toString());
  protected readonly typeFilter = signal('');
  protected readonly bankFilter = signal('');
  protected readonly hideCash = signal(true);
  protected readonly search = signal('');

  protected readonly modes: Array<{ id: Mode; label: string; hint: string }> = [
    { id: 'price', label: 'Precio', hint: 'Precio del activo el dia 1 de cada mes y su variacion frente al mes anterior.' },
    { id: 'change', label: 'Var. mensual', hint: 'Cuanto ha subido o bajado el precio respecto al mes anterior.' },
    { id: 'value', label: 'Valor', hint: 'Valor de tu posicion en euros el dia 1 de cada mes.' },
    { id: 'return', label: 'Rentabilidad', hint: 'Rentabilidad acumulada de tu posicion (valor frente a lo invertido) en cada mes.' }
  ];

  protected readonly fmt = { formatDay, formatMonth, formatMoney0, formatPrice, formatSignedMoney, formatSignedPercent, signClass };
  protected readonly typeColors = TYPE_COLORS;

  constructor() {
    effect(() => {
      this.store.version();
      void this.load();
    });
  }

  protected readonly columns = computed(() => {
    const d = this.data();
    if (!d) return [];
    const y = this.year();
    const months = y ? d.months.filter((m) => m.startsWith(y)) : d.months;
    const cols = months.map((m) => ({ key: m, label: formatMonth(m), isNow: false }));
    const nextJan = `${Number(y) + 1}-01`;
    if (!y || d.latest.startsWith(y)) {
      cols.push({ key: 'now', label: 'Hoy', isNow: true });
    } else if (d.months.includes(nextJan)) {
      // A past year closes with the 1st of January of the following one.
      cols.push({ key: nextJan, label: `Cierre ${y}`, isNow: true });
    }
    return cols;
  });

  /** A finished year: its last column is the year-end close, not today. */
  protected readonly pastYear = computed(() => !!this.year() && !(this.data()?.latest ?? '').startsWith(this.year()));

  protected readonly years = computed(() => [...new Set((this.data()?.months ?? []).map((m) => m.slice(0, 4)))].reverse());

  protected readonly modeHint = computed(() => {
    const mode = this.effectiveMode();
    if (this.groupBy() === 'asset') return this.modes.find((m) => m.id === mode)?.hint ?? '';
    const what = this.groupBy() === 'bank' ? 'cada banco' : 'cada tipo de activo';
    if (mode === 'change') return `Lo que ha ganado o perdido ${what} cada mes, descontando el dinero que has metido o sacado.`;
    if (mode === 'return') return `Rentabilidad acumulada de ${what}: lo que vale frente a lo invertido.`;
    return `Valor de ${what} en euros el dia 1 de cada mes.`;
  });

  protected readonly rows = computed<Row[]>(() => {
    const assets = this.assetRows();
    const by = this.groupBy();
    if (by === 'asset') return assets;
    const mode = this.effectiveMode();
    const n = this.columns().length;
    const groups = new Map<string, { name: string; color: string | null; rows: Row[] }>();
    for (const a of assets) {
      const key = by === 'bank' ? a.bankName : a.typeCode;
      const g = groups.get(key) ?? {
        name: by === 'bank' ? a.bankName : a.typeName,
        color: by === 'type' ? TYPE_COLORS[a.typeCode] ?? null : null,
        rows: []
      };
      g.rows.push(a);
      groups.set(key, g);
    }
    return [...groups.entries()]
      .map(([key, g]): Row => {
        const raw: Array<MonthlyPoint | null> = Array.from({ length: n }, (_, i) => {
          // Every asset with a point, also sold ones (quantity 0): their result keeps counting.
          const pts = g.rows.map((row) => row.raw[i]).filter((p): p is MonthlyPoint => !!p);
          if (!pts.length) return null;
          return {
            date: pts[0].date, price: 0, currency: 'EUR', priceEur: 0,
            value: pts.reduce((s, p) => s + p.value, 0),
            cost: pts.reduce((s, p) => s + p.cost, 0),
            quantity: pts.filter((p) => p.quantity > 0).length,
            result: pts.reduce((s, p) => s + (p.result ?? 0), 0)
          };
        });
        // Only assets actually held at some point of the period.
        const held = g.rows.filter((row) => row.raw.some((p) => !!p && p.quantity > 0)).length;
        const firstIdx = raw.findIndex((p) => !!p);
        const first = firstIdx >= 0 ? raw[firstIdx] : null;
        const now = raw[raw.length - 1];
        return {
          id: key, name: g.name, bankName: '', typeCode: by === 'type' ? key : '', typeName: '', currency: 'EUR',
          cells: raw.map((p, i) => this.groupCell(mode, p, i > 0 ? raw[i - 1] : null)),
          first, now, priceChange: null,
          positionReturn: now && now.cost > 0 ? now.value / now.cost - 1 : null,
          raw,
          sub: `${held} ${held === 1 ? 'activo' : 'activos'}`,
          color: g.color,
          ...statsFields(periodStats(raw))
        };
      })
      .sort((x, y) => (y.now?.value ?? 0) - (x.now?.value ?? 0));
  });

  private readonly assetRows = computed<Row[]>(() => {
    const d = this.data();
    if (!d) return [];
    const mode = this.effectiveMode();
    const q = this.search().trim().toLowerCase();
    const keys = this.columns().map((c) => c.key);

    return d.assets
      .filter((a) => !this.hideCash() || !a.isLiquidity)
      .filter((a) => !this.typeFilter() || a.typeCode === this.typeFilter())
      .filter((a) => !this.bankFilter() || a.bankName === this.bankFilter())
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.bankName.toLowerCase().includes(q))
      .map((a) => {
        const raw = keys.map((k) => a.points[k] ?? null);
        const firstIdx = raw.findIndex((p) => p && (p.quantity > 0 || mode === 'price' || mode === 'change'));
        const first = firstIdx >= 0 ? raw[firstIdx] : null;
        const now = raw[raw.length - 1];
        const cells = raw.map((p, i) => this.cell(mode, p, i > 0 ? raw[i - 1] : null));
        const priceChange = first && now && first.priceEur > 0 ? now.priceEur / first.priceEur - 1 : null;
        const positionReturn = now && now.cost > 0 ? now.value / now.cost - 1 : null;
        const currency = now?.currency ?? first?.currency ?? 'EUR';
        return {
          id: a.id, name: a.name, bankName: a.bankName, typeCode: a.typeCode, typeName: a.typeName,
          currency, cells, first, now, priceChange, positionReturn, raw,
          sub: a.bankName, color: TYPE_COLORS[a.typeCode] ?? null,
          ...statsFields(periodStats(raw))
        };
      })
      .sort((x, y) => (y.now?.value ?? 0) - (x.now?.value ?? 0));
  });

  /** Footer: portfolio totals per column (only meaningful for value / change / return). */
  protected readonly totals = computed(() => {
    const rows = this.rows();
    const n = this.columns().length;
    const value = Array.from({ length: n }, (_, i) => rows.reduce((s, r) => s + (r.raw[i]?.value ?? 0), 0));
    const cost = Array.from({ length: n }, (_, i) => rows.reduce((s, r) => s + (r.raw[i]?.cost ?? 0), 0));
    // Gains already taken by selling count too (only for the whole portfolio; they can't be split by filter).
    const unfiltered = !this.typeFilter() && !this.bankFilter() && !this.search().trim();
    const keys = this.columns().map((c) => c.key);
    const realized = keys.map((k) => (unfiltered ? this.data()?.realized?.[k] ?? 0 : 0));
    const mode = this.effectiveMode();
    return value.map((v, i): Cell => {
      if (mode === 'value' || mode === 'price') {
        const prev = i > 0 ? value[i - 1] : 0;
        const ch = prev > 0 ? (v - cost[i] + realized[i] - (prev - cost[i - 1] + realized[i - 1])) / prev : null;
        return { main: formatMoney0(v), sub: ch === null ? null : formatSignedPercent(ch, 1), tone: 0, cls: signClass(ch ?? 0) };
      }
      if (mode === 'change') {
        if (i === 0 || value[i - 1] <= 0) return null;
        const ch = (v - cost[i] + realized[i] - (value[i - 1] - cost[i - 1] + realized[i - 1])) / value[i - 1];
        return { main: formatSignedPercent(ch, 1), sub: null, tone: ch, cls: signClass(ch) };
      }
      const r = cost[i] > 0 ? v / cost[i] - 1 : null;
      return r === null ? null : { main: formatSignedPercent(r, 1), sub: null, tone: r, cls: signClass(r) };
    });
  });

  /** Whole table: gain, money put in and return in the shown period (same maths as each row). */
  protected readonly totalPeriod = computed(() => {
    const rows = this.rows();
    const n = this.columns().length;
    if (!n) return null;
    const raw = Array.from({ length: n }, (_, i): MonthlyPoint | null => {
      const pts = rows.map((r) => r.raw[i]).filter((p): p is MonthlyPoint => !!p);
      if (!pts.length) return null;
      return {
        date: pts[0].date, price: 0, currency: 'EUR', priceEur: 0, quantity: 0,
        value: pts.reduce((s, p) => s + p.value, 0),
        cost: pts.reduce((s, p) => s + p.cost, 0),
        result: pts.reduce((s, p) => s + (p.result ?? 0), 0)
      };
    });
    return periodStats(raw);
  });

  /** Label of the period columns: the year, or "total" for the whole history. */
  protected readonly periodName = computed(() => this.year() || 'total');

  protected readonly totalNow = computed(() => {
    const rows = this.rows();
    const value = rows.reduce((s, r) => s + (r.now?.value ?? 0), 0);
    const cost = rows.reduce((s, r) => s + (r.now?.cost ?? 0), 0);
    return { value, cost, ret: cost > 0 ? value / cost - 1 : null };
  });

  protected readonly typeOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const a of this.data()?.assets ?? []) seen.set(a.typeCode, a.typeName);
    return [...seen.entries()].map(([code, name]) => ({ code, name }));
  });

  protected readonly bankOptions = computed(() => [...new Set((this.data()?.assets ?? []).map((a) => a.bankName))].sort());

  private cell(mode: Mode, p: MonthlyPoint | null, prev: MonthlyPoint | null): Cell {
    if (!p) return null;
    const held = p.quantity > 0;
    const ch = prev && prev.priceEur > 0 ? p.priceEur / prev.priceEur - 1 : null;
    switch (mode) {
      case 'price':
        return { main: formatPrice(p.price, p.currency), sub: ch === null ? null : formatSignedPercent(ch, 1), tone: 0, cls: signClass(ch ?? 0) };
      case 'change':
        return ch === null ? null : { main: formatSignedPercent(ch, 1), sub: null, tone: ch, cls: signClass(ch) };
      case 'value':
        return held ? { main: formatMoney0(p.value), sub: null, tone: 0, cls: '' } : null;
      case 'return': {
        if (!held || p.cost <= 0) return null;
        const r = p.value / p.cost - 1;
        return { main: formatSignedPercent(r, 1), sub: null, tone: r, cls: signClass(r) };
      }
    }
  }

  /** Cell of a bank / type row: value, monthly result net of contributions, or return on cost. */
  private groupCell(mode: Mode, p: MonthlyPoint | null, prev: MonthlyPoint | null): Cell {
    if (!p) return null;
    const ch = prev && prev.value > 0 ? (p.value - p.cost - (prev.value - prev.cost)) / prev.value : null;
    if (mode === 'change') {
      return ch === null ? null : { main: formatSignedPercent(ch, 1), sub: null, tone: ch, cls: signClass(ch) };
    }
    if (mode === 'return') {
      if (p.cost <= 0) return null;
      const ret = p.value / p.cost - 1;
      return { main: formatSignedPercent(ret, 1), sub: null, tone: ret, cls: signClass(ret) };
    }
    return { main: formatMoney0(p.value), sub: ch === null ? null : formatSignedPercent(ch, 1), tone: 0, cls: signClass(ch ?? 0) };
  }

  /** Background tint for % cells: stronger color for bigger moves (capped at ±20 %). */
  protected tint(tone: number): string | null {
    if (!tone) return null;
    const strength = Math.min(1, Math.abs(tone) / 0.2);
    const pct = Math.round(6 + strength * 26);
    const color = tone > 0 ? 'var(--up)' : 'var(--down)';
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.api.monthly());
    } catch (error) {
      this.store.error(error, 'No se pudo cargar la tabla mensual.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Exports the current view (all modes as separate blocks) to a CSV that Excel opens directly. */
  protected exportCsv(): void {
    const cols = this.columns();
    const rows = this.rows();
    const sep = ';';
    const num = (v: number | null | undefined, d = 4) => (v === null || v === undefined ? '' : v.toFixed(d).replace('.', ','));
    const grouped = this.groupBy() !== 'asset';
    const header = [grouped ? (this.groupBy() === 'bank' ? 'Banco' : 'Tipo') : 'Activo', grouped ? 'Activos' : 'Banco', grouped ? '' : 'Tipo', ...cols.map((c) => (c.isNow ? `Hoy (${this.data()?.latest})` : `${c.key}-01`))];
    const lines: string[] = [];
    const block = (title: string, pick: (p: MonthlyPoint | null, prev: MonthlyPoint | null) => string) => {
      lines.push(title);
      lines.push(header.join(sep));
      for (const r of rows) {
        lines.push([r.name, grouped ? r.sub : r.bankName, r.typeName, ...r.raw.map((p, i) => pick(p, i > 0 ? r.raw[i - 1] : null))].join(sep));
      }
      lines.push('');
    };
    if (!grouped) {
      block('Precio', (p) => num(p?.price));
      block('Variacion mensual del precio (%)', (p, prev) => (p && prev && prev.priceEur > 0 ? num((p.priceEur / prev.priceEur - 1) * 100, 2) : ''));
    } else {
      block('Resultado mensual sin aportaciones (%)', (p, prev) => (p && prev && prev.value > 0 ? num(((p.value - p.cost - (prev.value - prev.cost)) / prev.value) * 100, 2) : ''));
    }
    block('Valor de la posicion (EUR)', (p) => (p && p.quantity > 0 ? num(p.value, 2) : ''));
    block('Rentabilidad de la posicion (%)', (p) => (p && p.cost > 0 && p.quantity > 0 ? num((p.value / p.cost - 1) * 100, 2) : ''));

    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finanzas-mensual-${this.groupBy()}-${this.year() || 'todo'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
