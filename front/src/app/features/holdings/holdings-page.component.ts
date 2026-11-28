import { ConfirmService } from '../../shared/confirm-dialog.component';
import { AssetFilterComponent } from '../../shared/asset-filter.component';
import { Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { AssetRow, Currency, Movement, PerpPosition, REGIONS, TYPE_COLORS, TypeCode, WalletDiff, WalletsData } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import {
  formatDay,
  formatMoney,
  formatMoney0,
  formatPrice,
  formatQty,
  formatSignedMoney,
  formatSignedPercent,
  maskMoney,
  privacy,
  signClass
} from '../../shared/format.utils';

type AssetDraft = {
  id: string | null;
  bankId: string;
  name: string;
  typeCode: TypeCode;
  currency: Currency;
  symbol: string;
  manualPriceEur: number | null;
  /** Loan platforms: expected annual return (%). */
  annualRatePct: number | null;
  /** Percent by region; normalised on save. */
  regions: Record<string, number | null>;
};

type SortKey = 'name' | 'bank' | 'quantity' | 'price' | 'value' | 'cost' | 'pnl' | 'pnlPct' | 'day' | 'weight';

// Partial: an unknown kind gives undefined, and the template falls back to the raw kind.
const KIND_LABELS: Partial<Record<string, string>> = {
  buy: 'Compra', sell: 'Venta', deposit: 'Ingreso', withdraw: 'Retirada', transfer_out: 'Traspaso (sale)',
  transfer_in: 'Traspaso (entra)', adjust: 'Ajuste', opening: 'Saldo inicial', recurring: 'Aportación'
};

@Component({
  selector: 'app-holdings-page',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, AssetFilterComponent],
  templateUrl: './holdings-page.component.html',
  styleUrl: './holdings-page.component.css'
})
export class HoldingsPageComponent {
  private readonly confirmDialog = inject(ConfirmService);
  protected readonly store = inject(PortfolioStore);
  private readonly api = inject(PortfolioApi);

  // Filters
  protected readonly bankFilter = signal<string[]>([]);
  protected readonly typeFilter = signal<string[]>([]);
  protected readonly search = signal('');
  protected readonly groupByBank = signal(false);
  protected readonly showEmpty = signal(false);
  protected readonly sortKey = signal<SortKey>('value');
  protected readonly sortAsc = signal(false);

  // Detail panel
  protected readonly selectedId = signal<string | null>(null);
  protected readonly detailMovements = signal<Movement[]>([]);
  protected readonly detailLoading = signal(false);

  protected readonly saving = signal(false);
  protected assetDraft: AssetDraft | null = null;
  protected bankDraft: { id: string | null; name: string } | null = null;

  protected readonly fmt = { formatDay, formatMoney, formatMoney0, formatPrice, formatQty, formatSignedMoney, formatSignedPercent, signClass };
  protected readonly typeColors = TYPE_COLORS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly regionOptions = REGIONS.filter((r) => r.code !== 'CASH');

  protected readonly selected = computed(() => this.store.assets().find((a) => a.id === this.selectedId()) ?? null);

  // Perpetual futures (Hyperliquid): live data shown next to their asset; reloaded after every change.
  protected readonly perps = signal<PerpPosition[]>([]);
  protected readonly perpSyncing = signal(false);
  private readonly perpByAsset = computed(() => new Map(this.perps().map((p) => [p.assetId, p])));
  // On-chain wallets (Solana, Sui, EVM): differences with the app and tokens not linked to an asset.
  protected readonly wallets = signal<WalletsData | null>(null);
  protected readonly walletBusy = signal<string | null>(null);
  private readonly loadPerps = effect(() => {
    this.store.version();
    this.api.perps().then((d) => this.perps.set(d.positions)).catch(() => this.perps.set([]));
    this.api.wallets().then((d) => this.wallets.set(d)).catch(() => this.wallets.set(null));
  });

  protected perpOf(assetId: string): PerpPosition | undefined {
    return this.perpByAsset().get(assetId);
  }

  /** Reads Hyperliquid and every wallet; small wallet differences are adjusted by the backend. */
  protected async syncPerps(): Promise<void> {
    this.perpSyncing.set(true);
    try {
      const [, w] = await Promise.all([this.api.syncHyperliquid(), this.api.syncWallets() as Promise<{ adjusted: unknown[]; errors: string[] }>]);
      const msg = w.adjusted.length ? `Cripto sincronizado (${w.adjusted.length} ajustes pequeños).` : 'Cripto sincronizado.';
      await this.store.changed(msg);
      if (w.errors.length) this.store.toast('error', w.errors.join(' · '));
    } catch (e) {
      this.store.error(e, 'No se pudo sincronizar el cripto.');
    } finally {
      this.perpSyncing.set(false);
    }
  }

  protected async applyWallet(d: WalletDiff): Promise<void> {
    this.walletBusy.set(d.chain + d.token);
    try {
      await this.api.applyWalletDiff(d.chain, d.token);
      await this.store.changed(`${d.assetName}: cantidad ajustada a la wallet.`);
    } catch (e) {
      this.store.error(e, 'No se pudo ajustar.');
    } finally {
      this.walletBusy.set(null);
    }
  }

  /** Unlinked token: create a crypto asset for it, or ignore it. */
  protected async mapWallet(u: WalletsData['unmapped'][number], ignore: boolean): Promise<void> {
    this.walletBusy.set(u.chain + u.token);
    try {
      // Price from Yahoo as <SYMBOL>-USD (ETH-USD, SOL-USD…); it can be changed later with Editar.
      const symbol = ignore || !u.symbol ? '' : `${u.symbol}-USD`;
      await this.api.mapWalletToken({ chain: u.chain, token: u.token, ignore, assetId: ignore ? undefined : 'new', name: u.symbol ?? undefined, symbol });
      if (!ignore) {
        await this.api.syncWallets();
        await this.api.applyWalletDiff(u.chain, u.token).catch(() => undefined);
      }
      await this.store.changed(ignore ? 'Token ignorado.' : `${u.symbol ?? 'Token'} añadido a Cripto.`);
    } catch (e) {
      this.store.error(e, 'No se pudo guardar.');
    } finally {
      this.walletBusy.set(null);
    }
  }

  protected chainName(chain: string): string {
    return ({ solana: 'Solana', sui: 'Sui', bsc: 'BNB Chain', ethereum: 'Ethereum', arbitrum: 'Arbitrum', base: 'Base' } as Record<string, string>)[chain] ?? chain;
  }

  /** USD amount, e.g. 1.980,55 $. */
  protected usd(v: number | null | undefined, decimals = 2): string {
    if (v == null) return '—';
    if (privacy()) return maskMoney(v, '$');
    return v.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' $';
  }

  private readonly total = computed(() => this.store.overview()?.totalEur ?? 0);

  /** Bank chips with their value, biggest first. */
  protected readonly filtered = computed(() =>
    this.matching().filter((a) => this.showEmpty() || a.quantity > 0 || a.valueEur > 0)
  );

  /** Assets matching the bank, type and search filters, also the ones already sold (for the realized result). */
  private readonly matching = computed(() => {
    const banks = this.bankFilter();
    const types = this.typeFilter();
    const q = this.search().trim().toLowerCase();
    return this.store
      .assets()
      .filter((a) => !banks.length || banks.includes(a.bankId))
      .filter((a) => !types.length || types.includes(a.typeCode))
      .filter((a) => !q || `${a.name} ${a.bankName} ${a.symbol ?? ''} ${a.typeName}`.toLowerCase().includes(q));
  });

  protected readonly rows = computed(() => {
    const key = this.sortKey();
    const dir = this.sortAsc() ? 1 : -1;
    const value = (a: AssetRow): number | string => {
      switch (key) {
        case 'name': return a.name.toLowerCase();
        case 'bank': return a.bankName.toLowerCase();
        case 'quantity': return a.quantity;
        case 'price': return a.priceEur;
        case 'cost': return a.costEur;
        case 'pnl': return a.pnlEur;
        case 'pnlPct': return a.pnlPct;
        case 'day': return a.dayChangePct;
        default: return a.valueEur;
      }
    };
    return [...this.filtered()].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
      return cmp * dir;
    });
  });

  /** Rows split by bank, with subtotals, when grouping is on. */
  protected readonly grouped = computed(() => {
    const rows = this.rows();
    const map = new Map<string, { name: string; rows: AssetRow[]; value: number; pnl: number }>();
    for (const r of rows) {
      const g = map.get(r.bankId) ?? { name: r.bankName, rows: [], value: 0, pnl: 0 };
      g.rows.push(r);
      g.value += r.valueEur;
      g.pnl += r.pnlEur;
      map.set(r.bankId, g);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  });

  protected readonly totals = computed(() => {
    const rows = this.filtered();
    const value = rows.reduce((s, a) => s + a.valueEur, 0);
    const cost = rows.filter((a) => !a.isLiquidity).reduce((s, a) => s + a.costEur, 0);
    const unrealized = rows.reduce((s, a) => s + a.pnlEur, 0);
    // Same as "Ganancia total" in Resumen: open positions plus everything already sold, over the money put in net.
    const realized = this.matching().filter((a) => !a.isLiquidity).reduce((s, a) => s + (a.realizedEur ?? 0), 0);
    const pnl = unrealized + realized;
    const netIn = cost - realized;
    const day = rows.reduce((s, a) => s + a.dayChangeEur, 0);
    return { count: rows.length, value, cost, unrealized, realized, pnl, pnlPct: netIn > 0 ? pnl / netIn : 0, day };
  });

  protected readonly emptyCount = computed(() => this.store.assets().filter((a) => a.quantity <= 0 && a.valueEur <= 0).length);
  protected readonly hasFilters = computed(() => this.bankFilter().length > 0 || this.typeFilter().length > 0 || this.search().trim() !== '');

  // ---- Filters & sorting ----

  protected clearFilters(): void {
    this.bankFilter.set([]);
    this.typeFilter.set([]);
    this.search.set('');
  }

  protected sort(key: SortKey): void {
    if (this.sortKey() === key) this.sortAsc.update((v) => !v);
    else {
      this.sortKey.set(key);
      this.sortAsc.set(key === 'name' || key === 'bank');
    }
  }

  /** Cards: picking a sort always starts with the natural direction (A-Z up, figures biggest first). */
  protected sortBy(key: SortKey): void {
    this.sortKey.set(key);
    this.sortAsc.set(key === 'name' || key === 'bank');
  }

  // Cards (default) or the full table; remembered in this browser only.
  protected readonly view = signal<'cards' | 'table'>(readView());

  protected setView(v: 'cards' | 'table'): void {
    this.view.set(v);
    try { localStorage.setItem('holdings.view', v); } catch { /* storage blocked: keep it for this visit */ }
  }

  /** Biggest weight among the listed positions, so card bars are relative to the largest one. */
  protected readonly maxWeight = computed(() => Math.max(0.0001, ...this.rows().map((a) => this.weight(a))));

  protected sortMark(key: SortKey): string {
    return this.sortKey() === key ? (this.sortAsc() ? ' ↑' : ' ↓') : '';
  }

  protected bankName(id: string): string {
    return this.store.banks().find((b) => b.id === id)?.name ?? '';
  }

  protected weight(a: AssetRow): number {
    return this.total() > 0 ? a.valueEur / this.total() : 0;
  }

  // ---- Detail panel ----

  protected async open(asset: AssetRow): Promise<void> {
    this.selectedId.set(asset.id);
    this.detailLoading.set(true);
    this.detailMovements.set([]);
    try {
      const all = await this.api.movements(2000);
      if (this.selectedId() === asset.id) this.detailMovements.set(all.filter((m) => m.assetId === asset.id));
    } catch {
      // The panel still works without the history.
    } finally {
      this.detailLoading.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.store.movementDialog()) this.selectedId.set(null);
  }

  protected closeDetail(): void {
    this.selectedId.set(null);
  }

  protected action(kind: 'buy' | 'sell' | 'adjust'): void {
    const a = this.selected();
    if (!a) return;
    const mapped = kind === 'buy' && a.isLiquidity ? 'deposit' : kind === 'sell' && a.isLiquidity ? 'withdraw' : kind;
    this.selectedId.set(null);
    this.store.openMovement({ kind: mapped, assetId: a.id });
  }

  // ---- Asset dialog ----

  protected newAsset(bankId = ''): void {
    this.assetDraft = {
      id: null,
      bankId: bankId || this.bankFilter()[0] || this.store.banks()[0]?.id || '',
      name: '',
      typeCode: 'FUND',
      currency: 'EUR',
      symbol: '',
      manualPriceEur: null,
      annualRatePct: 8,
      regions: {}
    };
  }

  protected editAsset(asset: AssetRow): void {
    this.selectedId.set(null);
    this.assetDraft = {
      id: asset.id,
      bankId: asset.bankId,
      name: asset.name,
      typeCode: asset.typeCode,
      currency: asset.currency,
      symbol: asset.symbol ?? '',
      manualPriceEur: null,
      annualRatePct: asset.yieldRatePct ?? null,
      regions: { ...asset.regions }
    };
  }

  protected regionTotal(d: AssetDraft): number {
    return Object.values(d.regions).reduce((s: number, v) => s + (Number(v) || 0), 0);
  }

  /** Sets the whole asset to a single region. */
  protected setSingleRegion(d: AssetDraft, code: string): void {
    d.regions = { [code]: 100 };
  }

  private cleanRegions(d: AssetDraft): Record<string, number> | null {
    const entries = Object.entries(d.regions).map(([k, v]) => [k, Number(v) || 0] as const).filter(([, v]) => v > 0);
    return entries.length ? Object.fromEntries(entries) : null;
  }

  protected isLiquidType(code: string): boolean {
    return this.store.types().find((t) => t.code === code)?.isLiquidity ?? false;
  }

  protected symbolHint(code: string): string {
    switch (code) {
      case 'FUND': return 'Para fondos busca el ISIN en finance.yahoo.com; suele salir como 0P0000XXXX.F.';
      case 'CRYPTO': return 'P. ej. BTC-EUR, ETH-EUR o SOL-USD.';
      case 'ETF': return 'P. ej. VWCE.DE, CSPX.AS o el ISIN con mercado (.SG).';
      case 'REAL_ESTATE': return 'Normalmente sin ticker: el valor lo pones tú con un ajuste.';
      case 'METAL': return 'Oro: GC=F, plata: SI=F (precio por onza en USD). La cantidad, en onzas.';
      case 'LOANS': return 'Sin ticker: el valor crece cada día con la rentabilidad estimada.';
      default: return 'P. ej. SAN.MC (Madrid), AAPL (EE. UU.), WIZZ.L (Londres).';
    }
  }

  protected async saveAsset(): Promise<void> {
    const d = this.assetDraft;
    if (!d) return;
    if (d.name.trim().length < 2 || !d.bankId) {
      this.store.toast('error', 'Indica banco y nombre.');
      return;
    }
    this.saving.set(true);
    try {
      if (d.id) {
        await this.api.updateAsset(d.id, { name: d.name, symbol: d.symbol, currency: d.currency, regions: this.cleanRegions(d) });
        this.assetDraft = null;
        await this.store.changed('Activo actualizado');
      } else {
        const created = await this.api.createAsset({
          bankId: d.bankId, name: d.name, typeCode: d.typeCode, currency: d.currency,
          symbol: d.symbol, manualPriceEur: d.manualPriceEur ?? undefined,
          annualRatePct: d.typeCode === 'LOANS' ? d.annualRatePct ?? 8 : undefined
        });
        const regions = this.cleanRegions(d);
        if (regions) await this.api.updateAsset(created.id, { regions });
        const isCash = this.isLiquidType(d.typeCode);
        this.assetDraft = null;
        await this.store.changed('Activo creado');
        // Straight to the first purchase / deposit, which is what comes next anyway.
        this.store.openMovement({ kind: isCash ? 'deposit' : 'buy', assetId: created.id });
      }
    } catch (error) {
      this.store.error(error, 'No se pudo guardar el activo.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async deleteAsset(): Promise<void> {
    const d = this.assetDraft;
    if (!d?.id) return;
    if (!(await this.confirmDialog.ask(`¿Eliminar ${d.name}? Se borran también sus movimientos y su histórico de precios.`))) return;
    this.saving.set(true);
    try {
      await this.api.deleteAsset(d.id);
      this.assetDraft = null;
      await this.store.changed('Activo eliminado');
    } catch (error) {
      this.store.error(error, 'No se pudo eliminar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Bank dialog ----

  protected newBank(): void {
    this.bankDraft = { id: null, name: '' };
  }

  protected editBank(id: string): void {
    const bank = this.store.banks().find((b) => b.id === id);
    if (bank) this.bankDraft = { ...bank };
  }

  protected async saveBank(): Promise<void> {
    const d = this.bankDraft;
    if (!d || d.name.trim().length < 2) {
      this.store.toast('error', 'El nombre es demasiado corto.');
      return;
    }
    this.saving.set(true);
    try {
      if (d.id) await this.api.renameBank(d.id, d.name.trim());
      else await this.api.createBank(d.name.trim());
      this.bankDraft = null;
      await this.store.changed(d.id ? 'Banco renombrado' : 'Banco creado');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar el banco.');
    } finally {
      this.saving.set(false);
    }
  }
}

function readView(): 'cards' | 'table' {
  try {
    return localStorage.getItem('holdings.view') === 'table' ? 'table' : 'cards';
  } catch {
    return 'cards';
  }
}
