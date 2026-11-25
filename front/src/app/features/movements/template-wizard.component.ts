import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PortfolioStore } from '../../core/portfolio.store';
import { isDemo } from '../../demo/demo-mode';

const API = 'http://localhost:3000/api/v2/mail-templates';

type Candidate = { id: string; from: string; date: string; subject: string; snippet: string };
type Event = { n: number; level: 'info' | 'ok' | 'ai' | 'warn' | 'error'; text: string };
type Op = { kind: 'buy' | 'sell'; date: string; name: string; isin: string | null; quantity: number; price: number; amount: number; currency: string };
type Job = {
  id: string; phase: 'running' | 'done' | 'error'; events: Event[]; model: string | null;
  draft: { label: string; query: string; what: string } | null;
  results: Array<{ id: string; date: string; subject: string; op: Op | null; missing: string[] }>;
};

const FIELD: Record<string, string> = { kind: 'compra o venta', date: 'fecha', name: 'producto', quantity: 'títulos', amount: 'importe' };

/**
 * "✦ Crear plantilla" for a bank the app cannot read yet: pick example e-mails → the AI proposes how to read them
 * (personal data masked first, only with the user's consent) → the app tests it on the real e-mails → save it for
 * everybody with that bank (back/src/mail-templates.ts).
 */
@Component({
  selector: 'app-template-wizard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wizard">
      <div class="q">
        <h3><span class="ai-badge">✦</span> Enseña a la app a leer los correos de {{ bank().name }}</h3>
        <p class="faint small">Así ayudas a mejorar la app: la plantilla quedará guardada para cualquiera que tenga {{ bank().name }}.</p>
      </div>

      @if (demo) {
        <div class="notice">En la demo no hay correos reales con los que crear plantillas. En tu cuenta funciona con tu Gmail (solo lectura).</div>
      } @else {
        @switch (step()) {
          @case ('search') {
            <ol class="how small">
              <li>Elige 1 a 3 correos de <strong>confirmación de una compra o venta</strong> (mejor si hay de los dos tipos).</li>
              <li>La IA propone cómo leerlos y la app lo prueba con tus correos.</li>
              <li>Revisas lo que ha leído y guardas la plantilla.</li>
            </ol>
            <div class="refine">
              <label class="small">Remitente (opcional) <input type="text" [(ngModel)]="from" placeholder="p. ej. traderepublic.com" /></label>
              <button type="button" class="btn sm" (click)="search()" [disabled]="loading()">Buscar otra vez</button>
            </div>
            @if (loading()) {
              <p class="faint small">Buscando correos de {{ bank().name }} en tu Gmail (solo lectura)…</p>
            } @else if (!mails().length) {
              <p class="faint small">No aparece ningún correo que parezca una operación. Prueba con el remitente (el dominio de los correos del banco).</p>
            } @else {
              <ul class="mails">
                @for (m of mails(); track m.id) {
                  <li>
                    <label class="mail" [class.on]="chosen().includes(m.id)">
                      <input type="checkbox" [checked]="chosen().includes(m.id)" (change)="toggle(m.id)" [disabled]="!chosen().includes(m.id) && chosen().length >= 3" />
                      <span class="m-main">
                        <strong>{{ m.subject || '(sin asunto)' }}</strong>
                        <span class="faint small">{{ m.date }} · {{ m.from }}</span>
                        <span class="faint small snippet">{{ m.snippet }}</span>
                      </span>
                    </label>
                  </li>
                }
              </ul>
            }
            <label class="consent small">
              <input type="checkbox" [(ngModel)]="consent" />
              <span>Acepto que el texto de estos correos se envíe a la IA (Google Gemini) para crear la plantilla. Antes se tapan
                mi nombre, números de cuenta e IBAN, DNI, teléfonos y direcciones de correo. Solo se usa para esto.</span>
            </label>
          }
          @case ('running') {
            <div class="thinking"><div class="orb"><span></span><span></span><span></span></div><strong>La IA está creando la plantilla…</strong></div>
            <ol class="log">
              @for (e of events(); track e.n) { <li [class]="e.level"><span class="icon">{{ e.level === 'ai' ? '✦' : e.level === 'ok' ? '✓' : e.level === 'warn' ? '!' : e.level === 'error' ? '✕' : '›' }}</span>{{ e.text }}</li> }
            </ol>
          }
          @case ('review') {
            @if (job(); as j) {
              <p class="summary small">
                La plantilla lee <strong>{{ okCount() }} de {{ j.results.length }}</strong> correos.
                @if (j.model) { <span class="ai-badge sm">✦ {{ j.model }}</span> }
              </p>
              <div class="table-wrap">
                <table class="compact">
                  <thead><tr><th></th><th>Correo</th><th>Operación</th><th>Fecha</th><th>Producto</th><th class="r">Títulos</th><th class="r">Precio</th><th class="r">Importe</th></tr></thead>
                  <tbody>
                    @for (r of j.results; track r.id) {
                      <tr>
                        <td>{{ r.op ? '✓' : '✕' }}</td>
                        <td class="faint small subj">{{ r.subject }}</td>
                        @if (r.op; as o) {
                          <td>{{ o.kind === 'buy' ? 'Compra' : 'Venta' }}</td><td>{{ o.date }}</td><td>{{ o.name }}@if (o.isin) { <span class="faint small"> · {{ o.isin }}</span> }</td>
                          <td class="r num">{{ o.quantity }}</td><td class="r num">{{ o.price.toFixed(4) }}</td><td class="r num">{{ o.amount }} {{ o.currency }}</td>
                        } @else {
                          <td colspan="6" class="down small">No lee: {{ missingText(r.missing) }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (j.draft; as d) {
                <p class="faint small">Buscará en Gmail: <code>{{ d.query }}</code> · Lee: {{ d.what }}.</p>
              }
              <p class="small">Comprueba que fecha, producto, títulos e importe son los de tus correos. Si algo está mal, prueba con otros ejemplos.</p>
            }
          }
          @case ('error') {
            <ol class="log short">
              @for (e of events(); track e.n) { <li [class]="e.level"><span class="icon">›</span>{{ e.text }}</li> }
            </ol>
          }
          @case ('saved') {
            <div class="saved">✓ Plantilla de {{ bank().name }} guardada. Ya puedes importar sus correos, y también cualquier otro usuario con {{ bank().name }}.</div>
          }
        }
      }

      <div class="foot">
        <button type="button" class="btn link" (click)="cancel.emit()">‹ Volver</button>
        <span class="spacer"></span>
        @if (!demo) {
          @switch (step()) {
            @case ('search') { <button type="button" class="btn ai" (click)="generate()" [disabled]="!chosen().length || !consent">✦ Crear la plantilla</button> }
            @case ('review') {
              <button type="button" class="btn" (click)="step.set('search')">Probar con otros correos</button>
              <button type="button" class="btn primary" (click)="save()" [disabled]="okCount() !== (job()?.results?.length ?? 0)">Guardar plantilla</button>
            }
            @case ('error') { <button type="button" class="btn" (click)="step.set('search')">Probar con otros correos</button> }
            @case ('saved') { <button type="button" class="btn primary" (click)="done.emit()">Seguir con la importación</button> }
          }
        }
      </div>
    </div>
  `,
  styles: `
    .wizard { display: flex; flex-direction: column; gap: 12px; }
    .q h3 { margin: 0; font-size: 15px; display: flex; align-items: center; gap: 8px; }
    .q p { margin: 2px 0 0; }
    .ai-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 7px; color: #fff; font-size: 12px; background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899); }
    .ai-badge.sm { font-size: 11px; height: 18px; margin-left: 6px; }
    .how { margin: 0; padding-left: 18px; color: var(--text-2); display: flex; flex-direction: column; gap: 2px; }
    .refine { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
    .refine label { display: flex; flex-direction: column; gap: 4px; }
    .refine input { height: 32px; width: 240px; }
    .mails { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 300px; overflow-y: auto; }
    .mail { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
    .mail.on { border-color: var(--accent); background: var(--accent-soft); }
    .m-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .m-main strong { font-size: 13px; font-weight: 600; }
    .snippet { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .consent { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); line-height: 1.45; }
    .thinking { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; background: var(--surface-2); }
    .orb { position: relative; width: 30px; height: 30px; flex: none; }
    .orb span { position: absolute; inset: 0; border-radius: 50%; border: 2px solid transparent; border-top-color: #8b5cf6; animation: spin 1.1s linear infinite; }
    .orb span:nth-child(2) { inset: 4px; border-top-color: #ec4899; animation-duration: 1.6s; animation-direction: reverse; }
    .orb span:nth-child(3) { inset: 9px; border-top-color: #6366f1; animation-duration: 0.9s; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .log { list-style: none; margin: 0; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-family: var(--mono); font-size: 12px; display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; }
    .log li { display: flex; gap: 8px; }
    .log .icon { width: 14px; flex: none; text-align: center; }
    .log .ai { color: #a855f7; font-weight: 600; }
    .log .ok { color: var(--up); }
    .log .warn { color: var(--warn-text); }
    .log .error { color: var(--down); }
    .summary { margin: 0; }
    .subj { max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .r { text-align: right; }
    .down { color: var(--down); }
    code { font-family: var(--mono); font-size: 12px; }
    .saved { padding: 12px 14px; border-radius: 10px; background: var(--up-soft); color: var(--up); font-weight: 500; }
    .foot { display: flex; align-items: center; gap: 8px; }
    .spacer { flex: 1; }
    .btn.ai { border: 0; color: #fff; font-weight: 600; background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899); }
    .btn.ai:disabled { opacity: 0.5; }
  `
})
export class TemplateWizardComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PortfolioStore);
  readonly bank = input.required<{ id: string; name: string }>();
  readonly cancel = output<void>();
  /** A template was saved: the dialog reloads the banks. */
  readonly done = output<void>();
  protected readonly demo = isDemo();

  protected readonly step = signal<'search' | 'running' | 'review' | 'error' | 'saved'>('search');
  protected readonly loading = signal(false);
  protected readonly mails = signal<Candidate[]>([]);
  protected readonly chosen = signal<string[]>([]);
  protected readonly job = signal<Job | null>(null);
  protected readonly events = signal<Event[]>([]);
  protected from = '';
  protected consent = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  ngOnInit(): void {
    if (!this.demo) void this.search();
  }

  ngOnDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  protected async search(): Promise<void> {
    this.loading.set(true);
    try {
      const r = await firstValueFrom(this.http.post<{ mails: Candidate[] }>(`${API}/candidates`, { bankId: this.bank().id, from: this.from }));
      this.mails.set(r.mails);
      this.chosen.set([]);
    } catch (error) {
      this.store.error(error, 'No se pudieron buscar los correos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(id: string): void {
    this.chosen.update((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id].slice(0, 3)));
  }

  protected async generate(): Promise<void> {
    try {
      const { jobId } = await firstValueFrom(this.http.post<{ jobId: string }>(`${API}/generate`, { bankId: this.bank().id, mailIds: this.chosen(), consent: this.consent }));
      this.events.set([]);
      this.step.set('running');
      void this.poll(jobId);
    } catch (error) {
      this.store.error(error, 'No se pudo empezar.');
    }
  }

  private async poll(id: string): Promise<void> {
    if (this.stopped) return;
    try {
      const after = this.events().at(-1)?.n ?? -1;
      const j = await firstValueFrom(this.http.get<Job>(`${API}/job/${id}?after=${after}`));
      this.events.update((l) => [...l, ...j.events]);
      this.job.set(j);
      if (j.phase === 'done') return this.step.set('review');
      if (j.phase === 'error') return this.step.set('error');
    } catch {
      /* next poll */
    }
    this.timer = setTimeout(() => void this.poll(id), 600);
  }

  protected okCount(): number {
    return (this.job()?.results ?? []).filter((r) => r.op).length;
  }

  protected missingText(missing: string[]): string {
    return missing.map((m) => FIELD[m] ?? m).join(', ');
  }

  protected async save(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(API, { jobId: this.job()!.id }));
      this.step.set('saved');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar la plantilla.');
    }
  }
}
