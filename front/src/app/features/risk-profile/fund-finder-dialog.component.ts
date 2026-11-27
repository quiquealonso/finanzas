import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { PROFILES } from './risk-questions';
import { fundLink, FundPick as Pick, money, pct, plain, regionFlags, SavedFund, ZONES } from './fund-format';
import { API_ORIGIN } from '../../core/api-origin';

const API = `${API_ORIGIN}/api/v2/fund-finder`;
const SAVED_API = `${API_ORIGIN}/api/v2/saved-funds`;

type Event = { n: number; level: 'info' | 'ok' | 'ai' | 'warn' | 'error'; text: string };
type Job = { id: string; phase: 'running' | 'done' | 'error'; events: Event[]; picks: Pick[]; model: string | null; considered: number; matched: number };

/**
 * After the risk test: pick regions → the back searches the CNMV and Yahoo funds that fit the profile there and an
 * AI picks 5 (progress shown step by step, like the mail import) → five cards with the reasons.
 */
@Component({
  selector: 'app-fund-finder-dialog',
  standalone: true,
  templateUrl: './fund-finder-dialog.component.html',
  styleUrl: './fund-finder-dialog.component.css',
  host: { '(document:keydown.escape)': 'close()' }
})
export class FundFinderDialogComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PortfolioStore);
  readonly profile = input.required<string>();
  readonly closed = output<void>();
  /** Some fund was saved: the page reloads its list. */
  readonly saved = output<void>();
  protected readonly zones = ZONES;

  protected readonly picked = signal<string[]>(['GLOBAL']);
  protected readonly job = signal<Job | null>(null);
  protected readonly events = signal<Event[]>([]);
  protected readonly step = computed(() => (!this.job() ? 'zones' : this.job()!.phase === 'running' ? 'searching' : 'results'));
  protected readonly profileInfo = computed(() => PROFILES.find((p) => p.id === this.profile()) ?? PROFILES[2]);
  private readonly logEl = viewChild<ElementRef<HTMLElement>>('log');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** ISINs already saved for this profile (button shows "Guardado"). */
  protected readonly savedIsins = signal<Set<string>>(new Set());
  protected readonly saving = signal(false);
  protected readonly allSaved = computed(() => {
    const picks = this.job()?.picks ?? [];
    return picks.length > 0 && picks.every((p) => this.savedIsins().has(p.isin));
  });

  constructor() {
    void this.loadSaved();
  }

  private async loadSaved(): Promise<void> {
    try {
      const rows = await firstValueFrom(this.http.get<SavedFund[]>(SAVED_API));
      this.savedIsins.set(new Set(rows.filter((r) => r.profile === this.profile()).map((r) => r.isin)));
    } catch {
      /* the buttons just start as "Guardar" */
    }
  }

  /** Saves the given picks for this profile and the chosen zones. */
  protected async save(picks: Pick[]): Promise<void> {
    const todo = picks.filter((p) => !this.savedIsins().has(p.isin));
    if (!todo.length || this.saving()) return;
    this.saving.set(true);
    try {
      await firstValueFrom(this.http.post(SAVED_API, { profile: this.profile(), zones: this.picked(), picks: todo }));
      this.savedIsins.update((s) => new Set([...s, ...todo.map((p) => p.isin)]));
      this.saved.emit();
    } catch (error) {
      this.store.error(error, 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  ngOnDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  protected toggle(id: string): void {
    this.picked.update((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  protected async search(): Promise<void> {
    try {
      const { jobId } = await firstValueFrom(this.http.post<{ jobId: string }>(API, { profile: this.profile(), regions: this.picked() }));
      this.events.set([]);
      this.job.set({ id: jobId, phase: 'running', events: [], picks: [], model: null, considered: 0, matched: 0 });
      void this.poll(jobId);
    } catch (error) {
      this.store.error(error, 'No se pudo empezar la búsqueda.');
    }
  }

  private async poll(id: string): Promise<void> {
    if (this.stopped) return;
    const after = this.events().at(-1)?.n ?? -1;
    try {
      const j = await firstValueFrom(this.http.get<Job>(`${API}/${id}?after=${after}`));
      if (j.events.length) {
        this.events.update((l) => [...l, ...j.events]);
        queueMicrotask(() => {
          const el = this.logEl()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
      this.job.set(j);
      if (j.phase !== 'running') return;
    } catch {
      /* next poll */
    }
    this.timer = setTimeout(() => void this.poll(id), 500);
  }

  protected again(): void {
    this.job.set(null);
    this.events.set([]);
  }

  protected close(): void {
    if (this.step() !== 'searching') this.closed.emit();
  }

  protected readonly pct = pct;
  protected readonly plain = plain;
  protected readonly money = money;
  protected readonly regionFlags = regionFlags;
  protected readonly link = fundLink;
}
