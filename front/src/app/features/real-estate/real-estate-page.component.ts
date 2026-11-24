import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { RealEstateTicket } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatDay, formatMoney, formatSignedMoney, signClass, todayIso } from '../../shared/format.utils';
import { ConfirmService } from '../../shared/confirm-dialog.component';

type Tab = 'open' | 'collected';

@Component({
  selector: 'app-real-estate-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './real-estate-page.component.html',
  styleUrl: './real-estate-page.component.css'
})
export class RealEstatePageComponent {
  private readonly confirmDialog = inject(ConfirmService);
  protected readonly store = inject(PortfolioStore);
  private readonly api = inject(PortfolioApi);

  protected readonly tickets = signal<RealEstateTicket[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly tab = signal<Tab>('open');
  protected readonly today = todayIso();
  protected readonly fmt = { formatDay, formatMoney, formatSignedMoney, signClass };

  protected newDraft: { name: string; bankName: string; amountEur: number; ratePct: number; termMonths: number; startDate: string; useCash: boolean } | null = null;
  protected editDraft: { id: string; name: string; ratePct: number; termMonths: number | null; startDate: string } | null = null;
  protected collectDraft: { ticket: RealEstateTicket; date: string; amountEur: number; useCash: boolean } | null = null;

  constructor() {
    effect(() => {
      this.store.version();
      void this.load();
    });
  }

  protected readonly open = computed(() =>
    this.tickets()
      .filter((t) => t.status !== 'collected')
      // Pending collection first, then by maturity.
      .sort((a, b) => rank(a) - rank(b) || (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'))
  );

  protected readonly collected = computed(() =>
    this.tickets().filter((t) => t.status === 'collected').sort((a, b) => (b.collectedDate ?? '').localeCompare(a.collectedDate ?? ''))
  );

  protected readonly kpis = computed(() => {
    const open = this.open();
    const invested = open.reduce((s, t) => s + t.investedEur, 0);
    const accrued = open.reduce((s, t) => s + (t.accruedEur ?? 0), 0);
    const expected = open.reduce((s, t) => s + (t.expectedInterestEur ?? 0), 0);
    const rate = invested > 0 ? open.reduce((s, t) => s + t.ratePct * t.investedEur, 0) / invested : 0;
    const matured = open.filter((t) => t.status === 'matured');
    const earned = this.collected().reduce((s, t) => s + (t.realizedEur ?? 0), 0);
    const next = open.filter((t) => t.status === 'active' && t.endDate).sort((a, b) => a.endDate!.localeCompare(b.endDate!))[0] ?? null;
    return { invested, accrued, expected, rate, matured, earned, next, count: open.length };
  });

  /** Upcoming maturities grouped by month, for the calendar strip. */
  protected readonly calendar = computed(() => {
    const map = new Map<string, { month: string; amount: number; count: number }>();
    for (const t of this.open()) {
      if (!t.endDate) continue;
      const key = t.endDate.slice(0, 7);
      const row = map.get(key) ?? { month: key, amount: 0, count: 0 };
      row.amount += t.investedEur + (t.expectedInterestEur ?? 0);
      row.count += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  });

  protected readonly platforms = computed(() => {
    const names = new Set(this.tickets().map((t) => t.bankName));
    names.add('WeCity');
    return [...names];
  });

  protected monthLabel(key: string): string {
    const [y, m] = key.split('-');
    return `${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(m) - 1]} ${y.slice(2)}`;
  }

  protected statusLabel(t: RealEstateTicket): string {
    switch (t.status) {
      case 'matured': return t.daysToEnd !== null && t.daysToEnd < -30 ? 'Retrasado' : 'Pendiente de cobro';
      case 'collected': return 'Cobrado';
      case 'incomplete': return 'Faltan datos';
      default: return t.daysToEnd !== null && t.daysToEnd <= 30 ? `Vence en ${t.daysToEnd} días` : 'En curso';
    }
  }

  protected hasCash(bankName: string): boolean {
    return this.store.assets().some((a) => a.isLiquidity && a.bankName === bankName);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.tickets.set(await this.api.realEstate());
    } catch (error) {
      this.store.error(error, 'No se pudieron cargar los tickets.');
    } finally {
      this.loading.set(false);
    }
  }

  // ---- New ticket ----

  protected openNew(): void {
    this.newDraft = { name: '', bankName: 'WeCity', amountEur: 500, ratePct: 11, termMonths: 12, startDate: this.today, useCash: false };
  }

  protected preview(d: { amountEur: number; ratePct: number; termMonths: number; startDate: string }): { end: string; interest: number } | null {
    if (!d.amountEur || !d.termMonths || !d.startDate) return null;
    const start = new Date(`${d.startDate}T12:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + Number(d.termMonths));
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    return { end: end.toISOString().slice(0, 10), interest: d.amountEur * ((d.ratePct || 0) / 100) * (days / 365) };
  }

  protected async saveNew(): Promise<void> {
    const d = this.newDraft;
    if (!d) return;
    if (d.name.trim().length < 2) return this.store.toast('error', 'Indica el nombre del proyecto.');
    this.saving.set(true);
    try {
      await this.api.createTicket({ ...d, useCash: d.useCash && this.hasCash(d.bankName) });
      this.newDraft = null;
      await this.store.changed('Ticket añadido');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar el ticket.');
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Edit ----

  protected openEdit(t: RealEstateTicket): void {
    this.editDraft = { id: t.assetId, name: t.name, ratePct: t.ratePct, termMonths: t.termMonths, startDate: t.startDate ?? this.today };
  }

  protected async saveEdit(): Promise<void> {
    const d = this.editDraft;
    if (!d) return;
    if (!d.termMonths) return this.store.toast('error', 'Indica el plazo en meses.');
    this.saving.set(true);
    try {
      await this.api.updateTicket(d.id, { name: d.name, ratePct: d.ratePct, termMonths: d.termMonths, startDate: d.startDate });
      this.editDraft = null;
      await this.store.changed('Ticket actualizado');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const d = this.editDraft;
    if (!d || !(await this.confirmDialog.ask(`¿Eliminar el ticket ${d.name}? Se borra con sus movimientos.`))) return;
    this.saving.set(true);
    try {
      await this.api.deleteAsset(d.id);
      this.editDraft = null;
      await this.store.changed('Ticket eliminado');
    } catch (error) {
      this.store.error(error, 'No se pudo eliminar.');
    } finally {
      this.saving.set(false);
    }
  }

  // ---- Collect ----

  protected openCollect(t: RealEstateTicket): void {
    const date = t.endDate && t.endDate <= this.today ? t.endDate : this.today;
    this.collectDraft = {
      ticket: t,
      date,
      amountEur: Math.round((t.investedEur + (t.accruedEur ?? 0)) * 100) / 100,
      useCash: this.hasCash(t.bankName)
    };
  }

  protected async saveCollect(): Promise<void> {
    const d = this.collectDraft;
    if (!d) return;
    this.saving.set(true);
    try {
      await this.api.collectTicket(d.ticket.assetId, { date: d.date, amountEur: d.amountEur, useCash: d.useCash && this.hasCash(d.ticket.bankName) });
      this.collectDraft = null;
      await this.store.changed('Ticket cobrado');
    } catch (error) {
      this.store.error(error, 'No se pudo registrar el cobro.');
    } finally {
      this.saving.set(false);
    }
  }
}

function rank(t: RealEstateTicket): number {
  return t.status === 'matured' ? 0 : t.status === 'incomplete' ? 2 : 1;
}
