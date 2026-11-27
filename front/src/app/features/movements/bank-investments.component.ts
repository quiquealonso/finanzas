import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatDay, formatMoney, formatQty } from '../../shared/format.utils';
import { API_ORIGIN } from '../../core/api-origin';

type Item = {
  id: string; date: string; amount: number; side: 'buy' | 'sell'; kind: 'trade' | 'securities' | 'platform'; text: string; fromBank: string;
  isin: string | null; name: string | null; quantity: number | null; platform: string | null;
  bankId: string | null; bankName: string | null; assetId: string | null; assetName: string | null;
  status: string | null; operationId: string | null;
  match: { id: string; day: string; assetName: string; sure: boolean } | null;
  partOf: { id: string; day: string; assetName: string; quantity: number } | null;
  ready: boolean;
};
type Draft = { bankId: string; assetId: string; newName: string; quantity: number | null; amount: number; open: boolean };

const BASE = `${API_ORIGIN}/api/v2/banking/investments`;

/**
 * Investments found in the bank accounts (page Gastos): each one ready to be noted in the portfolio. The ones that are
 * already there are only linked; complete ones are noted with one click; the rest ask for what is missing.
 * Data and matching: back/src/bank-investments.ts.
 */
@Component({
  selector: 'app-bank-investments',
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (items().length) {
      <section class="card" data-tour="mov-bank-inv">
        <div class="card-head">
          <button type="button" class="fold" (click)="toggle()" [attr.aria-expanded]="open()">
            <span class="chev" [class.on]="open()">›</span>
            <h2>Inversiones en tus cuentas</h2>
            <span class="count">{{ items().length }} por revisar</span>
          </button>
          <span class="spacer"></span>
          @if (open()) {
            @if (matched().length) {
              <button type="button" class="btn" (click)="linkAll()" [disabled]="!!busy()" title="Las que ya están en tu cartera: se enlazan, no se apunta nada nuevo">
                {{ busy() === 'link' ? 'Enlazando…' : 'Ya las tengo (' + matched().length + ')' }}
              </button>
            }
            @if (ready().length) {
              <button type="button" class="btn primary" (click)="applyAll()" [disabled]="!!busy()">
                {{ busy() === 'apply' ? 'Apuntando…' : 'Apuntar las listas (' + ready().length + ')' }}
              </button>
            }
          }
        </div>
        @if (!open()) {
          <p class="muted small">{{ ready().length }} listas para apuntar, {{ matched().length }} parecen ya apuntadas y {{ incomplete().length }} necesitan datos. Detectadas en los movimientos de tus bancos (Gastos).</p>
        } @else {
          <p class="muted small">Compras, ventas y dinero enviado a plataformas que se ven en tus cuentas. Nada se apunta hasta que lo digas.</p>
          <div class="table-wrap">
            <table class="inv">
              <thead><tr><th>Fecha</th><th>En el banco</th><th class="r">Importe</th><th>En tu cartera</th><th></th></tr></thead>
              <tbody>
                @for (it of items(); track it.id) {
                  @let d = drafts()[it.id];
                  <tr>
                    <td class="nowrap">{{ day(it.date) }}</td>
                    <td>
                      <div class="txt" [title]="it.text">{{ it.text }}</div>
                      <div class="faint small">{{ it.fromBank }} · {{ it.side === 'buy' ? 'compra' : 'venta' }}{{ it.platform && it.platform !== it.fromBank ? ' · a ' + it.platform : '' }}</div>
                    </td>
                    <td class="r num nowrap">{{ money(it.amount) }}</td>
                    <td class="state">
                      @if (it.match) {
                        <span class="tag ok">Ya apuntada</span> {{ it.side === 'buy' ? 'compra' : 'venta' }} de {{ it.match.assetName }} del {{ day(it.match.day) }}
                      } @else if (it.partOf) {
                        <span class="tag maybe">¿Incluida?</span> en tu compra de {{ qty(it.partOf.quantity) }} {{ it.partOf.assetName }} del {{ day(it.partOf.day) }}
                      } @else if (it.ready && !d.open) {
                        <span class="tag new">Lista</span> {{ it.side === 'buy' ? 'compra' : 'venta' }} de {{ qty(it.quantity!) }} {{ it.assetName ?? it.name }} en {{ it.bankName }}{{ it.assetId ? '' : ' (activo nuevo)' }}
                      } @else {
                        <div class="form">
                          <select [ngModel]="d.bankId" (ngModelChange)="setDraft(it.id, { bankId: $event, assetId: '' })" title="Banco o plataforma de la inversión">
                            <option value="">Banco…</option>
                            @for (b of banks(); track b.id) { <option [value]="b.id">{{ b.name }}</option> }
                          </select>
                          <select [ngModel]="d.assetId" (ngModelChange)="setDraft(it.id, { assetId: $event })" [disabled]="!d.bankId">
                            <option value="">Activo nuevo…</option>
                            @for (a of assetsOf(d.bankId); track a.id) { <option [value]="a.id">{{ a.name }}</option> }
                          </select>
                          @if (!d.assetId) { <input type="text" placeholder="Nombre" [ngModel]="d.newName" (ngModelChange)="setDraft(it.id, { newName: $event })" /> }
                          <input type="number" step="any" min="0" placeholder="Títulos" [ngModel]="d.quantity" (ngModelChange)="setDraft(it.id, { quantity: $event })" title="Títulos o participaciones (en préstamos o inmobiliario, el importe)" />
                        </div>
                      }
                    </td>
                    <td class="actions nowrap">
                      @if (it.match || it.partOf) {
                        <button type="button" class="btn sm primary" (click)="link(it)" [disabled]="!!busy()">Sí, es esa</button>
                        <button type="button" class="btn sm link" (click)="separate(it)" [disabled]="!!busy()">No, apuntar</button>
                      } @else if (it.ready && !d.open) {
                        <button type="button" class="btn sm primary" (click)="apply(it)" [disabled]="!!busy()">{{ busy() === it.id ? '…' : 'Apuntar' }}</button>
                        <button type="button" class="btn sm link" (click)="setDraft(it.id, { open: true })">Cambiar</button>
                      } @else {
                        <button type="button" class="btn sm primary" (click)="apply(it)" [disabled]="!!busy() || !d.bankId || !d.quantity || (!d.assetId && !d.newName.trim())">{{ busy() === it.id ? '…' : 'Apuntar' }}</button>
                      }
                      <button type="button" class="btn sm link" (click)="ignore(it)" [disabled]="!!busy()" title="No es una inversión, o no la quieres en la cartera">Ignorar</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    }
  `,
  styles: `
    .card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .fold { display: inline-flex; align-items: center; gap: 8px; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; padding: 0; }
    .fold h2 { margin: 0; }
    .chev { display: inline-block; transition: transform 0.15s; font-size: 18px; color: var(--text-3); }
    .chev.on { transform: rotate(90deg); }
    .count { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--warn-soft); color: var(--warn-text); }
    table.inv { width: 100%; border-collapse: collapse; font-size: 13px; }
    table.inv th { text-align: left; font-size: 12px; font-weight: 600; color: var(--text-3); padding: 6px 8px; border-bottom: 1px solid var(--border); }
    table.inv td { padding: 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
    table.inv tbody tr:nth-child(even) { background: color-mix(in srgb, var(--surface-2) 50%, transparent); }
    .r { text-align: right; }
    .nowrap { white-space: nowrap; }
    .txt { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; margin-right: 4px; }
    .tag.ok { background: var(--up-soft); color: var(--up); }
    .tag.maybe { background: var(--warn-soft); color: var(--warn-text); }
    .tag.new { background: var(--accent-soft); color: var(--accent-text); }
    .form { display: flex; gap: 6px; flex-wrap: wrap; }
    .form select { width: 150px; height: 30px; font-size: 12.5px; }
    .form input { width: 120px; height: 30px; font-size: 12.5px; }
    .actions { text-align: right; }
  `
})
export class BankInvestmentsComponent {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PortfolioStore);
  protected readonly money = formatMoney;
  protected readonly day = formatDay;
  protected readonly qty = formatQty;

  protected readonly items = signal<Item[]>([]);
  protected readonly banks = signal<Array<{ id: string; name: string }>>([]);
  protected readonly drafts = signal<Record<string, Draft>>({});
  protected readonly busy = signal<string | null>(null);
  protected readonly open = signal(readOpen());

  protected readonly matched = computed(() => this.items().filter((i) => i.match));
  protected readonly ready = computed(() => this.items().filter((i) => i.ready && !i.match && !i.partOf && !this.drafts()[i.id]?.open));
  protected readonly incomplete = computed(() => this.items().filter((i) => !i.match && !i.partOf && !i.ready));

  constructor() {
    effect(() => {
      this.store.version();
      void this.load();
    });
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<{ items: Item[]; banks: Array<{ id: string; name: string }> }>(BASE));
      this.banks.set(r.banks);
      this.items.set(r.items);
      const drafts: Record<string, Draft> = {};
      for (const i of r.items) drafts[i.id] = this.drafts()[i.id] ?? { bankId: i.bankId ?? '', assetId: i.assetId ?? '', newName: i.name ?? '', quantity: i.quantity, amount: i.amount, open: false };
      this.drafts.set(drafts);
    } catch {
      this.items.set([]); // no bank connected (or the demo): the block does not show
    }
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    try { localStorage.setItem('finanzas.bankInvOpen', this.open() ? '1' : '0'); } catch { /* storage blocked */ }
  }

  protected assetsOf(bankId: string) {
    return this.store.assets().filter((a) => a.bankId === bankId && !a.isLiquidity);
  }

  protected setDraft(id: string, patch: Partial<Draft>): void {
    this.drafts.update((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  protected separate(it: Item): void {
    // "No, it is not that one": forget the suggestion and ask for the data.
    this.items.update((list) => list.map((x) => (x.id === it.id ? { ...x, match: null, partOf: null, ready: false } : x)));
    this.setDraft(it.id, { open: true });
  }

  private async post(path: string, body: unknown = {}): Promise<void> {
    await firstValueFrom(this.http.post(`${BASE}/${path}`, body));
  }

  protected async link(it: Item): Promise<void> {
    await this.run(it.id, () => this.post(`${it.id}/link`, { operationId: (it.match ?? it.partOf)?.id }), 'Enlazada con tu cartera.');
  }

  protected async ignore(it: Item): Promise<void> {
    await this.run(it.id, () => this.post(`${it.id}/ignore`), 'Ignorada.');
  }

  protected async apply(it: Item): Promise<void> {
    const d = this.drafts()[it.id];
    const body = it.ready && !d.open ? {} : { bankId: d.bankId, assetId: d.assetId || undefined, newName: d.newName, quantity: d.quantity, amount: d.amount };
    await this.run(it.id, () => this.post(`${it.id}/apply`, body), 'Apuntada en tu cartera.', true);
  }

  protected async linkAll(): Promise<void> {
    await this.run('link', async () => { for (const it of this.matched()) await this.post(`${it.id}/link`, { operationId: it.match!.id }); }, 'Enlazadas con tu cartera.');
  }

  protected async applyAll(): Promise<void> {
    await this.run('apply', async () => { for (const it of this.ready()) await this.post(`${it.id}/apply`); }, 'Apuntadas en tu cartera.', true);
  }

  private async run(key: string, fn: () => Promise<void>, ok: string, changesPortfolio = false): Promise<void> {
    this.busy.set(key);
    try {
      await fn();
      if (changesPortfolio) await this.store.changed(ok);
      else { this.store.toast('ok', ok); await this.load(); }
    } catch (e) {
      this.store.error(e);
      await this.load();
    } finally {
      this.busy.set(null);
    }
  }
}

function readOpen(): boolean {
  try { return localStorage.getItem('finanzas.bankInvOpen') === '1'; } catch { return false; }
}
