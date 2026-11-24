import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatSignedMoney, signClass } from '../../shared/format.utils';
import {
  BettingDashboardData,
  BettingTransactionType,
  BettingHouseSummary
} from '../../models/finance.models';

const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);

@Component({
  selector: 'app-betting-panel',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './betting-panel.component.html',
  styleUrl: './betting-panel.component.css'
})
export class BettingPanelComponent {
  @Input({ required: true }) year!: number;
  @Input() dashboard: BettingDashboardData = {
    year: new Date().getFullYear(),
    houses: [],
    transactions: [],
    totals: {
      deposits: 0,
      withdrawals: 0,
      net: 0
    }
  };
  @Input({ required: true }) actionInProgress!: boolean;

  @Output() readonly yearChange = new EventEmitter<number>();
  @Output() readonly createHouse = new EventEmitter<string>();
  @Output() readonly removeHouse = new EventEmitter<string>();
  @Output() readonly createTransaction = new EventEmitter<{
    bettingHouseId: string;
    type: BettingTransactionType;
    amount: number;
    date: string;
    note: string;
  }>();
  @Output() readonly removeTransaction = new EventEmitter<string>();

  protected newBettingHouseName = '';
  protected showTransactionDialog = false;
  protected transactionDraft: {
    bettingHouseId: string;
    type: BettingTransactionType;
    amount: number;
    date: string;
    note: string;
  } = {
    bettingHouseId: '',
    type: 'DEPOSIT',
    amount: 0,
    date: new Date().toISOString().slice(0, 10),
    note: ''
  };

  protected updateYear(value: string): void {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      return;
    }

    this.yearChange.emit(parsed);
  }

  protected submitHouse(): void {
    const name = this.newBettingHouseName.trim();
    if (!name) {
      return;
    }

    this.createHouse.emit(name);
    this.newBettingHouseName = '';
  }

  protected openTransactionDialog(): void {
    if (this.dashboard.houses.length === 0) {
      return;
    }

    this.syncSelectedHouse();
    this.transactionDraft.type = 'DEPOSIT';
    this.transactionDraft.amount = 0;
    this.transactionDraft.note = '';
    this.transactionDraft.date = new Date().toISOString().slice(0, 10);
    this.showTransactionDialog = true;
  }

  protected closeTransactionDialog(): void {
    this.showTransactionDialog = false;
  }

  protected submitTransaction(): void {
    if (!this.transactionDraft.bettingHouseId) {
      return;
    }

    this.createTransaction.emit({
      bettingHouseId: this.transactionDraft.bettingHouseId,
      type: this.transactionDraft.type,
      amount: Number(this.transactionDraft.amount),
      date: this.transactionDraft.date,
      note: this.transactionDraft.note.trim()
    });
    this.closeTransactionDialog();
  }

  protected readonly signClass = signClass;
  protected readonly signedMoney = formatSignedMoney;

  protected money(value: number): string {
    return money.format(value);
  }

  /** My result in a house: what I took out minus what I put in. */
  protected profit(house: BettingHouseSummary): number {
    return house.withdrawals - house.deposits;
  }

  protected get totalProfit(): number {
    return this.dashboard.totals.withdrawals - this.dashboard.totals.deposits;
  }

  /** Oldest movement of the year shown. */
  protected get firstDate(): string | null {
    const dates = this.dashboard.transactions.map((t) => t.date).sort();
    return dates[0] ?? null;
  }

  protected formatDate(day: string): string {
    return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  }

  protected get hasHouses(): boolean {
    return this.dashboard.houses.length > 0;
  }

  private syncSelectedHouse(): void {
    if (this.dashboard.houses.length === 0) {
      this.transactionDraft.bettingHouseId = '';
      return;
    }

    const stillValid = this.dashboard.houses.some((house) => house.id === this.transactionDraft.bettingHouseId);
    if (!stillValid) {
      this.transactionDraft.bettingHouseId = this.dashboard.houses[0].id;
    }
  }
}