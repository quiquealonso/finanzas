import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { PROFILES, QUESTIONS, RiskQuestion, RiskResult, scoreAnswers } from './risk-questions';
import { FundFinderDialogComponent } from './fund-finder-dialog.component';
import { fundLink, money, pct, plain, regionFlags, SavedFund, zoneFlags } from './fund-format';
import { ConfirmService } from '../../shared/confirm-dialog.component';
import { API_ORIGIN } from '../../core/api-origin';

const API = `${API_ORIGIN}/api/v2/risk-profile`;
const SAVED_API = `${API_ORIGIN}/api/v2/saved-funds`;
/** Types counted as "risky" (equity-like) when comparing with the real portfolio. */
const RISKY = new Set(['STOCK', 'ETF', 'FUND', 'CRYPTO']);

type Saved = RiskResult & { id: string; createdAt: string; answers: Record<string, string> };

/**
 * "Perfil de riesgo": a short, friendly questionnaire (one question at a time, keyboard 1-5, auto-advance) and the
 * resulting investor profile, compared with the user's real portfolio. Educational, not investment advice.
 */
@Component({
  selector: 'app-risk-profile-page',
  standalone: true,
  imports: [FundFinderDialogComponent],
  templateUrl: './risk-profile-page.component.html',
  styleUrl: './risk-profile-page.component.css',
  host: { '(document:keydown)': 'key($event)' }
})
export class RiskProfilePageComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PortfolioStore);
  private readonly confirm = inject(ConfirmService);
  protected readonly questions = QUESTIONS;
  protected readonly profiles = PROFILES;

  protected readonly mode = signal<'loading' | 'intro' | 'quiz' | 'result'>('loading');
  protected readonly index = signal(0);
  /** Direction of the last move, for the slide animation. */
  protected readonly dir = signal<'next' | 'back'>('next');
  protected readonly answers = signal<Record<string, string>>({});
  protected readonly picked = signal<string | null>(null);
  protected readonly flash = signal<string | null>(null);
  protected readonly result = signal<RiskResult | null>(null);
  protected readonly history = signal<Saved[]>([]);
  protected readonly shown = signal(0);
  /** The "Analizar mejores opciones" dialog is open. */
  protected readonly finding = signal(false);
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  /** Funds saved from "Analizar mejores opciones", all profiles. */
  protected readonly savedFunds = signal<SavedFund[]>([]);
  /** Profile tab of "Mis fondos" (null = the current profile). */
  protected readonly fundTab = signal<string | null>(null);
  protected readonly activeTab = computed(() => this.fundTab() ?? this.result()?.profile ?? 'equilibrado');
  /** Tabs: the current profile first, then any other profile with saved funds. */
  protected readonly fundTabs = computed(() => {
    const current = this.result()?.profile;
    return PROFILES.filter((p) => p.id === current || this.savedFunds().some((f) => f.profile === p.id))
      .map((p) => ({ ...p, count: this.savedFunds().filter((f) => f.profile === p.id).length, current: p.id === current }));
  });
  protected readonly tabFunds = computed(() => this.savedFunds().filter((f) => f.profile === this.activeTab()));
  protected readonly tabProfile = computed(() => PROFILES.find((p) => p.id === this.activeTab()) ?? PROFILES[2]);
  protected readonly pct = pct;
  protected readonly plain = plain;
  protected readonly money = money;
  protected readonly regionFlags = regionFlags;
  protected readonly zoneFlags = zoneFlags;
  protected readonly fundLink = fundLink;
  protected readonly riskSteps = [1, 2, 3, 4, 5, 6, 7];

  constructor() {
    void this.load();
    void this.loadFunds();
  }

  protected async loadFunds(): Promise<void> {
    try {
      this.savedFunds.set(await firstValueFrom(this.http.get<SavedFund[]>(SAVED_API)));
    } catch {
      /* the section just stays empty */
    }
  }

  protected async removeFund(f: SavedFund): Promise<void> {
    if (!(await this.confirm.ask(`¿Quitar «${f.data.name}» de tus fondos guardados?`, { title: 'Quitar fondo', ok: 'Quitar', danger: true }))) return;
    try {
      await firstValueFrom(this.http.delete(`${SAVED_API}/${f.id}`));
      this.savedFunds.update((l) => l.filter((x) => x.id !== f.id));
    } catch (error) {
      this.store.error(error, 'No se pudo quitar.');
    }
  }

  ngOnDestroy(): void {
    this.timers.forEach(clearTimeout);
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<{ latest: Saved | null; history: Saved[] }>(API));
      this.history.set(r.history);
      if (r.latest) {
        this.answers.set(r.latest.answers);
        this.showResult(r.latest);
      } else this.mode.set('intro');
    } catch {
      this.mode.set('intro');
    }
  }

  protected readonly question = computed<RiskQuestion>(() => this.questions[this.index()]);
  protected readonly progress = computed(() => (this.index() / this.questions.length) * 100);
  protected readonly dimLabel = { capacity: 'Tu situación', tolerance: 'Tu actitud', knowledge: 'Tu experiencia' };

  protected start(): void {
    this.answers.set({});
    this.index.set(0);
    this.dir.set('next');
    this.picked.set(null);
    this.mode.set('quiz');
  }

  /** Picks an option: a short highlight (and a nod for the quiz answer), then the next question. */
  protected choose(optionId: string): void {
    if (this.picked()) return;
    const q = this.question();
    this.picked.set(optionId);
    this.answers.update((a) => ({ ...a, [q.id]: optionId }));
    const opt = q.options.find((o) => o.id === optionId);
    if (q.id === 'quiz') this.flash.set(opt?.correct ? '¡Correcto! Hace falta un 100 %.' : 'Era un 100 %: de 50 € a 100 € hay que doblar.');
    this.later(() => {
      this.flash.set(null);
      this.picked.set(null);
      if (this.index() < this.questions.length - 1) {
        this.dir.set('next');
        this.index.update((i) => i + 1);
      } else void this.finish();
    }, q.id === 'quiz' ? 1300 : 380);
  }

  protected back(): void {
    if (this.picked() || this.index() === 0) return;
    this.dir.set('back');
    this.index.update((i) => i - 1);
  }

  protected key(e: KeyboardEvent): void {
    if (this.mode() !== 'quiz' || this.finding() || e.ctrlKey || e.metaKey || e.altKey) return;
    const n = Number(e.key);
    const opts = this.question().options;
    if (n >= 1 && n <= opts.length) {
      e.preventDefault();
      this.choose(opts[n - 1].id);
    } else if (e.key === 'Backspace' || e.key === 'ArrowLeft') {
      e.preventDefault();
      this.back();
    }
  }

  private async finish(): Promise<void> {
    const r = scoreAnswers(this.answers());
    try {
      await firstValueFrom(this.http.post(API, { answers: this.answers(), ...r }));
      const h = await firstValueFrom(this.http.get<{ history: Saved[] }>(API));
      this.history.set(h.history);
    } catch (error) {
      this.store.error(error, 'No se pudo guardar el resultado (se muestra igualmente).');
    }
    this.showResult(r);
  }

  /** Shows a result with the score counting up. */
  private showResult(r: RiskResult): void {
    this.result.set(r);
    this.mode.set('result');
    this.shown.set(0);
    const steps = 30;
    for (let i = 1; i <= steps; i++) this.later(() => this.shown.set(Math.round((r.score * i) / steps)), i * 25);
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }

  protected readonly profile = computed(() => PROFILES.find((p) => p.id === this.result()?.profile) ?? PROFILES[2]);
  protected readonly profileIndex = computed(() => PROFILES.findIndex((p) => p.id === this.result()?.profile));

  /** Share of the real portfolio in risky assets (stocks, ETFs, funds, crypto). */
  protected readonly riskyShare = computed(() => {
    const assets = this.store.assets();
    const total = assets.reduce((s, a) => s + a.valueEur, 0);
    if (total <= 0) return null;
    return (assets.filter((a) => RISKY.has(a.typeCode)).reduce((s, a) => s + a.valueEur, 0) / total) * 100;
  });

  protected readonly fit = computed(() => {
    const share = this.riskyShare();
    if (share == null) return null;
    const [lo, hi] = this.profile().equity;
    if (share > hi + 5) return { cls: 'over', text: `Tu cartera tiene más riesgo que tu perfil: ${share.toFixed(0)} % en activos de riesgo frente al ${lo}–${hi} % orientativo.` };
    if (share < lo - 5) return { cls: 'under', text: `Tu cartera es más prudente que tu perfil: ${share.toFixed(0)} % en activos de riesgo frente al ${lo}–${hi} % orientativo.` };
    return { cls: 'ok', text: `Tu cartera encaja con tu perfil: ${share.toFixed(0)} % en activos de riesgo (orientativo ${lo}–${hi} %).` };
  });

  protected rangeWidth(v: number): number {
    return Math.min(100, (Math.abs(v) / 4000) * 100);
  }

  protected euros(v: number): string {
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-ES')} €`;
  }

  /** "Manager · category · ISIN", skipping what is missing. */
  protected subline(d: SavedFund['data']): string {
    return [d.manager, d.category, d.isin].filter((x) => !!x).join(' · ');
  }

  /** Colour of risk step i (1 green … 7 red). */
  protected riskColor(i: number): string {
    return ['#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#be123c', '#9f1239'][i - 1];
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  protected profileName(id: string): string {
    return PROFILES.find((p) => p.id === id)?.name ?? id;
  }
}
