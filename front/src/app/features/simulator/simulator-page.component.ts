import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatMoney0, formatSignedPercent } from '../../shared/format.utils';
import { PortfolioStats, portfolioStats, requiredReturn, simulate } from '../goals/goals.engine';
import { SimChartComponent, SimLine } from './sim-chart.component';

const KEY = 'finanzas.simulator';
type Manual = { initial: number; monthly: number; years: number; rate: number };
const DEFAULTS: Manual = { initial: 10000, monthly: 300, years: 15, rate: 6 };

type LogLine = { text: string; done: boolean };

/**
 * "Simulador", two parts with the same goal (how much will my money grow?):
 *  1. Manual: the user types years, expected return and amounts; plain compound interest, one line.
 *  2. Cálculo inteligente: reads the real portfolio (value, recurring plans, return and risk, like Objetivos) with a
 *     visible step-by-step analysis and shows three scenarios (10 %, 50 % and 90 % of 2.000 simulated futures).
 */
@Component({
  selector: 'app-simulator-page',
  standalone: true,
  imports: [FormsModule, SimChartComponent],
  templateUrl: './simulator-page.component.html',
  styleUrl: './simulator-page.component.css'
})
export class SimulatorPageComponent implements OnDestroy {
  private readonly api = inject(PortfolioApi);
  private readonly store = inject(PortfolioStore);
  protected readonly money = formatMoney0;
  protected readonly pct = formatSignedPercent;

  // ---------------------------------------------------------------- 1. manual
  protected readonly m = signal<Manual>(readManual());
  protected readonly LIMITS = { initial: 500_000, monthly: 5_000, years: 50, rateMin: -5, rateMax: 15 };

  protected set(field: keyof Manual, raw: unknown): void {
    let v = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(v)) return;
    if (field === 'years') v = Math.round(Math.min(this.LIMITS.years, Math.max(1, v)));
    if (field === 'initial' || field === 'monthly') v = Math.max(0, v);
    if (field === 'rate') v = Math.min(30, Math.max(-20, v));
    this.m.update((x) => ({ ...x, [field]: v }));
    try {
      localStorage.setItem(KEY, JSON.stringify(this.m()));
    } catch {
      /* not remembered */
    }
  }

  /** Compound interest month by month: the contribution goes in at the start of each month, then it grows. */
  protected readonly manual = computed(() => {
    const { initial, monthly, years, rate } = this.m();
    const g = Math.pow(1 + rate / 100, 1 / 12);
    const values = [initial];
    const paid = [initial];
    let v = initial;
    for (let month = 1; month <= years * 12; month++) {
      v = (v + monthly) * g;
      if (month % 12 === 0) {
        values.push(v);
        paid.push(initial + monthly * month);
      }
    }
    const final = values.at(-1)!;
    const put = paid.at(-1)!;
    return { values, paid, final, put, gain: final - put, lines: [{ label: 'Tu inversión', color: '#6366f1', values }] as SimLine[] };
  });

  // ---------------------------------------------------------------- 2. cálculo inteligente
  protected readonly phase = signal<'idle' | 'running' | 'done'>('idle');
  protected readonly log = signal<LogLine[]>([]);
  protected readonly smartYears = signal(15);
  protected readonly HORIZONS = [5, 10, 15, 20, 30];
  private readonly stats = signal<PortfolioStats | null>(null);
  private readonly monthlyPlan = signal(0);
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  ngOnDestroy(): void {
    this.timers.forEach(clearTimeout);
  }

  protected readonly smart = computed(() => {
    const s = this.stats();
    if (!s || this.phase() !== 'done') return null;
    const years = this.smartYears();
    const monthly = this.monthlyPlan();
    const sim = simulate(s.value, monthly, years * 12, Number.POSITIVE_INFINITY, s.mu, s.vol);
    const yearly = (arr: number[]) => arr.filter((_, i) => i % 12 === 0);
    const paid = Array.from({ length: years + 1 }, (_, i) => s.value + monthly * 12 * i);
    const scenario = (label: string, color: string, values: number[], note: string) => ({
      label, color, values, note, final: values.at(-1)!,
      yearly: requiredReturn(s.value, monthly, years * 12, values.at(-1)!),
    });
    const scenarios = [
      scenario('Pesimista', '#1d4ed8', yearly(sim.bands.p10), '1 de cada 10 futuros acaba peor que esto'),
      scenario('Intermedio', '#db2777', yearly(sim.bands.p50), 'la mitad de los futuros acaba por encima'),
      scenario('Optimista', '#22b8cf', yearly(sim.bands.p90), '1 de cada 10 futuros acaba mejor que esto'),
    ];
    return { scenarios, paid, put: paid.at(-1)!, monthly, mu: s.mu, vol: s.vol, value: s.value, lines: scenarios as SimLine[] };
  });

  /** Reads the portfolio and shows the analysis step by step (the numbers in each step are the real ones). */
  protected async runSmart(): Promise<void> {
    if (this.phase() === 'running') return;
    this.timers.forEach(clearTimeout);
    this.phase.set('running');
    this.log.set([{ text: 'Leyendo tu cartera…', done: false }]);
    try {
      const overview = this.store.overview() ?? (await this.store.refresh(), this.store.overview());
      const [goals, recurring] = await Promise.all([this.api.goals(), this.api.recurring()]);
      if (!overview) throw new Error('Sin datos de la cartera.');
      const s = portfolioStats(overview, goals.risk);
      const plans = recurring.items.filter((p) => p.active).reduce((t, p) => t + p.amountEur, 0);
      const monthly = plans > 0 ? plans : Math.max(0, Math.round(s.actualMonthly));
      const assets = overview.assets.filter((a) => a.valueEur > 0);
      const banks = new Set(assets.map((a) => a.bankName)).size;
      const top = [...s.byType].sort((a, b) => b.weight - a.weight).slice(0, 3).map((t) => `${t.name} ${Math.round(t.weight * 100)} %`).join(', ');
      const steps = [
        `Leyendo tu cartera: ${assets.length} activos en ${banks} bancos, ${formatMoney0(s.value)} en total.`,
        `Reparto principal: ${top}.`,
        `Rentabilidad de tu historia: ${formatSignedPercent(s.histMu, 1)}/año en ${s.histYears.toLocaleString('es-ES', { maximumFractionDigits: 1 })} años.`,
        `Riesgo: volatilidad ${(s.vol * 100).toFixed(1).replace('.', ',')} %/año; peor caída desde un máximo ${formatSignedPercent(s.maxDrawdown, 1)}.`,
        `Mezclando con referencias a largo plazo de cada tipo de activo: se espera ${formatSignedPercent(s.mu, 1)}/año.`,
        plans > 0 ? `Tus aportaciones periódicas: ${formatMoney0(plans)} al mes.` : `Sin planes periódicos: uso lo que metiste de media el último año (${formatMoney0(monthly)} al mes).`,
        'Simulando 2.000 futuros posibles, mes a mes…',
        'Ordenando los resultados: pesimista, intermedio y optimista.',
      ];
      this.log.set([]);
      steps.forEach((text, i) => {
        this.timers.push(setTimeout(() => {
          this.log.update((l) => [...l.map((x) => ({ ...x, done: true })), { text, done: false }]);
        }, 300 + i * 650));
      });
      this.timers.push(setTimeout(() => {
        this.log.update((l) => l.map((x) => ({ ...x, done: true })));
        this.stats.set(s);
        this.monthlyPlan.set(monthly);
        this.phase.set('done');
      }, 300 + steps.length * 650 + 400));
    } catch (error) {
      this.phase.set('idle');
      this.store.error(error, 'No se pudo leer tu cartera.');
    }
  }

  /** Copies the portfolio figures (value, monthly, expected return) into the manual simulation. */
  protected useInManual(): void {
    const s = this.smart();
    if (!s) return;
    this.set('initial', Math.round(s.value));
    this.set('monthly', Math.round(s.monthly));
    this.set('rate', Math.round(s.mu * 1000) / 10);
    this.set('years', this.smartYears());
    document.querySelector('[data-tour="sim-manual"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected readonly year = new Date().getFullYear();

  /** Monthly equivalent of the yearly rate, for the explanation under the chart. */
  protected monthlyRate(): string {
    return ((Math.pow(1 + this.m().rate / 100, 1 / 12) - 1) * 100).toFixed(3).replace('.', ',');
  }
}

function readManual(): Manual {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}
