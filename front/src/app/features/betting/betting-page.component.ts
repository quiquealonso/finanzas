import { Component, inject, OnInit, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { FinanceApiService } from '../../finance-api.service';
import { BettingDashboardData, BettingTransactionType } from '../../models/finance.models';
import { BettingPanelComponent } from './betting-panel.component';
import { ConfirmService } from '../../shared/confirm-dialog.component';

// Page wrapper that owns the betting data; the panel itself only renders and emits.
@Component({
  selector: 'app-betting-page',
  standalone: true,
  imports: [BettingPanelComponent],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <h1>Apuestas</h1>
          <p>Lo que metes y sacas de cada casa de apuestas. Beneficio = retirado menos ingresado.</p>
        </div>
      </div>
      <app-betting-panel
        [year]="year()"
        [dashboard]="dashboard()"
        [actionInProgress]="busy()"
        (yearChange)="setYear($event)"
        (createHouse)="addHouse($event)"
        (removeHouse)="removeHouse($event)"
        (createTransaction)="addTransaction($event)"
        (removeTransaction)="removeTransaction($event)"
      />
    </div>
  `
})
export class BettingPageComponent implements OnInit {
  private readonly confirmDialog = inject(ConfirmService);
  private readonly api = inject(FinanceApiService);
  private readonly store = inject(PortfolioStore);

  protected readonly year = signal(new Date().getFullYear());
  protected readonly dashboard = signal<BettingDashboardData>(this.empty());
  protected readonly busy = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected async setYear(year: number): Promise<void> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
    this.year.set(year);
    await this.load();
  }

  protected async addHouse(name: string): Promise<void> {
    if (name.trim().length < 2) {
      this.store.toast('error', 'El nombre de la casa debe tener al menos 2 caracteres.');
      return;
    }
    await this.run(async () => {
      await firstValueFrom(this.api.createBettingHouse(name.trim(), this.year()));
      await this.load();
    }, 'Casa de apuestas creada');
  }

  protected async addTransaction(draft: { bettingHouseId: string; type: BettingTransactionType; amount: number; date: string; note: string }): Promise<void> {
    if (!draft.bettingHouseId) return this.store.toast('error', 'Selecciona una casa de apuestas.');
    if (!(Number(draft.amount) > 0)) return this.store.toast('error', 'El importe debe ser mayor que cero.');
    await this.run(async () => {
      this.dashboard.set(await firstValueFrom(this.api.createBettingTransaction({
        bettingHouseId: draft.bettingHouseId, type: draft.type, amount: Number(draft.amount), date: draft.date, note: draft.note.trim()
      }, this.year())));
    }, 'Movimiento guardado');
  }

  protected async removeHouse(id: string): Promise<void> {
    if (!(await this.confirmDialog.ask('¿Eliminar esta casa de apuestas y sus movimientos?'))) return;
    await this.run(async () => this.dashboard.set(await firstValueFrom(this.api.deleteBettingHouse(id, this.year()))), 'Casa eliminada');
  }

  protected async removeTransaction(id: string): Promise<void> {
    if (!(await this.confirmDialog.ask('¿Eliminar este movimiento?'))) return;
    await this.run(async () => this.dashboard.set(await firstValueFrom(this.api.deleteBettingTransaction(id, this.year()))), 'Movimiento eliminado');
  }

  private async load(): Promise<void> {
    try {
      this.dashboard.set(await firstValueFrom(this.api.getBettingDashboard(this.year())));
    } catch (error) {
      this.dashboard.set(this.empty());
      this.store.error(error, 'No se pudieron cargar las apuestas.');
    }
  }

  private async run(action: () => Promise<void>, ok: string): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.store.toast('ok', ok);
    } catch (error) {
      this.store.error(error);
    } finally {
      this.busy.set(false);
    }
  }

  private empty(): BettingDashboardData {
    return { year: this.year?.() ?? new Date().getFullYear(), houses: [], transactions: [], totals: { deposits: 0, withdrawals: 0, net: 0 } };
  }
}
