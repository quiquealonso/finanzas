import { Component, computed, inject, signal } from '@angular/core';
import { errorMessage, PortfolioApi } from '../../core/portfolio-api.service';
import { MagicFormulaData, MagicPick } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatDay } from '../../shared/format.utils';

/**
 * Magic Formula (Joel Greenblatt): the companies with the best sum of two ranks, return on capital and
 * earnings yield. The screen runs every Thursday in the weekly task (back/scripts/magic-formula.js).
 */
@Component({
  selector: 'app-magic-formula-page',
  standalone: true,
  templateUrl: './magic-formula-page.component.html',
  styleUrl: './magic-formula-page.component.css'
})
export class MagicFormulaPageComponent {
  private readonly api = inject(PortfolioApi);
  private readonly store = inject(PortfolioStore);
  protected readonly day = formatDay;

  protected readonly data = signal<MagicFormulaData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly sector = signal<string | null>(null);
  protected readonly showHow = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(run?: string): Promise<void> {
    try {
      this.data.set(await this.api.magicFormula(run));
      this.sector.set(null);
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e, 'No se ha podido cargar la fórmula mágica.'));
    }
  }

  /** Tickers you already hold (symbol without the exchange suffix, e.g. ADBE from ADBE or ADBE.US). */
  private readonly held = computed(() => {
    const set = new Set<string>();
    for (const a of this.store.assets()) if (a.valueEur > 0 && a.symbol) set.add(a.symbol.split('.')[0].toUpperCase());
    return set;
  });

  protected readonly sectors = computed(() => {
    const counts = new Map<string, number>();
    for (const p of this.data()?.picks ?? []) counts.set(p.sector ?? 'Otros', (counts.get(p.sector ?? 'Otros') ?? 0) + 1);
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  });

  protected readonly rows = computed(() => {
    const d = this.data();
    if (!d) return [];
    const prev = d.previous ? new Set(d.previous) : null;
    const held = this.held();
    const s = this.sector();
    return d.picks
      .filter((p) => !s || (p.sector ?? 'Otros') === s)
      .map((p) => ({ ...p, isNew: !!prev && !prev.has(p.symbol), isHeld: held.has(p.symbol.split('.')[0].toUpperCase()) }));
  });

  /** Companies that left the list since the previous run. */
  protected readonly dropped = computed(() => {
    const d = this.data();
    if (!d?.previous) return [];
    const now = new Set(d.picks.map((p) => p.symbol));
    return d.previous.filter((s) => !now.has(s));
  });

  /** Companies that entered the list since the previous run. */
  protected readonly newCount = computed(() => {
    const d = this.data();
    if (!d?.previous) return 0;
    const prev = new Set(d.previous);
    return d.picks.filter((p) => !prev.has(p.symbol)).length;
  });

  protected readonly runIndex = computed(() => {
    const d = this.data();
    return d?.run ? d.runs.findIndex((r) => r.id === d.run!.id) : -1;
  });

  protected step(delta: number): void {
    const d = this.data();
    const target = d?.runs[this.runIndex() + delta];
    if (target) void this.load(target.id);
  }

  protected pct(v: number, digits = 1): string {
    return (v * 100).toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }) + ' %';
  }

  /** USD amounts as 1,2 B$ / 850 M$. */
  protected usd(v: number): string {
    const abs = Math.abs(v);
    if (abs >= 1e12) return (v / 1e12).toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' T$';
    if (abs >= 1e9) return (v / 1e9).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' B$';
    return (v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 0 }) + ' M$';
  }

  protected price(v: number | null): string {
    return v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' $';
  }

  protected link(p: MagicPick): string {
    return `https://finance.yahoo.com/quote/${encodeURIComponent(p.symbol.replace('.', '-'))}`;
  }
}
