import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { PortfolioStore } from '../../core/portfolio.store';
import { BankingBank, BankingStatus, BankTx, SpendCategory } from '../../core/portfolio.models';
import { ConfirmService } from '../../shared/confirm-dialog.component';
import { DonutChartComponent, DonutSegment } from '../../shared/donut-chart.component';
import { formatDay, formatMoney, formatMoney0, formatSignedMoney, signClass } from '../../shared/format.utils';

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
/** Banks offered first in "Conectar banco" (the others are found with the search box). */
// Trade Republic shows up twice: ES (Spanish IBAN, customers in Spain) and DE (German IBAN, older accounts).
const SUGGESTED: Array<{ name: string; country: string }> = [
  { name: 'BBVA', country: 'ES' }, { name: 'Trade Republic', country: 'ES' }, { name: 'Trade Republic', country: 'DE' },
];

/**
 * "Gastos": current accounts read with Open Banking (read only) and every movement sorted into a category, to see
 * income, spending, saving and where the money goes. Data and rules: back/src/banking.ts.
 */
@Component({
  selector: 'app-spending-page',
  standalone: true,
  imports: [FormsModule, DonutChartComponent],
  templateUrl: './spending-page.component.html',
  styleUrl: './spending-page.component.css'
})
export class SpendingPageComponent {
  private readonly api = inject(PortfolioApi);
  private readonly store = inject(PortfolioStore);
  private readonly confirm = inject(ConfirmService);
  protected readonly money = formatMoney;
  protected readonly money0 = formatMoney0;
  protected readonly signed = formatSignedMoney;
  protected readonly day = formatDay;
  protected readonly sign = signClass;
  protected readonly MONTHS = MONTHS;
  protected readonly SUGGESTED = SUGGESTED;

  protected readonly status = signal<BankingStatus | null>(null);
  protected readonly txs = signal<BankTx[]>([]);
  protected readonly loading = signal(true);
  protected readonly syncing = signal(false);
  protected readonly year = new Date().getFullYear();
  /** Month shown (0–11), or null = the whole year. */
  protected readonly month = signal<number | null>(new Date().getMonth());
  protected readonly filterCat = signal<string>('');
  protected readonly search = signal('');
  protected readonly showInternal = signal(false);

  // Connect dialog
  protected readonly connectOpen = signal(false);
  protected readonly banks = signal<BankingBank[]>([]);
  protected readonly bankQuery = signal('');
  protected readonly connecting = signal<string | null>(null);

  /** After a manual change: offer to remember it for every movement with that text. */
  protected readonly learn = signal<{ id: string; category: string; pattern: string } | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [s, t] = await Promise.all([this.api.bankingStatus(), this.api.bankingTransactions(`${this.year}-01-01`)]);
      this.status.set(s);
      this.txs.set(t.transactions);
    } catch (e) {
      this.store.error(e, 'No se pudieron cargar los gastos.');
    } finally {
      this.loading.set(false);
    }
  }

  // ---------------------------------------------------------------- categories and figures

  protected readonly categories = computed<SpendCategory[]>(() => this.status()?.categories ?? []);
  private readonly catMap = computed(() => new Map(this.categories().map((c) => [c.code, c])));
  protected cat(code: string | null): SpendCategory | undefined {
    return code ? this.catMap().get(code) : undefined;
  }

  /** Cash in every linked account, in euros (other currencies are left out of the sum). */
  protected readonly cash = computed(() => {
    const accounts = (this.status()?.links ?? []).flatMap((l) => l.accounts).filter((a) => !a.hidden);
    return { total: accounts.filter((a) => a.currency === 'EUR').reduce((s, a) => s + (a.balance ?? 0), 0), accounts: accounts.length };
  });

  private inMonth(t: BankTx, m: number | null): boolean {
    return m === null || Number(t.date.slice(5, 7)) - 1 === m;
  }

  /** Income, spending and saving of a month (or the year). Moves between own accounts and investing do not count. */
  private totals(list: BankTx[]) {
    let income = 0, spent = 0;
    for (const t of list) {
      if (t.internal) continue;
      if (t.amount > 0) income += t.amount;
      else spent -= t.amount;
    }
    return { income, spent, saved: income - spent, rate: income > 0 ? (income - spent) / income : null };
  }

  protected readonly periodTx = computed(() => this.txs().filter((t) => this.inMonth(t, this.month())));
  protected readonly kpis = computed(() => this.totals(this.periodTx()));

  /** Income and spending of each month of the year, for the bars. */
  protected readonly byMonth = computed(() => {
    const now = new Date().getMonth();
    const rows = MONTHS.slice(0, now + 1).map((name, m) => ({ m, name: name.slice(0, 3), ...this.totals(this.txs().filter((t) => this.inMonth(t, m))) }));
    const max = Math.max(1, ...rows.flatMap((r) => [r.income, r.spent]));
    return rows.map((r) => ({ ...r, hIn: (r.income / max) * 100, hOut: (r.spent / max) * 100 }));
  });

  /** Spending by category in the period, with the monthly average of the year to compare. */
  protected readonly byCategory = computed(() => {
    const sums = new Map<string, number>();
    for (const t of this.periodTx()) {
      if (t.internal || t.amount >= 0) continue;
      const code = t.category ?? 'otros_gastos';
      sums.set(code, (sums.get(code) ?? 0) - t.amount);
    }
    const monthsSoFar = new Date().getMonth() + 1;
    const yearSums = new Map<string, number>();
    for (const t of this.txs()) {
      if (t.internal || t.amount >= 0) continue;
      const code = t.category ?? 'otros_gastos';
      yearSums.set(code, (yearSums.get(code) ?? 0) - t.amount);
    }
    const total = [...sums.values()].reduce((s, v) => s + v, 0);
    return [...sums.entries()].map(([code, value]) => {
      const c = this.cat(code);
      const avg = (yearSums.get(code) ?? 0) / monthsSoFar;
      return { code, name: c?.name ?? code, color: c?.color ?? '#94a3b8', value, share: total ? value / total : 0, avg, vsAvg: this.month() !== null && avg > 0 ? value / avg - 1 : null };
    }).sort((a, b) => b.value - a.value);
  });

  protected readonly donut = computed<DonutSegment[]>(() =>
    this.byCategory().map((c) => ({
      key: c.code, label: c.name, value: c.value, color: c.color,
      extra: c.vsAvg === null || Math.abs(c.vsAvg) < 0.005 ? '' : `${c.vsAvg > 0 ? '+' : '−'}${Math.abs(Math.round(c.vsAvg * 100))} %`,
      extraClass: c.vsAvg === null ? '' : c.vsAvg > 0.15 ? 'down' : c.vsAvg < -0.15 ? 'up' : '',
    })));

  /** Movements of the period with the filters of the table. */
  protected readonly rows = computed(() => {
    const q = this.search().trim().toLowerCase();
    const cat = this.filterCat();
    return this.periodTx().filter((t) =>
      (this.showInternal() || !t.internal) &&
      (!cat || (t.category ?? '') === cat) &&
      (!q || `${t.description} ${t.counterparty ?? ''} ${t.account}`.toLowerCase().includes(q)));
  });

  /** Payments that come back every month with a similar amount (subscriptions, bills). */
  protected readonly recurring = computed(() => {
    const groups = new Map<string, BankTx[]>();
    for (const t of this.txs()) {
      if (t.internal || t.amount >= 0) continue;
      const k = (t.counterparty || t.description).toUpperCase().replace(/[0-9*#/.,-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (k.length < 3) continue;
      groups.set(k, [...(groups.get(k) ?? []), t]);
    }
    const out: Array<{ name: string; amount: number; months: number; last: string; category?: SpendCategory }> = [];
    for (const [name, list] of groups) {
      const months = new Set(list.map((t) => t.date.slice(0, 7)));
      if (months.size < 3) continue;
      // A bill: about once a month and nearly the same amount (a shop you go to often is neither).
      if (list.length > months.size * 1.3) continue;
      const amounts = list.map((t) => -t.amount).sort((a, b) => a - b);
      const median = amounts[Math.floor(amounts.length / 2)];
      const close = amounts.filter((a) => Math.abs(a - median) <= Math.max(2, median * 0.2)).length;
      if (close / amounts.length < 0.8) continue;
      out.push({ name, amount: median, months: months.size, last: list[0].date, category: this.cat(list[0].category) });
    }
    return out.sort((a, b) => b.amount - a.amount).slice(0, 12);
  });

  // ---------------------------------------------------------------- actions

  protected async sync(): Promise<void> {
    this.syncing.set(true);
    try {
      const r = await this.api.bankingSync();
      if (r.errors.length) this.store.toast('error', r.errors.join(' · '));
      else this.store.toast('ok', r.added ? `${r.added} movimientos nuevos.` : 'Todo al día.');
      await this.load();
    } catch (e) {
      this.store.error(e, 'No se pudo actualizar.');
    } finally {
      this.syncing.set(false);
    }
  }

  protected async openConnect(): Promise<void> {
    this.connectOpen.set(true);
    if (this.banks().length) return;
    try {
      const [es, de] = await Promise.all([this.api.bankingBanks('ES'), this.api.bankingBanks('DE')]);
      this.banks.set([...es.banks, ...de.banks]);
    } catch (e) {
      this.store.error(e, 'No se pudo leer la lista de bancos.');
    }
  }

  protected readonly bankList = computed(() => {
    const q = this.bankQuery().trim().toLowerCase();
    const list = this.banks();
    if (!q) return list.filter((b) => SUGGESTED.some((s) => s.name.toLowerCase() === b.name.toLowerCase() && s.country === b.country));
    return list.filter((b) => b.name.toLowerCase().includes(q)).slice(0, 30);
  });

  protected async connect(b: { name: string; country: string }): Promise<void> {
    this.connecting.set(`${b.name}|${b.country}`);
    try {
      const r = await this.api.bankingConnect(b.name, b.country);
      window.location.href = r.url; // the bank's own consent screen; it comes back to /api/banking/callback
    } catch (e) {
      this.store.error(e, 'No se pudo empezar la conexión.');
      this.connecting.set(null);
    }
  }

  protected async revoke(linkId: string, name: string): Promise<void> {
    const ok = await this.confirm.ask(`¿Desconectar ${name}? La app deja de poder leer esa cuenta (los movimientos ya leídos se quedan).`, { ok: 'Desconectar', danger: true });
    if (!ok) return;
    try {
      await this.api.bankingRevoke(linkId);
      this.store.toast('ok', `${name} desconectado.`);
      await this.load();
    } catch (e) {
      this.store.error(e);
    }
  }

  protected async setCategory(t: BankTx, code: string): Promise<void> {
    const before = t.category;
    this.txs.update((list) => list.map((x) => (x.id === t.id ? { ...x, category: code, categorySource: 'user', internal: this.cat(code)?.kind === 'internal' } : x)));
    try {
      await this.api.bankingSetCategory(t.id, code);
      const pattern = (t.counterparty || t.description).replace(/[0-9*#/]+.*$/, '').trim().slice(0, 30);
      if (pattern.length >= 3) this.learn.set({ id: t.id, category: code, pattern });
    } catch (e) {
      this.txs.update((list) => list.map((x) => (x.id === t.id ? { ...x, category: before } : x)));
      this.store.error(e);
    }
  }

  protected async remember(): Promise<void> {
    const l = this.learn();
    if (!l) return;
    try {
      const r = await this.api.bankingSetCategory(l.id, l.category, l.pattern);
      this.learn.set(null);
      this.store.toast('ok', `Regla guardada: «${l.pattern}» → ${this.cat(l.category)?.name}. ${r.applied ? 'Reclasificados los demás.' : ''}`);
      const t = await this.api.bankingTransactions(`${this.year}-01-01`);
      this.txs.set(t.transactions);
    } catch (e) {
      this.store.error(e);
    }
  }

  protected setLearnPattern(v: string): void {
    this.learn.update((l) => (l ? { ...l, pattern: v } : l));
  }

  protected daysLeft(validUntil: string): number {
    return Math.floor((Date.parse(validUntil) - Date.now()) / 86_400_000);
  }

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text);
    this.store.toast('ok', 'Copiado.');
  }
}
