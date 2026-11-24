import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { errorMessage, PortfolioApi } from '../../core/portfolio-api.service';
import { Goal, GoalsData, RecurringPlan, TYPE_COLORS } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatMoney0, formatSignedPercent, signClass, todayIso } from '../../shared/format.utils';
import { monthsUntil, neededToday, portfolioStats, requiredMonthly, requiredReturn, simulate, Simulation } from './goals.engine';

type Verdict = { label: string; tone: 'up' | 'warn' | 'down' };

type GoalView = {
  goal: Goal;
  months: number;
  monthly: number;
  monthlySource: 'whatif' | 'goal' | 'plans';
  progress: number;
  /** Share of the goal's time already gone. */
  elapsed: number;
  needed: number;
  sim: Simulation;
  req50: number;
  req80: number;
  reqReturn: number | null;
  verdict: Verdict;
  pace: Verdict & { text: string };
  reachText: string | null;
  chart: Chart;
};

type Chart = { outer: string; inner: string; median: string; paid: string; targetY: number; ticks: Array<{ x: number; label: string }> };

const W = 640;
const H = 200;
const monthFmt = new Intl.DateTimeFormat('es-ES', { month: 'short', year: 'numeric' });

type Draft = { name: string; targetEur: string; targetDate: string; monthlyEur: string };

@Component({
  selector: 'app-goals-page',
  standalone: true,
  templateUrl: './goals-page.component.html',
  styleUrl: './goals-page.component.css'
})
export class GoalsPageComponent {
  private readonly api = inject(PortfolioApi);
  protected readonly store = inject(PortfolioStore);
  protected readonly fmt = { formatMoney0, formatSignedPercent, signClass };
  protected readonly typeColors = TYPE_COLORS;
  protected readonly W = W;
  protected readonly H = H;

  protected readonly data = signal<GoalsData | null>(null);
  protected readonly plans = signal<RecurringPlan[]>([]);
  /** Monthly contribution being tried on the slider, per goal (not saved). */
  protected readonly whatIf = signal<Record<string, number>>({});
  /** null = closed, '' = new goal, id = editing that goal. */
  protected readonly editing = signal<string | null>(null);
  protected readonly draft = signal<Draft>(emptyDraft());
  protected readonly saving = signal(false);
  /** Goal waiting for the second click on "Borrar". */
  protected readonly confirmDelete = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected readonly stats = computed(() => {
    const overview = this.store.overview();
    const data = this.data();
    return overview && data ? portfolioStats(overview, data.risk) : null;
  });

  /** Sum of the active recurring plans (the saveback counts at its maximum). */
  protected readonly planned = computed(() => this.plans().filter((p) => p.active).reduce((s, p) => s + p.amountEur, 0));

  // The needed contributions only depend on the goal and the portfolio, not on the slider: cached apart.
  private readonly requirements = computed(() => {
    const s = this.stats();
    const today = todayIso();
    const out = new Map<string, { req50: number; req80: number }>();
    if (!s) return out;
    for (const g of this.data()?.goals ?? []) {
      const months = monthsUntil(today, g.targetDate);
      out.set(g.id, {
        req50: requiredMonthly(s.value, months, g.targetEur, s.mu, s.vol, 0.5),
        req80: requiredMonthly(s.value, months, g.targetEur, s.mu, s.vol, 0.8)
      });
    }
    return out;
  });

  protected readonly views = computed<GoalView[]>(() => {
    const s = this.stats();
    if (!s) return [];
    const today = todayIso();
    const whatIf = this.whatIf();
    return (this.data()?.goals ?? []).map((goal) => {
      const months = monthsUntil(today, goal.targetDate);
      const tried = whatIf[goal.id];
      const monthly = tried ?? goal.monthlyEur ?? this.planned();
      const sim = simulate(s.value, monthly, months, goal.targetEur, s.mu, s.vol);
      const { req50, req80 } = this.requirements().get(goal.id) ?? { req50: 0, req80: 0 };
      const span = Date.parse(goal.targetDate) - Date.parse(goal.startDate);
      return {
        goal,
        months,
        monthly,
        monthlySource: tried !== undefined ? 'whatif' : goal.monthlyEur !== null ? 'goal' : 'plans',
        progress: s.value / goal.targetEur,
        elapsed: span > 0 ? Math.min(1, Math.max(0, (Date.parse(today) - Date.parse(goal.startDate)) / span)) : 0,
        needed: neededToday(monthly, months, goal.targetEur, s.mu),
        sim,
        req50,
        req80,
        reqReturn: requiredReturn(s.value, monthly, months, goal.targetEur),
        verdict: verdictOf(sim.probability),
        pace: paceOf(monthly, req50, req80),
        reachText: sim.medianReachMonth === null ? null : reachDate(sim.medianReachMonth),
        chart: chartOf(sim, s.value, monthly, months, goal.targetEur)
      } satisfies GoalView;
    });
  });

  protected async load(): Promise<void> {
    try {
      const [data, recurring] = await Promise.all([this.api.goals(), this.api.recurring()]);
      this.data.set(data);
      this.plans.set(recurring.items);
    } catch (error) {
      this.store.error(error, 'No se pudieron cargar los objetivos.');
    }
  }

  protected openNew(): void {
    this.draft.set(emptyDraft());
    this.editing.set('');
  }

  protected openEdit(goal: Goal): void {
    this.draft.set({
      name: goal.name,
      targetEur: String(goal.targetEur),
      targetDate: goal.targetDate,
      monthlyEur: goal.monthlyEur === null ? '' : String(goal.monthlyEur)
    });
    this.editing.set(goal.id);
    // The form sits at the top of the page: bring it into view.
    setTimeout(() => document.querySelector('.goal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  protected setDraft(field: keyof Draft, value: string): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const d = this.draft();
    const body = {
      name: d.name.trim(),
      targetEur: parseAmount(d.targetEur),
      targetDate: d.targetDate,
      monthlyEur: d.monthlyEur.trim() === '' ? null : parseAmount(d.monthlyEur)
    };
    const id = this.editing();
    this.saving.set(true);
    try {
      if (id) await this.api.updateGoal(id, body);
      else await this.api.createGoal(body);
      this.editing.set(null);
      if (id) this.dropWhatIf(id);
      await this.load();
    } catch (error) {
      this.store.toast('error', errorMessage(error, 'No se pudo guardar el objetivo.'));
      // The goal may have been deleted elsewhere: show the list as it is now.
      if (error instanceof HttpErrorResponse && error.status === 404) {
        this.editing.set(null);
        await this.load();
      }
    } finally {
      this.saving.set(false);
    }
  }

  // Two clicks instead of confirm(): some embedded browsers block dialogs.
  protected async remove(goal: Goal): Promise<void> {
    if (this.confirmDelete() !== goal.id) {
      this.confirmDelete.set(goal.id);
      return;
    }
    this.confirmDelete.set(null);
    try {
      await this.api.deleteGoal(goal.id);
    } catch (error) {
      this.store.error(error, 'No se pudo borrar el objetivo.');
    }
    await this.load();
  }

  protected tryMonthly(id: string, value: string): void {
    const n = Math.min(this.SLIDER_MAX, Math.max(0, Math.round(Number(value) || 0)));
    this.whatIf.update((w) => ({ ...w, [id]: n }));
  }

  protected dropWhatIf(id: string): void {
    this.whatIf.update((w) => {
      const { [id]: _, ...rest } = w;
      return rest;
    });
  }

  /** Keeps the contribution tried on the slider as the goal's own. */
  protected async keepWhatIf(view: GoalView): Promise<void> {
    try {
      await this.api.updateGoal(view.goal.id, { monthlyEur: view.monthly });
      this.dropWhatIf(view.goal.id);
      await this.load();
    } catch (error) {
      this.store.error(error, 'No se pudo guardar la aportación.');
    }
  }

  /** The monthly contribution slider goes from 0 to this (fixed: it used to grow with the value, without end). */
  protected readonly SLIDER_MAX = 5000;

  /** Where the user's contribution plans sit on the slider, in % of its width. */
  protected planPct(): number {
    return Math.min(100, (this.planned() / this.SLIDER_MAX) * 100);
  }

  protected yearsText(months: number): string {
    if (months < 12) return `${months} ${months === 1 ? 'mes' : 'meses'}`;
    const years = months / 12;
    return `${years.toLocaleString('es-ES', { maximumFractionDigits: 1 })} años`;
  }

  protected pct(value: number, decimals = 0): string {
    return `${(value * 100).toLocaleString('es-ES', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })} %`;
  }

  protected clamp01(value: number): number {
    return Math.min(1, Math.max(0, value));
  }
}

function emptyDraft(): Draft {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  return { name: '', targetEur: '', targetDate: d.toISOString().slice(0, 10), monthlyEur: '' };
}

function parseAmount(raw: string): number {
  const compact = raw.replace(/\s|€/g, '');
  return Number(compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact);
}

function verdictOf(p: number): Verdict {
  if (p >= 0.8) return { label: 'Muy viable', tone: 'up' };
  if (p >= 0.6) return { label: 'Viable', tone: 'up' };
  if (p >= 0.4) return { label: 'Ajustado', tone: 'warn' };
  if (p >= 0.2) return { label: 'Difícil', tone: 'down' };
  return { label: 'Poco probable', tone: 'down' };
}

function paceOf(monthly: number, req50: number, req80: number): Verdict & { text: string } {
  const eur = (v: number) => formatMoney0(v);
  if (monthly >= req80) {
    return { label: 'Buen ritmo', tone: 'up', text: req80 === 0 ? 'Con lo que ya tienes basta, aunque no aportes más.' : `Aportas ${eur(monthly)}/mes y con ${eur(req80)}/mes ya tendrías un 80 % de posibilidades.` };
  }
  if (monthly >= req50) return { label: 'Ritmo justo', tone: 'warn', text: `Para un 80 % de posibilidades necesitarías ${eur(req80)}/mes (${eur(req80 - monthly)} más).` };
  return { label: 'Ritmo insuficiente', tone: 'down', text: `Para tener al menos un 50 % necesitas ${eur(req50)}/mes (${eur(req50 - monthly)} más).` };
}

function reachDate(months: number): string {
  if (months === 0) return 'ya';
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  return monthFmt.format(d);
}

function chartOf(sim: Simulation, start: number, monthly: number, months: number, target: number): Chart {
  const b = sim.bands;
  const top = Math.max(target * 1.15, b.p75[months] * 1.08, start * 1.1);
  // The bottom follows the worst band, so the lines aren't squashed against the top.
  const bottom = Math.min(start, ...b.p10) * 0.9;
  const x = (m: number) => (m / months) * W;
  const y = (v: number) => H - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * H;
  const line = (vals: number[]) => vals.map((v, m) => `${m ? 'L' : 'M'}${x(m).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const band = (lo: number[], hi: number[]) =>
    `${line(hi)}${lo.map((_, i) => lo.length - 1 - i).map((m) => `L${x(m).toFixed(1)},${y(lo[m]).toFixed(1)}`).join('')}Z`;
  const paid = Array.from({ length: months + 1 }, (_, m) => start + monthly * m);
  // Year marks: every year for short goals, fewer for long ones.
  const every = months <= 36 ? 12 : months <= 120 ? 24 : 60;
  const now = new Date();
  const ticks: Chart['ticks'] = [];
  for (let m = every - now.getMonth(); m < months; m += every) {
    if (m > 2 && months - m > 2) ticks.push({ x: x(m), label: String(now.getFullYear() + Math.round((m + now.getMonth()) / 12)) });
  }
  return { outer: band(b.p10, b.p90), inner: band(b.p25, b.p75), median: line(b.p50), paid: line(paid), targetY: y(target), ticks };
}
