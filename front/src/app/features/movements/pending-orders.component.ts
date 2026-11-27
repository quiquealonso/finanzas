import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatDay, formatQty } from '../../shared/format.utils';
import { ConfirmService } from '../../shared/confirm-dialog.component';
import { API_ORIGIN } from '../../core/api-origin';

type PendingOrder = {
  id: string; broker: string; orderNo: string | null; kind: 'buy' | 'sell'; isin: string | null; name: string;
  market: string | null; currency: string; quantity: number; limitPrice: number | null; modality: string | null;
  validFrom: string | null; validTo: string | null; orderedAt: string | null; modified: boolean;
  /** Estimate from the market prices of its validity (back: executionHint). */
  hint: { status: 'likely' | 'unlikely' | 'open' | 'unknown'; text: string; day?: string; price?: number };
};
type Draft = { date: string; price: number | null; quantity: number; fee: number };

const BASE = `${API_ORIGIN}/api/v2/pending-orders`;

/**
 * Orders read from e-mail that the broker never confirmed (BBVA only sends the order): the user says whether
 * each one was executed (with the real date, price, units and fee) or not.
 */
@Component({
  selector: 'app-pending-orders',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (orders().length) {
      <section class="card">
        <div class="card-head">
          <div>
            <h2>Órdenes por confirmar</h2>
            <p class="muted small">BBVA solo envía la orden, no la ejecución. Dinos si se ejecutó y a qué precio (lo ves en la app de BBVA). Sin precio se usa el límite o, a mercado, el cierre de ese día.</p>
          </div>
          <span class="spacer"></span>
          @if (unlikely()) {
            <button type="button" class="btn" (click)="cancelUnlikely()" [disabled]="!!busy()" title="Las que, por precio y fechas, probablemente no se ejecutaron">
              {{ busy() === 'unlikely' ? 'Descartando…' : 'Descartar improbables (' + unlikely() + ')' }}
            </button>
          }
          <button type="button" class="btn primary" (click)="executeAll()" [disabled]="!!busy()">
            {{ busy() === 'all' ? 'Confirmando…' : 'Confirmar todas (' + orders().length + ')' }}
          </button>
        </div>
        <ul class="tiles orders">
          @for (o of orders(); track o.id) {
            @let d = drafts[o.id];
            <li class="tile" [class.dim]="o.hint.status === 'unlikely'">
              <div class="tile-name">
                <span class="tile-label">{{ o.name }}</span>
                <span class="badge" [class.k-buy]="o.kind === 'buy'" [class.k-sell]="o.kind === 'sell'">{{ o.kind === 'buy' ? 'Compra' : 'Venta' }}</span>
              </div>
              <div class="tile-sub">{{ o.broker }} · {{ o.market }} · {{ o.isin }}{{ o.modified ? ' · modificada' : '' }}</div>
              <div class="tile-big">
                <strong>{{ fmtQty(o.quantity) }} títulos</strong>
                <span class="tile-aside">{{ o.limitPrice ? (o.modality?.toLowerCase() + ' ' + o.limitPrice + ' ' + o.currency) : (o.modality?.toLowerCase() ?? '') }}</span>
              </div>
              <div class="tile-sub">Válida {{ o.validFrom ? fmtDay(o.validFrom) : '' }} → {{ o.validTo ? fmtDay(o.validTo) : '' }}</div>
              @if (o.hint.text) {
                <p class="hint" [class]="'hint ' + o.hint.status">{{ o.hint.text }}</p>
              }
              <div class="form">
                <label>Fecha <input type="date" [(ngModel)]="d.date" [name]="'d' + o.id" /></label>
                <label>Precio {{ o.currency }} <input type="number" step="any" min="0" [(ngModel)]="d.price" [name]="'p' + o.id" [placeholder]="o.limitPrice ? '' : 'cierre'" /></label>
                <label>Títulos <input type="number" step="any" min="0" [(ngModel)]="d.quantity" [name]="'q' + o.id" /></label>
                <label>Comisión <input type="number" step="any" min="0" [(ngModel)]="d.fee" [name]="'f' + o.id" /></label>
              </div>
              <div class="tile-foot">
                <button type="button" class="btn sm link" (click)="cancel(o)" [disabled]="!!busy()">No se ejecutó</button>
                <button type="button" class="btn sm primary" (click)="execute(o)" [disabled]="!!busy()">
                  {{ busy() === o.id ? '…' : 'Se ejecutó' }}
                </button>
              </div>
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    /* 6 cards per row on a normal screen, fewer when narrower. */
    .orders { grid-template-columns: repeat(6, minmax(0, 1fr)); }
    @media (max-width: 1500px) { .orders { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
    @media (max-width: 1250px) { .orders { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (max-width: 1000px) { .orders { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 700px) { .orders { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 420px) { .orders { grid-template-columns: minmax(0, 1fr); } }
    .card-head { display: flex; align-items: flex-start; gap: 12px; }
    .form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 8px; margin: 4px 0; }
    .form label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: var(--text-3); min-width: 0; white-space: nowrap; }
    .form input { width: 100%; min-width: 0; box-sizing: border-box; padding: 4px 6px; font-size: 12.5px; height: 30px; }
    .form input[type=date] { padding: 4px 4px; }
    .tile-name .badge { margin-left: auto; flex: none; }
    .hint { margin: 2px 0; padding: 6px 8px; border-radius: 6px; font-size: 11.5px; line-height: 1.35; }
    .hint.likely { background: var(--up-soft); color: var(--up); }
    .hint.unlikely { background: var(--warn-soft, rgba(234,179,8,0.14)); color: var(--warn-text, #b7791f); }
    .hint.open { background: var(--accent-soft); color: var(--accent-text); }
    .hint.unknown { background: var(--surface-2); color: var(--text-3); }
    .tile.dim { opacity: 0.75; }
    .k-buy { background: var(--accent-soft); color: var(--accent-text); }
    .k-sell { background: var(--down-soft); color: var(--down); }
  `
})
export class PendingOrdersComponent {
  private readonly confirmDialog = inject(ConfirmService);
  private readonly http = inject(HttpClient);
  private readonly store = inject(PortfolioStore);
  protected readonly orders = signal<PendingOrder[]>([]);
  protected readonly busy = signal<string | null>(null);
  protected drafts: Record<string, Draft> = {};
  protected readonly fmtDay = formatDay;
  protected readonly fmtQty = formatQty;

  constructor() {
    effect(() => {
      this.store.version();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      const { orders } = await firstValueFrom(this.http.get<{ orders: PendingOrder[] }>(BASE));
      for (const o of orders) {
        // Prefilled with the estimate when it says when and at what price it would have filled.
        this.drafts[o.id] ??= {
          date: o.hint.day ?? o.validFrom ?? (o.orderedAt ?? '').slice(0, 10),
          price: o.hint.price ?? o.limitPrice, quantity: o.quantity, fee: 0
        };
      }
      this.orders.set(orders);
    } catch {
      this.orders.set([]);
    }
  }

  protected async execute(o: PendingOrder): Promise<void> {
    this.busy.set(o.id);
    try {
      await firstValueFrom(this.http.post(`${BASE}/${o.id}/execute`, this.drafts[o.id]));
      await this.store.changed(`${o.kind === 'buy' ? 'Compra' : 'Venta'} de ${o.name} registrada`);
    } catch (error) {
      this.store.error(error, 'No se pudo registrar.');
    } finally {
      this.busy.set(null);
    }
  }

  /** Every pending order as executed, with what is filled in each card (missing price: limit or close). */
  protected async executeAll(): Promise<void> {
    const n = this.orders().length;
    if (!(await this.confirmDialog.ask(`¿Confirmar las ${n} órdenes como ejecutadas? Se crearán ${n} compras o ventas. Las que no tengan precio usarán el límite o, a mercado, el cierre de ese día. Si alguna no se ejecutó, márcala antes con «No se ejecutó».`, { title: 'Confirmar todas', ok: `Confirmar ${n}` }))) return;
    this.busy.set('all');
    try {
      const items = this.orders().map((o) => ({ id: o.id, ...this.drafts[o.id] }));
      const r = await firstValueFrom(this.http.post<{ done: number; failed: Array<{ name: string; error: string }> }>(`${BASE}/execute-all`, { items }));
      await this.store.changed(`${r.done} órdenes confirmadas${r.failed.length ? `, ${r.failed.length} con error` : ''}`);
      if (r.failed.length) this.store.toast('error', r.failed.map((f) => `${f.name}: ${f.error}`).join(' · '));
    } catch (error) {
      this.store.error(error, 'No se pudieron confirmar.');
    } finally {
      this.busy.set(null);
    }
  }

  protected unlikely(): number {
    return this.orders().filter((o) => o.hint.status === 'unlikely').length;
  }

  protected async cancelUnlikely(): Promise<void> {
    const n = this.unlikely();
    if (!(await this.confirmDialog.ask(`¿Marcar como no ejecutadas las ${n} órdenes que, por precio y fechas, probablemente no se ejecutaron?`, { title: 'Descartar improbables', ok: `Descartar ${n}` }))) return;
    this.busy.set('unlikely');
    try {
      const r = await firstValueFrom(this.http.post<{ cancelled: number }>(`${BASE}/cancel-unlikely`, {}));
      this.store.toast('ok', `${r.cancelled} órdenes descartadas`);
      await this.load();
    } catch (error) {
      this.store.error(error, 'No se pudieron descartar.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async cancel(o: PendingOrder): Promise<void> {
    if (!(await this.confirmDialog.ask(`¿La orden de ${o.name} no se ejecutó? Se quitará de la lista.`, { title: 'No se ejecutó', ok: 'Quitar de la lista' }))) return;
    this.busy.set(o.id);
    try {
      await firstValueFrom(this.http.post(`${BASE}/${o.id}/cancel`, {}));
      await this.load();
    } finally {
      this.busy.set(null);
    }
  }
}
