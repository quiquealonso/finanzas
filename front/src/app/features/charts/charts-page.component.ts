import { Component, computed, inject, signal } from '@angular/core';
import { AssetRow, REGIONS, TYPE_COLORS } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { DonutChartComponent, DonutSegment } from '../../shared/donut-chart.component';
import { formatMoney0 } from '../../shared/format.utils';

const BANK_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#f59e0b', '#dc2626', '#10b981', '#d946ef', '#78716c', '#ea580c'];
const CURRENCY_COLORS: Record<string, string> = { EUR: '#2563eb', USD: '#10b981', GBP: '#7c3aed' };

@Component({
  selector: 'app-charts-page',
  standalone: true,
  imports: [DonutChartComponent],
  templateUrl: './charts-page.component.html',
  styleUrl: './charts-page.component.css'
})
export class ChartsPageComponent {
  protected readonly store = inject(PortfolioStore);

  /** Leave cash out to see how the invested money is spread. */
  protected readonly excludeCash = signal(true);
  protected readonly selectedRegion = signal<string | null>(null);
  protected readonly money = formatMoney0;
  protected readonly regions = REGIONS;

  private readonly assets = computed(() =>
    this.store.assets().filter((a) => a.valueEur > 0 && (!this.excludeCash() || !a.isLiquidity))
  );

  protected readonly total = computed(() => this.assets().reduce((s, a) => s + a.valueEur, 0));

  protected readonly byType = computed<DonutSegment[]>(() =>
    this.group((a) => [{ key: a.typeCode, label: a.typeName, color: TYPE_COLORS[a.typeCode] ?? '#888', weight: 1 }])
  );

  protected readonly byRegion = computed<DonutSegment[]>(() =>
    this.group((a) => {
      const entries = Object.entries(a.regions ?? {});
      const sum = entries.reduce((s, [, v]) => s + v, 0);
      if (!entries.length || sum <= 0) return [{ key: 'NONE', label: 'Sin asignar', color: '#a8a29e', weight: 1 }];
      return entries.map(([code, v]) => {
        const r = REGIONS.find((x) => x.code === code);
        return { key: code, label: r?.name ?? code, color: r?.color ?? '#888', weight: v / sum };
      });
    })
  );

  protected readonly byBank = computed<DonutSegment[]>(() => {
    const banks = this.store.banks();
    return this.group((a) => {
      const i = banks.findIndex((b) => b.id === a.bankId);
      return [{ key: a.bankId, label: a.bankName, color: BANK_COLORS[i % BANK_COLORS.length], weight: 1 }];
    });
  });

  protected readonly byCurrency = computed<DonutSegment[]>(() =>
    this.group((a) => {
      // Crypto trades against the dollar whatever the account currency.
      const c = a.typeCode === 'CRYPTO' ? 'USD' : a.currency;
      return [{ key: c, label: c === 'EUR' ? 'Euro' : c === 'USD' ? 'Dólar' : 'Libra', color: CURRENCY_COLORS[c] ?? '#888', weight: 1 }];
    })
  );

  /** Assets that make up the selected region, with the euros each contributes. */
  protected readonly regionDetail = computed(() => {
    const code = this.selectedRegion() ?? this.byRegion()[0]?.key;
    if (!code) return null;
    const rows = this.assets()
      .map((a) => {
        const entries = Object.entries(a.regions ?? {});
        const sum = entries.reduce((s, [, v]) => s + v, 0);
        const share = code === 'NONE' ? (sum > 0 ? 0 : 1) : sum > 0 ? (a.regions[code] ?? 0) / sum : 0;
        return { asset: a, share, value: a.valueEur * share };
      })
      .filter((r) => r.value > 0)
      .sort((x, y) => y.value - x.value);
    const total = rows.reduce((s, r) => s + r.value, 0);
    return { code, name: REGIONS.find((r) => r.code === code)?.name ?? 'Sin asignar', rows, total };
  });

  protected readonly unassigned = computed(() =>
    this.assets().filter((a) => !Object.keys(a.regions ?? {}).length)
  );

  private group(split: (a: AssetRow) => Array<{ key: string; label: string; color: string; weight: number }>): DonutSegment[] {
    const map = new Map<string, DonutSegment>();
    for (const a of this.assets()) {
      for (const part of split(a)) {
        const seg = map.get(part.key) ?? { key: part.key, label: part.label, color: part.color, value: 0 };
        seg.value += a.valueEur * part.weight;
        map.set(part.key, seg);
      }
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }

  protected selectRegion(code: string): void {
    this.selectedRegion.set(code);
  }
}
