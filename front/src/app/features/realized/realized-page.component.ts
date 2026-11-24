import { ListView, ViewToggleComponent } from '../../shared/view-toggle.component';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { RealizedData, TYPE_COLORS } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import {
  formatDay,
  formatMoney,
  formatPrice,
  formatQty,
  formatSignedMoney,
  formatSignedPercent,
  signClass,
  todayIso
} from '../../shared/format.utils';

type View = 'sales' | 'assets';

@Component({
  selector: 'app-realized-page',
  standalone: true,
  imports: [FormsModule, ViewToggleComponent],
  templateUrl: './realized-page.component.html',
  styleUrl: './realized-page.component.css'
})
export class RealizedPageComponent {
  protected readonly store = inject(PortfolioStore);
  private readonly api = inject(PortfolioApi);

  protected readonly data = signal<RealizedData | null>(null);
  protected readonly loading = signal(false);
  protected readonly year = signal<string>('');
  protected readonly view = signal<View>('sales');
  protected readonly saving = signal(false);

  protected readonly fmt = { formatDay, formatMoney, formatPrice, formatQty, formatSignedMoney, formatSignedPercent, signClass };
  protected readonly typeColors = TYPE_COLORS;
  protected readonly today = todayIso();

  protected draft: {
    name: string;
    bankName: string;
    typeCode: string;
    quantity: number | null;
    buyDate: string;
    buyAmountEur: number | null;
    sellDate: string;
    sellAmountEur: number | null;
  } | null = null;

  constructor() {
    effect(() => {
      this.store.version();
      void this.load();
    });
  }

  protected readonly years = computed(() => (this.data()?.byYear ?? []).map((y) => y.year));

  protected readonly sales = computed(() => {
    const y = this.year();
    return (this.data()?.sales ?? []).filter((s) => !y || s.year === y);
  });

  protected readonly assets = computed(() => {
    const y = this.year();
    const rows = this.data()?.byAsset ?? [];
    if (!y) return rows;
    const sold = new Set(this.sales().map((s) => s.assetId));
    return rows.filter((a) => sold.has(a.assetId));
  });

  /** Biggest result (either sign) of the listed assets: the cards' bars are relative to it. */
  protected readonly layout = signal<ListView>('cards');
  /** Biggest result (either sign) of the listed sales: the bars of the sale cards are relative to it. */
  protected readonly maxAbsSale = computed(() => Math.max(0.01, ...this.sales().map((s) => Math.abs(s.pnlEur))));
  protected readonly maxAbsPnl = computed(() => Math.max(0.01, ...this.assets().map((a) => Math.abs(a.pnlEur))));

  protected abs(v: number): number {
    return Math.abs(v);
  }

  /** Totals for the selected year (or all time). */
  protected readonly totals = computed(() => {
    const list = this.sales();
    const gains = list.filter((s) => s.pnlEur > 0).reduce((t, s) => t + s.pnlEur, 0);
    const losses = list.filter((s) => s.pnlEur < 0).reduce((t, s) => t + s.pnlEur, 0);
    const cost = list.reduce((t, s) => t + s.costEur, 0);
    const proceeds = list.reduce((t, s) => t + s.proceedsEur, 0);
    const winners = list.filter((s) => s.pnlEur > 0).length;
    const days = cost > 0 ? list.reduce((t, s) => t + s.holdingDays * s.costEur, 0) / cost : 0;
    return {
      count: list.length,
      gains,
      losses,
      net: gains + losses,
      pct: cost > 0 ? (gains + losses) / cost : 0,
      proceeds,
      winRate: list.length ? winners / list.length : 0,
      avgDays: Math.round(days)
    };
  });

  protected holding(days: number): string {
    if (days < 1) return 'mismo día';
    if (days < 60) return `${days} días`;
    const months = days / 30.44;
    if (months < 24) return `${Math.round(months)} meses`;
    return `${(days / 365.25).toFixed(1).replace('.', ',')} años`;
  }

  protected kindLabel(kind: string): string {
    return kind === 'transfer_out' ? 'Traspaso' : kind === 'adjust' ? 'Ajuste' : 'Venta';
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.api.realized());
    } catch (error) {
      this.store.error(error, 'No se pudieron cargar las ventas.');
    } finally {
      this.loading.set(false);
    }
  }

  protected sell(): void {
    this.store.openMovement({ kind: 'sell' });
  }

  // ---- Old closed position ----

  protected newOld(): void {
    this.draft = {
      name: '',
      bankName: this.store.banks()[0]?.name ?? '',
      typeCode: 'STOCK',
      quantity: null,
      buyDate: '',
      buyAmountEur: null,
      sellDate: '',
      sellAmountEur: null
    };
  }

  protected draftResult(): { pnl: number; pct: number; days: number } | null {
    const d = this.draft;
    if (!d?.buyAmountEur || d.sellAmountEur === null || !d.buyDate || !d.sellDate) return null;
    const pnl = d.sellAmountEur - d.buyAmountEur;
    const days = Math.max(0, Math.round((Date.parse(d.sellDate) - Date.parse(d.buyDate)) / 86_400_000));
    return { pnl, pct: pnl / d.buyAmountEur, days };
  }

  protected async saveOld(): Promise<void> {
    const d = this.draft;
    if (!d) return;
    if (d.name.trim().length < 2 || d.bankName.trim().length < 2) return this.store.toast('error', 'Indica activo y banco.');
    if (!d.buyDate || !d.sellDate) return this.store.toast('error', 'Indica las fechas de compra y venta.');
    if (!(d.buyAmountEur && d.buyAmountEur > 0) || d.sellAmountEur === null) return this.store.toast('error', 'Indica lo que pagaste y lo que recibiste.');
    this.saving.set(true);
    try {
      await this.api.createClosedPosition({ ...d, quantity: d.quantity || undefined });
      this.draft = null;
      await this.store.changed('Posición antigua guardada');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }
}
