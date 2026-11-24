import { Component, computed, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { ClosingCell, ClosingRow, ClosingSection, ClosingSheet } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatMoney0, formatSignedMoney, formatSignedPercent, MASK, privacy, signClass } from '../../shared/format.utils';
import { ConfirmService } from '../../shared/confirm-dialog.component';

type DeltaMode = 'pct' | 'eur' | 'none';

/** Column keys of the sheet: "0" = opening value, "1".."12" = months. */
const KEYS = Array.from({ length: 13 }, (_, i) => String(i));
const MONTHS = ['Inicio', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const plain = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);

/** Month result: gain without contributions for an investment, plain change for cash. */
type Delta = { eur: number; pct: number | null } | null;
type ViewCell = { key: string; value: number | null; note: string | null; delta: Delta; contrib: number | null };
type Ytd = { eur: number; pct: number | null } | null;
/** Index 0 = start of the year. val = value, cost = money invested (cash: equal to the value). */
type Series = { val: Array<number | null>; cost: Array<number | null> };
type Step = { gain: number; contrib: number; base: number; change: number; prev: number } | null;
type ViewRow = { row: ClosingRow; isAsset: boolean; cells: ViewCell[]; ytd: Ytd; steps: Step[]; last: { val: number; cost: number } | null };
type TotalLine = { values: Array<number | null>; deltas: Delta[]; contribs: Array<number | null>; ytd: Ytd };
type ViewSection = { section: ClosingSection; rows: ViewRow[]; total: TotalLine };

function numeric(value: ClosingCell | undefined): number | null {
  return typeof value === 'number' ? value : null;
}

function seriesOf(row: ClosingRow): Series {
  const val = KEYS.map((k) => numeric(row.cells[k]));
  if (!row.assetId) return { val, cost: [...val] };
  // An asset held on 31 December opens with its value then; one bought during the year opens at 0,
  // so its purchase counts as money put in that month.
  const cost = KEYS.map((k, i) => (val[i] === null ? null : row.costs[k] ?? null));
  val[0] = row.openingValue ?? 0;
  cost[0] = row.openingValue === null ? 0 : row.costs['0'] ?? null;
  return { val, cost };
}

/** Each month against the previous month with data: gain = value change minus money put in. */
function stepsOf({ val, cost }: Series): Step[] {
  return KEYS.map((_, m) => {
    if (m === 0 || val[m] === null || cost[m] === null) return null;
    let p = m - 1;
    while (p >= 0 && (val[p] === null || cost[p] === null)) p--;
    if (p < 0) return null;
    const contrib = cost[m]! - cost[p]!;
    const change = val[m]! - val[p]!;
    return { gain: change - contrib, contrib, change, prev: val[p]!, base: val[p]! + Math.max(0, contrib) };
  });
}

function lastOf({ val, cost }: Series): { val: number; cost: number } | null {
  for (let i = 12; i >= 1; i--) if (val[i] !== null && cost[i] !== null) return { val: val[i]!, cost: cost[i]! };
  return null;
}

function sumOf(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

/** Column sums; month gains and contributions add up row by row; the year compares value with money invested. */
function totalOf(rows: ViewRow[]): TotalLine {
  const values = KEYS.map((_, i) => sumOf(rows.map((r) => r.cells[i].value)));
  if (!rows.some((r) => r.isAsset)) {
    // Cash only: plain change on the month before, nothing to split into gains and contributions.
    const deltas: Delta[] = values.map((v, i) => {
      const prev = i > 1 ? values[i - 1] : null;
      return v === null || prev === null ? null : { eur: v - prev, pct: prev !== 0 ? v / prev - 1 : null };
    });
    return { values, deltas, contribs: values.map(() => null), ytd: null };
  }
  const deltas: Delta[] = KEYS.map((_, m) => {
    const steps = rows.map((r) => r.steps[m]).filter((x): x is NonNullable<Step> => !!x);
    if (!steps.length) return null;
    const gain = steps.reduce((a, x) => a + x.gain, 0);
    const base = steps.reduce((a, x) => a + x.base, 0);
    return { eur: gain, pct: base > 0 ? gain / base : null };
  });
  const contribs = KEYS.map((_, m) => sumOf(rows.map((r) => r.steps[m]?.contrib ?? null)));
  const lasts = rows.filter((r) => r.isAsset && r.last).map((r) => r.last!);
  const eur = lasts.reduce((a, l) => a + l.val - l.cost, 0);
  const cost = lasts.reduce((a, l) => a + l.cost, 0);
  return { values, deltas, contribs, ytd: lasts.length ? { eur, pct: cost > 0 ? eur / cost : null } : null };
}

@Component({
  selector: 'app-closings-page',
  standalone: true,
  templateUrl: './closings-page.component.html',
  styleUrl: './closings-page.component.css'
})
export class ClosingsPageComponent {
  private readonly confirmDialog = inject(ConfirmService);
  private readonly api = inject(PortfolioApi);
  private readonly store = inject(PortfolioStore);

  protected readonly sheet = signal<ClosingSheet | null>(null);
  protected readonly loading = signal(false);
  protected readonly deltaMode = signal<DeltaMode>('pct');
  /** Cell being edited: row id + column key. */
  protected readonly editing = signal<{ rowId: string; key: string } | null>(null);

  protected readonly keys = KEYS;
  protected readonly months = MONTHS;
  protected readonly fmt = { formatMoney0, formatSignedMoney, formatSignedPercent, signClass };

  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  constructor() {
    void this.load();
    // The input of the edited cell takes the focus with its text selected, ready to overwrite.
    effect(() => {
      const input = this.box()?.nativeElement;
      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  protected readonly view = computed<ViewSection[]>(() =>
    (this.sheet()?.sections ?? []).map((section) => {
      const rows = section.rows.map((row) => {
        const isAsset = !!row.assetId;
        const series = seriesOf(row);
        const steps = stepsOf(series);
        const last = lastOf(series);
        const cells = KEYS.map((key, i) => {
          const raw = row.cells[key];
          const st = steps[i];
          const delta: Delta = !st ? null
            : isAsset ? { eur: st.gain, pct: st.base > 0 ? st.gain / st.base : null }
            : { eur: st.change, pct: st.prev !== 0 ? st.change / st.prev : null };
          // The first purchase is already the "Inicio" figure: the cell only flags money put in on top of it.
          const contrib = isAsset && st ? st.contrib - (row.openingValue === null && st.prev === 0 ? row.costs['0'] ?? 0 : 0) : null;
          return { key, value: numeric(raw), note: typeof raw === 'string' ? raw : null, delta, contrib };
        });
        let ytd: Ytd = null;
        if (isAsset && last) {
          ytd = { eur: last.val - last.cost, pct: last.cost > 0 ? last.val / last.cost - 1 : null };
        } else if (!isAsset) {
          // Cash: change from the first figure of the year to the last one.
          const filled = series.val.filter((v): v is number => v !== null);
          if (filled.length > 1) ytd = { eur: filled[filled.length - 1] - filled[0], pct: null };
        }
        return { row, isAsset, cells, ytd, steps, last };
      });
      return { section, rows, total: totalOf(rows) };
    })
  );

  protected readonly grand = computed<TotalLine | null>(() => {
    const counted = this.view().filter((s) => s.section.inTotal);
    return counted.length ? totalOf(counted.flatMap((s) => s.rows)) : null;
  });

  /** Headline: latest month with a total, its gain and contributions that month, and value against invested. */
  protected readonly headline = computed(() => {
    const g = this.grand();
    if (!g) return null;
    for (let i = 12; i >= 1; i--) {
      if (g.values[i] !== null) return { month: MONTHS[i], total: g.values[i]!, delta: g.deltas[i], contrib: g.contribs[i], ytd: g.ytd };
    }
    return null;
  });

  protected contribText(value: number | null): string {
    if (value === null || Math.abs(value) < 1) return '';
    return value > 0 ? `+${plain.format(value)} aport.` : `−${plain.format(-value)} retirado`;
  }

  /** Months already over in the shown year, newest first; the default is the last one. */
  protected readonly closable = computed(() => {
    const y = this.sheet()?.year;
    if (!y) return [];
    const now = new Date();
    const last = y < now.getFullYear() ? 12 : y === now.getFullYear() ? now.getMonth() : -1;
    return Array.from({ length: last }, (_, m) => m + 1).reverse();
  });
  protected readonly closeMonth = signal<number | null>(null);
  protected readonly closing = signal(false);
  protected readonly monthNames = ['inicio de año', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  protected async doClose(): Promise<void> {
    const sheet = this.sheet();
    const month = this.closeMonth() ?? this.closable()[0];
    if (!sheet || month === undefined) return;
    this.closing.set(true);
    try {
      const result = await this.api.closeMonth(sheet.year, month);
      this.store.toast('ok', `Cierre de ${this.monthNames[month]} hecho: ${result.assets} activos. Rellena la liquidez.`);
      await this.load();
    } catch (error) {
      this.store.error(error, 'No se pudo hacer el cierre.');
    } finally {
      this.closing.set(false);
    }
  }

  protected async load(year?: number): Promise<void> {
    this.loading.set(true);
    try {
      this.sheet.set(await this.api.closings(year ?? this.sheet()?.year));
    } catch (error) {
      this.store.error(error, 'No se pudo cargar la hoja de cierres.');
    } finally {
      this.loading.set(false);
    }
  }

  protected number(value: number | null): string {
    if (privacy() && value !== null) return MASK;
    return value === null ? '' : plain.format(value);
  }

  protected deltaText(d: Delta): string {
    if (!d || this.deltaMode() === 'none') return '';
    if (this.deltaMode() === 'eur') return d.eur === 0 ? '=' : formatSignedMoney(d.eur).replace(/,\d+/, '');
    return d.pct === null ? '' : formatSignedPercent(d.pct, 1);
  }

  protected rawValue(row: ClosingRow, key: string): string {
    const v = row.cells[key];
    return v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : v;
  }

  // ---- Cell editing (Excel-like: Enter goes down, Tab goes right, Esc cancels) ----

  protected startEdit(rowId: string, key: string): void {
    this.editing.set({ rowId, key });
  }

  protected isEditing(rowId: string, key: string): boolean {
    const e = this.editing();
    return !!e && e.rowId === rowId && e.key === key;
  }

  protected async commit(row: ClosingRow, key: string, input: HTMLInputElement, next?: 'down' | 'right' | 'left'): Promise<void> {
    if (!this.isEditing(row.id, key)) return;
    const value = input.value.trim();
    this.editing.set(next ? this.neighbour(row.id, key, next) : null);
    if (value === this.rawValue(row, key)) return;
    try {
      await this.api.updateClosingRow(row.id, { cell: key, value });
      await this.load();
    } catch (error) {
      this.store.error(error, 'No se pudo guardar.');
    }
  }

  protected onKey(event: KeyboardEvent, row: ClosingRow, key: string): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Escape') {
      this.editing.set(null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void this.commit(row, key, input, 'down');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      void this.commit(row, key, input, event.shiftKey ? 'left' : 'right');
    }
  }

  private neighbour(rowId: string, key: string, dir: 'down' | 'right' | 'left'): { rowId: string; key: string } | null {
    if (dir !== 'down') {
      const k = Number(key) + (dir === 'right' ? 1 : -1);
      return k >= 0 && k <= 12 ? { rowId, key: String(k) } : null;
    }
    const all = this.view().flatMap((s) => s.rows.map((r) => r.row.id));
    const next = all[all.indexOf(rowId) + 1];
    return next ? { rowId: next, key } : null;
  }

  // ---- Structure ----

  private async run(action: () => Promise<unknown>, fallback: string): Promise<void> {
    try {
      await action();
      await this.load();
    } catch (error) {
      this.store.error(error, fallback);
    }
  }

  protected addSection(): void {
    const sheet = this.sheet();
    const name = prompt('Nombre de la sección (p. ej. Liquidez):');
    if (!sheet || !name?.trim()) return;
    void this.run(() => this.api.createClosingSection({ year: sheet.year, name, inTotal: true }), 'No se pudo crear la sección.');
  }

  protected renameSection(section: ClosingSection): void {
    const name = prompt('Nuevo nombre de la sección:', section.name);
    if (!name?.trim() || name === section.name) return;
    void this.run(() => this.api.updateClosingSection(section.id, { name }), 'No se pudo renombrar.');
  }

  protected toggleInTotal(section: ClosingSection): void {
    void this.run(() => this.api.updateClosingSection(section.id, { inTotal: !section.inTotal }), 'No se pudo cambiar.');
  }

  protected moveSection(section: ClosingSection, move: number): void {
    void this.run(() => this.api.updateClosingSection(section.id, { move }), 'No se pudo mover.');
  }

  protected async deleteSection(section: ClosingSection): Promise<void> {
    if (!(await this.confirmDialog.ask(`¿Borrar la sección "${section.name}" y sus ${section.rows.length} filas de este año?`))) return;
    void this.run(() => this.api.deleteClosingSection(section.id), 'No se pudo borrar.');
  }

  protected addRow(section: ClosingSection): void {
    const name = prompt(`Nuevo producto en ${section.name}:`);
    if (!name?.trim()) return;
    void this.run(() => this.api.createClosingRow({ sectionId: section.id, name }), 'No se pudo crear la fila.');
  }

  protected renameRow(row: ClosingRow): void {
    const name = prompt('Nuevo nombre:', row.name);
    if (!name?.trim() || name === row.name) return;
    void this.run(() => this.api.updateClosingRow(row.id, { name }), 'No se pudo renombrar.');
  }

  protected moveRow(row: ClosingRow, move: number): void {
    void this.run(() => this.api.updateClosingRow(row.id, { move }), 'No se pudo mover.');
  }

  protected async deleteRow(row: ClosingRow): Promise<void> {
    if (!(await this.confirmDialog.ask(`¿Borrar la fila "${row.name}"?`))) return;
    void this.run(() => this.api.deleteClosingRow(row.id), 'No se pudo borrar.');
  }
}
