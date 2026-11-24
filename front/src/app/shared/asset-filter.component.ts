import { Component, computed, inject, input, model } from '@angular/core';
import { TYPE_COLORS } from '../core/portfolio.models';
import { PortfolioStore } from '../core/portfolio.store';
import { formatMoney } from './format.utils';
import { MultiOption, MultiSelectComponent } from './multi-select.component';

/**
 * Bank and asset type filter: two dropdowns where several options can be picked (none = all), with the value of
 * each. Used by Activos and Resumen. Content marked `filterAside` goes on the right of the dropdowns; any other
 * projected content goes below them (search, view options...).
 */
@Component({
  selector: 'app-asset-filter',
  standalone: true,
  imports: [MultiSelectComponent],
  template: `
    <div class="filter-bar">
      <app-multi-select label="Banco" [options]="bankOptions()" [(selected)]="banks" />
      <app-multi-select label="Tipo" [options]="typeOptions()" [(selected)]="types" />
      @if (banks().length || types().length) {
        <button type="button" class="btn sm link" (click)="banks.set([]); types.set([])">Quitar filtros</button>
      }
      <div class="aside"><ng-content select="[filterAside]" /></div>
    </div>
    <ng-content />
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 10px; }
    .filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .aside { margin-left: auto; display: flex; align-items: center; }
    .aside:empty { display: none; }
  `
})
export class AssetFilterComponent {
  private readonly store = inject(PortfolioStore);

  /** Selected bank ids and type codes (empty = all). */
  readonly banks = model<string[]>([]);
  readonly types = model<string[]>([]);
  /** Show the value of each bank and type in the list. */
  readonly showValues = input(true);

  protected readonly bankOptions = computed<MultiOption[]>(() => {
    const assets = this.store.assets();
    return this.store
      .banks()
      .map((b) => ({ id: b.id, label: b.name, value: assets.filter((a) => a.bankId === b.id).reduce((s, a) => s + a.valueEur, 0) }))
      .sort((a, b) => b.value - a.value)
      .map((b) => ({ id: b.id, label: b.label, hint: this.showValues() ? this.money(b.value) : undefined }));
  });

  protected readonly typeOptions = computed<MultiOption[]>(() => {
    const assets = this.store.assets();
    return this.store
      .types()
      .map((t) => ({ ...t, value: assets.filter((a) => a.typeCode === t.code).reduce((s, a) => s + a.valueEur, 0) }))
      .filter((t) => t.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((t) => ({ id: t.code, label: t.name, color: TYPE_COLORS[t.code], hint: this.showValues() ? this.money(t.value) : undefined }));
  });

  private money(v: number): string {
    return formatMoney(v).replace(',00', '');
  }
}
