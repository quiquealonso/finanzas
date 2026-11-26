import { ConfirmService } from '../../shared/confirm-dialog.component';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { Movement, RecurringData, RecurringPending, RecurringPlan, TYPE_COLORS } from '../../core/portfolio.models';
import { ListView, ViewToggleComponent } from '../../shared/view-toggle.component';
import { MailImportDialogComponent } from './mail-import-dialog.component';
import { PendingOrdersComponent } from './pending-orders.component';
import { BankInvestmentsComponent } from './bank-investments.component';
import { PortfolioStore } from '../../core/portfolio.store';
import {
  formatDay,
  formatMoney,
  formatMonth,
  formatPrice,
  formatQty,
  formatSignedMoney,
  signClass,
  todayIso
} from '../../shared/format.utils';

type MovementGroup = {
  groupId: string;
  date: string;
  kind: string;
  label: string;
  main: Movement;
  legs: Movement[];
  amountEur: number;
  realizedPnlEur: number | null;
};

const KIND_LABELS: Record<string, string> = {
  buy: 'Compra',
  sell: 'Venta',
  deposit: 'Ingreso',
  withdraw: 'Retirada',
  transfer_out: 'Traspaso',
  transfer_in: 'Traspaso',
  adjust: 'Ajuste',
  opening: 'Saldo inicial',
  recurring: 'Aportación'
};

const PLANS_OPEN_KEY = 'movements.plans.open';
function readPlansOpen(): boolean {
  try {
    return localStorage.getItem(PLANS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-movements-page',
  standalone: true,
  imports: [FormsModule, ViewToggleComponent, MailImportDialogComponent, PendingOrdersComponent, BankInvestmentsComponent],
  templateUrl: './movements-page.component.html',
  styleUrl: './movements-page.component.css'
})
export class MovementsPageComponent {
  private readonly confirmDialog = inject(ConfirmService);
  protected readonly store = inject(PortfolioStore);
  private readonly api = inject(PortfolioApi);

  protected readonly movements = signal<Movement[]>([]);
  protected readonly recurring = signal<RecurringData>({ items: [], pending: [] });
  protected readonly loading = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly search = signal('');
  protected readonly kindFilter = signal('');
  protected readonly layout = signal<ListView>('cards');
  protected readonly importing = signal(false);
  protected readonly typeColors: Record<string, string> = TYPE_COLORS;

  // Pending amounts can be tweaked before registering (key = recurringId|period).
  protected pendingAmount: Record<string, number> = {};
  // Units confirmed by the bank (optional; without them the estimate at that day's price is used).
  protected pendingQty: Record<string, number | null> = {};

  protected showPlanForm = false;
  protected editingPlanId: string | null = null;
  protected planDraft = this.emptyPlan();

  protected readonly fmt = { formatDay, formatMoney, formatMonth, formatPrice, formatQty, formatSignedMoney, signClass };
  protected readonly kindLabels = KIND_LABELS;

  protected readonly investable = computed(() =>
    this.store.assets().filter((a) => !a.isLiquidity).sort((a, b) => a.bankName.localeCompare(b.bankName) || a.name.localeCompare(b.name))
  );

  constructor() {
    effect(() => {
      this.store.version();
      void this.load();
    });
  }

  protected readonly groups = computed<MovementGroup[]>(() => {
    const byGroup = new Map<string, Movement[]>();
    for (const m of this.movements()) byGroup.set(m.groupId, [...(byGroup.get(m.groupId) ?? []), m]);
    const q = this.search().trim().toLowerCase();
    const kf = this.kindFilter();
    return [...byGroup.entries()]
      .map(([groupId, legs]) => {
        // The "main" leg is the non-cash one (the cash leg is just the payment).
        const main = legs.find((l) => l.kind === 'transfer_out') ?? legs.find((l) => !l.isLiquidity) ?? legs[0];
        const kind = main.kind.startsWith('transfer') ? 'transfer' : main.kind;
        const sell = legs.find((l) => l.type === 'SELL' && !l.isLiquidity);
        return {
          groupId,
          date: main.date,
          kind,
          label: KIND_LABELS[main.kind] ?? main.kind,
          main,
          legs,
          amountEur: main.amountEur,
          realizedPnlEur: sell?.realizedPnlEur ?? null
        };
      })
      .filter((g) => !kf || g.kind === kf || (kf === 'buy' && g.kind === 'recurring'))
      .filter((g) => !q || g.legs.some((l) => l.assetName.toLowerCase().includes(q) || l.bankName.toLowerCase().includes(q) || (l.note ?? '').toLowerCase().includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  /** History cards: the movements of each month, with what was invested and the result of the sales. */
  protected readonly byMonth = computed(() => {
    const months = new Map<string, MovementGroup[]>();
    for (const g of this.groups()) {
      const m = g.date.slice(0, 7);
      months.set(m, [...(months.get(m) ?? []), g]);
    }
    return [...months.entries()].map(([month, groups]) => ({
      month,
      groups,
      invested: groups.filter((g) => g.kind === 'buy' || g.kind === 'recurring').reduce((s, g) => s + g.amountEur, 0),
      realized: groups.reduce((s, g) => s + (g.realizedPnlEur ?? 0), 0)
    }));
  });

  /** Asset type of the main leg, for the colour dot. */
  protected typeOf(g: MovementGroup): string {
    return this.store.assets().find((a) => a.id === g.main.assetId)?.typeCode ?? (g.main.isLiquidity ? 'LIQUID' : '');
  }

  protected readonly monthTotals = computed(() => {
    const month = todayIso().slice(0, 7);
    let invested = 0;
    for (const g of this.groups()) {
      if (!g.date.startsWith(month)) continue;
      if (g.kind === 'buy' || g.kind === 'recurring') invested += g.amountEur;
    }
    return { month, invested };
  });

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [movements, recurring] = await Promise.all([this.api.movements(), this.api.recurring()]);
      this.movements.set(movements);
      this.setRecurring(recurring);
    } catch (error) {
      this.store.error(error, 'No se pudieron cargar los movimientos.');
    } finally {
      this.loading.set(false);
    }
  }

  private setRecurring(data: RecurringData): void {
    this.recurring.set(data);
    for (const p of data.pending) {
      const key = this.pendingKey(p);
      if (this.pendingAmount[key] === undefined) this.pendingAmount[key] = p.amountEur;
    }
  }

  protected pendingKey(p: RecurringPending): string {
    return `${p.recurringId}|${p.period}`;
  }

  protected newMovement(): void {
    this.store.openMovement();
  }

  protected describe(g: MovementGroup): string {
    const m = g.main;
    if (g.kind === 'deposit' || g.kind === 'withdraw') return m.note ?? '';
    if (g.kind === 'transfer') {
      const to = g.legs.find((l) => l.kind === 'transfer_in');
      return to ? `→ ${to.assetName} (${to.bankName}) · ${formatQty(to.quantity)}` : '';
    }
    if (m.isLiquidity) return m.note ?? '';
    return `${formatQty(m.quantity)} × ${formatPrice(m.price, m.currency)}${m.fee ? ` + ${formatPrice(m.fee, m.currency)} com.` : ''}`;
  }

  protected cashLeg(g: MovementGroup): Movement | undefined {
    return g.legs.find((l) => l.isLiquidity && l !== g.main);
  }

  protected async remove(g: MovementGroup): Promise<void> {
    const what = `${g.label} de ${g.main.assetName} del ${formatDay(g.date)}`;
    if (!(await this.confirmDialog.ask(`¿Borrar ${what}? Se recalcularán las posiciones.`))) return;
    this.busy.set(g.groupId);
    try {
      await this.api.deleteMovement(g.groupId);
      await this.store.changed('Movimiento borrado');
    } catch (error) {
      this.store.error(error, 'No se pudo borrar.');
    } finally {
      this.busy.set(null);
    }
  }

  // ---- Recurring contributions ----

  private emptyPlan() {
    return { assetId: '', amountEur: null as number | null, dayOfMonth: 1, startMonth: todayIso().slice(0, 7), fromCash: false };
  }

  protected openNewPlan(): void {
    this.editingPlanId = null;
    this.planDraft = this.emptyPlan();
    this.showPlanForm = true;
    if (!this.plansOpen()) this.togglePlans();
  }

  protected editPlan(plan: RecurringPlan): void {
    this.editingPlanId = plan.id;
    this.planDraft = {
      assetId: plan.assetId, amountEur: plan.amountEur, dayOfMonth: plan.dayOfMonth,
      startMonth: plan.startMonth, fromCash: plan.fromCash
    };
    this.showPlanForm = true;
  }

  protected hasCash(assetId: string): boolean {
    const asset = this.store.assets().find((a) => a.id === assetId);
    return !!asset && this.store.assets().some((a) => a.isLiquidity && a.bankId === asset.bankId);
  }

  protected async savePlan(): Promise<void> {
    const d = this.planDraft;
    if (!d.assetId || !d.amountEur || d.amountEur <= 0) {
      this.store.toast('error', 'Elige el activo y el importe.');
      return;
    }
    this.busy.set('plan');
    try {
      const body = { ...d, fromCash: d.fromCash && this.hasCash(d.assetId) };
      const data = this.editingPlanId
        ? await this.api.updateRecurring(this.editingPlanId, body)
        : await this.api.createRecurring(body);
      this.setRecurring(data);
      this.showPlanForm = false;
      this.store.toast('ok', this.editingPlanId ? 'Aportación actualizada' : 'Aportación creada');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar la aportación.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async togglePlan(plan: RecurringPlan): Promise<void> {
    try {
      this.setRecurring(await this.api.updateRecurring(plan.id, { active: !plan.active }));
    } catch (error) {
      this.store.error(error);
    }
  }

  /** Folded by default; the choice is remembered in this browser. */
  protected readonly plansOpen = signal(readPlansOpen());

  protected togglePlans(): void {
    this.plansOpen.set(!this.plansOpen());
    try {
      localStorage.setItem(PLANS_OPEN_KEY, this.plansOpen() ? '1' : '0');
    } catch {
      /* blocked storage: lasts this visit */
    }
  }

  /** One line for the folded header: how many plans and how much a month. */
  protected plansSummary(): string {
    const active = this.recurring().items.filter((p) => p.active);
    if (!this.recurring().items.length) return 'Ninguna todavía';
    const month = active.reduce((s, p) => s + p.amountEur, 0);
    return `${active.length} activas · ${formatMoney(month)} al mes`;
  }

  protected async deletePlan(plan: RecurringPlan): Promise<void> {
    if (!(await this.confirmDialog.ask(`¿Eliminar la aportación de ${formatMoney(Number(plan.amountEur))} a ${plan.assetName}? Las compras ya registradas se mantienen.`))) return;
    try {
      this.setRecurring(await this.api.deleteRecurring(plan.id));
      this.showPlanForm = false;
    } catch (error) {
      this.store.error(error);
    }
  }

  protected deleteEditingPlan(): void {
    const plan = this.recurring().items.find((i) => i.id === this.editingPlanId);
    if (plan) void this.deletePlan(plan);
  }

  protected async register(p: RecurringPending): Promise<void> {
    const key = this.pendingKey(p);
    this.busy.set(key);
    try {
      const data = await this.api.registerRecurring(p.recurringId, this.registerBody(p));
      this.setRecurring(data);
      // Free the buttons now: reloading the overview can take a while and must not block the next one.
      this.busy.set(null);
      void this.store.changed(`Aportación de ${formatMonth(p.period)} registrada`);
    } catch (error) {
      this.store.error(error, 'No se pudo registrar.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async skip(p: RecurringPending): Promise<void> {
    if (!(await this.confirmDialog.ask(`¿Omitir ${formatMonth(p.period)} de ${p.assetName}? No se apuntará nada ese mes.`))) return;
    this.busy.set(this.pendingKey(p));
    try {
      this.setRecurring(await this.api.skipRecurring(p.recurringId, p.period));
      this.store.toast('ok', `${formatMonth(p.period)} omitido`);
    } catch (error) {
      this.store.error(error, 'No se pudo omitir.');
    } finally {
      this.busy.set(null);
    }
  }

  protected async registerAll(): Promise<void> {
    const pending = [...this.recurring().pending];
    this.busy.set('all');
    let done = 0;
    try {
      for (const p of pending) {
        const data = await this.api.registerRecurring(p.recurringId, this.registerBody(p));
        this.setRecurring(data);
        done++;
      }
      await this.store.changed(`${done} aportaciones registradas`);
    } catch (error) {
      this.store.error(error, `Se registraron ${done} y falló la siguiente.`);
      await this.store.changed();
    } finally {
      this.busy.set(null);
    }
  }

  private registerBody(p: RecurringPending): Record<string, unknown> {
    const key = this.pendingKey(p);
    const qty = this.pendingQty[key];
    return { period: p.period, amountEur: this.pendingAmount[key] ?? p.amountEur, ...(qty && qty > 0 ? { quantity: qty } : {}) };
  }

  protected planLast(plan: RecurringPlan): string {
    const last = plan.history[0];
    return last ? `Última: ${formatMonth(last.period)} · ${formatQty(last.quantity)} a ${formatPrice(last.price)}` : 'Sin registros todavía';
  }
}
