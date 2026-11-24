import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { AssetRow, MovementKind } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatMoney, formatPrice, formatQty, todayIso } from '../../shared/format.utils';

type BuyMode = 'qty' | 'amount';

@Component({
  selector: 'app-movement-dialog',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet],
  templateUrl: './movement-dialog.component.html',
  styleUrl: './movement-dialog.component.css'
})
export class MovementDialogComponent implements OnInit {
  protected readonly store = inject(PortfolioStore);
  private readonly api = inject(PortfolioApi);

  protected readonly kinds: Array<{ id: MovementKind; label: string }> = [
    { id: 'buy', label: 'Compra' },
    { id: 'sell', label: 'Venta' },
    { id: 'withdraw', label: 'Retirada' },
    { id: 'transfer', label: 'Traspaso' },
    { id: 'adjust', label: 'Ajuste' }
  ];

  protected readonly kind = signal<MovementKind>('buy');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly priceLoading = signal(false);
  protected readonly priceInfo = signal<string | null>(null);

  // Form state (plain fields bound with ngModel)
  protected assetId = '';
  protected toAssetId = '';
  protected date = todayIso();
  protected buyMode: BuyMode = 'qty';
  protected quantity: number | null = null;
  protected amount: number | null = null;
  protected price: number | null = null;
  protected buyPrice: number | null = null;
  protected fee: number | null = null;
  protected useCash = true;
  protected value: number | null = null;
  protected note = '';

  protected readonly fmt = { formatMoney, formatPrice, formatQty };
  protected readonly today = todayIso();

  protected readonly investable = computed(() =>
    this.store.assets().filter((a) => !a.isLiquidity).sort((a, b) => a.bankName.localeCompare(b.bankName) || a.name.localeCompare(b.name))
  );
  protected readonly cashAccounts = computed(() => this.store.assets().filter((a) => a.isLiquidity));
  /** Money from sales not reinvested yet (0 when the account doesn't exist). */
  protected readonly pendingCash = computed(() => this.cashAccounts().reduce((s, a) => s + a.valueEur, 0));
  protected readonly allAssets = computed(() =>
    [...this.store.assets()].sort((a, b) => a.bankName.localeCompare(b.bankName) || a.name.localeCompare(b.name))
  );
  protected readonly banksWithAssets = computed(() => {
    const groups = new Map<string, AssetRow[]>();
    for (const a of this.investable()) groups.set(a.bankName, [...(groups.get(a.bankName) ?? []), a]);
    return [...groups.entries()].map(([bank, assets]) => ({ bank, assets }));
  });
  protected readonly allByBank = computed(() => {
    const groups = new Map<string, AssetRow[]>();
    for (const a of this.allAssets()) groups.set(a.bankName, [...(groups.get(a.bankName) ?? []), a]);
    return [...groups.entries()].map(([bank, assets]) => ({ bank, assets }));
  });

  ngOnInit(): void {
    const preset = this.store.movementDialog() ?? {};
    if (preset.kind) this.kind.set(preset.kind);
    if (preset.assetId) this.assetId = preset.assetId;
    // Buying spends money from sales when there is some; selling always keeps it pending.
    this.useCash = this.kind() !== 'buy' || this.pendingCash() > 0;
    if (!this.assetId && (this.kind() === 'deposit' || this.kind() === 'withdraw')) {
      this.assetId = this.cashAccounts()[0]?.id ?? '';
    }
    if (this.assetId) void this.loadPrice();
  }

  protected asset(id = this.assetId): AssetRow | undefined {
    return this.store.assets().find((a) => a.id === id);
  }

  protected currencyLabel(): string {
    const currency = this.asset()?.currency ?? 'EUR';
    return currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency;
  }

  protected cashOf(asset: AssetRow | undefined): AssetRow | undefined {
    return asset ? this.cashAccounts().find((c) => c.bankId === asset.bankId) : undefined;
  }

  protected isManual(asset: AssetRow | undefined): boolean {
    return !!asset && !asset.isLiquidity && !asset.symbol;
  }

  protected setKind(kind: MovementKind): void {
    this.kind.set(kind);
    this.error.set(null);
    this.useCash = kind !== 'buy' || this.pendingCash() > 0;
    const current = this.asset();
    if (kind === 'deposit' || kind === 'withdraw') {
      if (!current?.isLiquidity) this.assetId = this.cashAccounts()[0]?.id ?? '';
    } else if (kind !== 'adjust' && current?.isLiquidity) {
      this.assetId = '';
    }
    void this.loadPrice();
  }

  protected onAssetChange(): void {
    void this.loadPrice();
  }

  protected async loadPrice(): Promise<void> {
    this.priceInfo.set(null);
    const kind = this.kind();
    const needsPrice = kind === 'buy' || kind === 'sell' || kind === 'transfer';
    const asset = this.asset();
    if (!needsPrice || !asset || !this.date) return;
    this.priceLoading.set(true);
    try {
      if (!asset.isLiquidity) {
        const q = await this.api.price(asset.id, this.date);
        this.price = round(q.priceLocal);
        this.priceInfo.set(q.date === this.date ? `Cierre del ${q.date}` : `Ultimo cierre disponible: ${q.date}`);
      }
      if (kind === 'transfer' && this.toAssetId) {
        const target = this.asset(this.toAssetId);
        if (target && !target.isLiquidity) {
          const q2 = await this.api.price(target.id, this.date);
          this.buyPrice = round(q2.priceLocal);
        }
      }
    } catch {
      this.priceInfo.set('No se encontro precio para ese dia, escribelo a mano.');
    } finally {
      this.priceLoading.set(false);
    }
  }

  /** Quantity actually bought/sold, whether typed or derived from an amount. */
  protected effectiveQty(): number {
    if (this.kind() === 'buy' && this.buyMode === 'amount') {
      const price = this.price ?? 0;
      const amount = (this.amount ?? 0) - (this.fee ?? 0);
      return price > 0 && amount > 0 ? amount / price : 0;
    }
    return this.quantity ?? 0;
  }

  protected total(): number {
    const qty = this.effectiveQty();
    const gross = qty * (this.price ?? 0);
    return this.kind() === 'sell' ? gross - (this.fee ?? 0) : gross + (this.fee ?? 0);
  }

  protected transferReceived(): number {
    const from = this.asset();
    const to = this.asset(this.toAssetId);
    if (!from || !to) return 0;
    const sellPrice = from.isLiquidity ? 1 : this.price ?? 0;
    const buyPrice = to.isLiquidity ? 1 : this.buyPrice ?? 0;
    // Approximation in the UI: same currency or EUR prices.
    const proceeds = (this.quantity ?? 0) * sellPrice * (from.priceEur && from.priceLocal ? from.priceEur / from.priceLocal : 1) - (this.fee ?? 0);
    const buyEur = buyPrice * (to.priceEur && to.priceLocal ? to.priceEur / to.priceLocal : 1);
    return buyEur > 0 ? proceeds / buyEur : 0;
  }

  protected setAll(): void {
    this.quantity = this.asset()?.quantity ?? null;
  }

  protected close(): void {
    this.store.closeMovement();
  }

  protected async save(): Promise<void> {
    this.error.set(null);
    const kind = this.kind();
    const asset = this.asset();
    if (!asset && kind !== 'withdraw') {
      this.error.set('Elige un activo.');
      return;
    }
    const body: Record<string, unknown> = { kind, date: this.date, note: this.note || undefined };
    if (kind === 'withdraw') {
      if (!(this.amount && this.amount > 0)) return this.error.set('Indica el importe.');
      if (this.amount > this.pendingCash() + 0.005) return this.error.set('No hay tanto dinero pendiente de reinvertir.');
      Object.assign(body, { amount: this.amount });
      return this.submit(body);
    }
    if (!asset) return;

    if (kind === 'buy' || kind === 'sell') {
      const qty = this.effectiveQty();
      if (!(qty > 0)) return this.error.set(kind === 'buy' && this.buyMode === 'amount' ? 'Indica el importe.' : 'Indica la cantidad.');
      if (!(this.price && this.price > 0)) return this.error.set('Indica el precio.');
      Object.assign(body, {
        assetId: asset.id, quantity: round(qty, 8), price: this.price, fee: this.fee ?? 0,
        useCash: this.useCash
      });
    } else if (kind === 'deposit') {
      if (!(this.amount && this.amount > 0)) return this.error.set('Indica el importe.');
      Object.assign(body, { assetId: asset.id, amount: this.amount });
    } else if (kind === 'transfer') {
      if (!this.toAssetId) return this.error.set('Elige el activo de destino.');
      if (!(this.quantity && this.quantity > 0)) return this.error.set('Indica la cantidad que traspasas.');
      Object.assign(body, {
        fromAssetId: asset.id, toAssetId: this.toAssetId, quantity: this.quantity,
        sellPrice: this.price, buyPrice: this.buyPrice, fee: this.fee ?? 0
      });
    } else if (kind === 'adjust') {
      if (this.isManual(asset)) {
        if (this.value === null || this.value < 0) return this.error.set('Indica el valor actual.');
        body['assetId'] = asset.id;
        body['value'] = this.value;
      } else {
        if (this.quantity === null || this.quantity < 0) return this.error.set('Indica la cantidad que tienes ahora.');
        body['assetId'] = asset.id;
        body['quantity'] = this.quantity;
      }
    }

    return this.submit(body);
  }

  private async submit(body: Record<string, unknown>): Promise<void> {
    this.saving.set(true);
    try {
      await this.api.createMovement(body);
      this.store.closeMovement();
      await this.store.changed('Movimiento guardado');
    } catch (error) {
      const message = (error as any)?.error?.message ?? 'No se pudo guardar.';
      this.error.set(message);
    } finally {
      this.saving.set(false);
    }
  }
}

function round(value: number, decimals = 6): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
