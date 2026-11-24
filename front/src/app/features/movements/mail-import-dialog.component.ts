import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatDay, MASK, privacy } from '../../shared/format.utils';

type ImportEvent = { n: number; level: 'info' | 'ok' | 'skip' | 'warn' | 'error'; text: string };
type Status = 'new' | 'exists' | 'maybe' | 'imported' | 'cancelled';
type Candidate = {
  key: string; template: string; bankId: string; bankName: string; type: 'operation' | 'order'; kind: 'buy' | 'sell';
  date: string; name: string; quantity: number; price: number | null; currency: string; amount: number | null;
  status: Status; note: string; assetName: string; suggest?: boolean;
};
type ImportJob = {
  id: string; userName: string; source: 'demo' | 'gmail'; phase: 'scanning' | 'review' | 'applying' | 'done' | 'error';
  total: number; processed: number; created: number; linked: number; skipped: number; failed: number;
  events: ImportEvent[]; candidates: Candidate[];
};
type Setup = {
  user: { id: string; name: string };
  banks: Array<{ id: string; name: string; template: string | null }>;
  last: { at: string | null; mailDate: string | null; banks: string[] } | null;
  since: string; gmail: boolean;
};

const BASE = 'http://localhost:3000/api/v2/mail-import';
const GMAIL = 'http://localhost:3000/api/v2/gmail';

/**
 * Import from e-mail in three steps: pick banks and start day → the back reads the e-mails (real progress, nothing is
 * written) → the user reviews every operation found (new / already registered / already imported) and ticks which
 * go in. Always says in which user it imports.
 */
@Component({
  selector: 'app-mail-import-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mail-import-dialog.component.html',
  styleUrl: './mail-import-dialog.component.css'
})
export class MailImportDialogComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PortfolioStore);
  readonly closed = output<void>();
  protected readonly day = formatDay;

  protected readonly setup = signal<Setup | null>(null);
  protected readonly gmail = signal<{ configured: boolean; connected: boolean; email: string | null } | null>(null);
  protected readonly picked = signal<string[]>([]);
  protected since = '';

  protected readonly job = signal<ImportJob | null>(null);
  protected readonly events = signal<ImportEvent[]>([]);
  protected readonly ticked = signal<Set<string>>(new Set());
  protected readonly filter = signal<'all' | Status>('all');
  protected readonly icons: Record<ImportEvent['level'], string> = { info: '›', ok: '✓', skip: '–', warn: '!', error: '✕' };
  private readonly logEl = viewChild<ElementRef<HTMLElement>>('log');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  /** setup → scanning → review → applying → done. */
  protected readonly step = computed(() => this.job()?.phase ?? 'setup');
  protected readonly busy = computed(() => this.step() === 'scanning' || this.step() === 'applying');

  ngOnInit(): void {
    void this.load();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private async load(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<Setup>(`${BASE}/setup`));
      this.setup.set(s);
      this.since = s.since;
      // The banks of the last import, else the ones the app knows how to read.
      const last = (s.last?.banks ?? []).filter((id) => s.banks.some((b) => b.id === id));
      this.picked.set(last.length ? last : s.banks.filter((b) => b.template).map((b) => b.id));
    } catch (error) {
      this.store.error(error, 'No se pudo preparar la importación.');
    }
    await this.loadGmail();
  }

  protected async loadGmail(): Promise<void> {
    try {
      this.gmail.set(await firstValueFrom(this.http.get<{ configured: boolean; connected: boolean; email: string | null }>(GMAIL + '/status')));
    } catch {
      this.gmail.set({ configured: false, connected: false, email: null });
    }
  }

  protected toggleBank(id: string): void {
    this.picked.update((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  /** Google's consent screen in a new tab; back here, "Ya lo he conectado" reloads the status. */
  protected async connect(): Promise<void> {
    const tab = window.open('', '_blank');
    try {
      const { url } = await firstValueFrom(this.http.post<{ url: string }>(GMAIL + '/connect', {}));
      if (tab) tab.location.href = url;
      else location.href = url;
    } catch (error) {
      tab?.close();
      this.store.error(error, 'No se pudo abrir Google.');
    }
  }

  protected async disconnect(): Promise<void> {
    await firstValueFrom(this.http.post(GMAIL + '/disconnect', {}));
    await this.loadGmail();
  }

  protected async scan(): Promise<void> {
    try {
      const { jobId } = await firstValueFrom(this.http.post<{ jobId: string }>(`${BASE}/scan`, { banks: this.picked(), since: this.since }));
      this.events.set([]);
      void this.poll(jobId);
    } catch (error) {
      this.store.error(error, 'No se pudo empezar la búsqueda.');
    }
  }

  private async poll(jobId: string): Promise<void> {
    if (this.stopped) return;
    const after = this.events().at(-1)?.n ?? -1;
    try {
      const j = await firstValueFrom(this.http.get<ImportJob>(`${BASE}/${jobId}?after=${after}`));
      const was = this.job()?.phase;
      this.job.set(j);
      if (j.events.length) {
        this.events.update((list) => [...list, ...j.events]);
        queueMicrotask(() => {
          const el = this.logEl()?.nativeElement;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
      // Entering review: every new row ticked by default.
      if (j.phase === 'review' && was !== 'review') this.ticked.set(new Set(j.candidates.filter((c) => c.status === 'new' && c.suggest !== false).map((c) => c.key)));
      if (j.phase === 'done') {
        if (j.created) await this.store.changed(`${j.created} movimientos importados del correo`);
        return;
      }
      if (j.phase === 'review' || j.phase === 'error') return;
    } catch {
      /* a failed poll just waits for the next one */
    }
    this.timer = setTimeout(() => void this.poll(jobId), 350);
  }

  protected readonly rows = computed(() => {
    const f = this.filter();
    const order: Record<Status, number> = { new: 0, maybe: 1, exists: 2, imported: 3, cancelled: 4 };
    return (this.job()?.candidates ?? [])
      .filter((c) => f === 'all' || c.status === f)
      .sort((a, b) => order[a.status] - order[b.status] || a.date.localeCompare(b.date));
  });

  /** Rows the user can tick: new ones (ticked by default) and doubtful ones (unticked). */
  protected tickable(s: Status): boolean {
    return s === 'new' || s === 'maybe';
  }

  protected count(s: Status): number {
    return (this.job()?.candidates ?? []).filter((c) => c.status === s).length;
  }

  protected toggle(key: string): void {
    this.ticked.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected tickAll(on: boolean): void {
    this.ticked.set(new Set(on ? (this.job()?.candidates ?? []).filter((c) => c.status === 'new').map((c) => c.key) : []));
  }

  protected async apply(): Promise<void> {
    const j = this.job();
    if (!j) return;
    try {
      await firstValueFrom(this.http.post(`${BASE}/${j.id}/apply`, { keys: [...this.ticked()] }));
      this.job.set({ ...j, phase: 'applying' });
      void this.poll(j.id);
    } catch (error) {
      this.store.error(error, 'No se pudo importar.');
    }
  }

  protected statusLabel(s: Status): string {
    return { new: 'Nueva', exists: 'Ya la tienes', maybe: '¿Ya la tienes?', imported: 'Ya importada', cancelled: 'Anulada' }[s];
  }

  protected num(v: number | null, d = 2): string {
    if (privacy() && v != null) return MASK;
    return v == null ? '—' : v.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }

  protected lastText(): string {
    const l = this.setup()?.last;
    if (!l?.at) return 'Nunca has importado en este usuario: se buscará desde el 1 de enero.';
    const at = new Date(l.at).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `Última importación: ${at}${l.mailDate ? ` (correos hasta el ${formatDay(l.mailDate)})` : ''}.`;
  }

  protected close(): void {
    if (!this.busy()) this.closed.emit();
  }
}
