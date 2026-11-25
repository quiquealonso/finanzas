import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { TourService } from './tour.service';

type Rect = { top: number; left: number; width: number; height: number };
/** Share of the screen height from which an element counts as big (scrolled to the top, bubble in a corner). */
const TALL = 0.55;

/**
 * The tour on screen: a soft spotlight around the element of the step (data-tour="…"), a bubble with the text, and
 * a small banner while the tour waits (risk test in progress) or while a dialog of the app is open. The page under it
 * keeps working: the spotlight does not catch clicks.
 */
@Component({
  selector: 'app-tour',
  standalone: true,
  template: `
    @if (tour.active()) {
      @let s = tour.step();
      @let info = tour.chapterInfo();
      @switch (mode()) {
        @case ('pill') {
          <div class="pill" role="status">
            <span class="dot"></span>
            @if (dialogOpen()) {
              <span>Tutorial en pausa: cierra la ventana para seguir.</span>
            } @else {
              <span><strong>{{ s.title }}</strong> · el tutorial sigue cuando acabes</span>
              <button type="button" class="btn sm link" (click)="tour.next()">Saltar este paso</button>
            }
          </div>
        }
        @default {
          @if (mode() === 'spot' && rect(); as r) {
            <div class="spot" [style.top.px]="r.top - 6" [style.left.px]="r.left - 6" [style.width.px]="r.width + 12" [style.height.px]="r.height + 12"></div>
          } @else {
            <div class="dim"></div>
          }
          <div class="bubble" role="dialog" aria-live="polite" [class.center]="mode() === 'center'" [class.corner]="corner()"
               [style.top.px]="bubblePos()?.top" [style.left.px]="bubblePos()?.left">
            <div class="meta">
              <span class="chapter">{{ info.chapter }}</span>
              <span class="faint small">{{ info.overall }} de {{ info.total }}</span>
            </div>
            <div class="bar"><div [style.width.%]="(info.overall / info.total) * 100"></div></div>
            <h3>{{ s.title }}</h3>
            <p [innerHTML]="s.text"></p>
            <div class="buttons">
              @if (s.actions) {
                @for (a of s.actions; track a.label) {
                  <button type="button" class="btn" [class.primary]="a.primary" (click)="tour.action(a.goto)">{{ a.label }}</button>
                }
              } @else {
                <button type="button" class="btn sm link skip" (click)="tour.finish()">Saltar tutorial</button>
                <span class="spacer"></span>
                @if (info.overall > 1) { <button type="button" class="btn" (click)="tour.back()">Atrás</button> }
                @if (!s.waitFor) { <button type="button" class="btn primary" (click)="tour.next()">Siguiente</button> }
              }
            </div>
          </div>
        }
      }
    }
  `,
  styles: `
    .dim { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.35); z-index: 900; pointer-events: none; }
    .spot {
      position: fixed; z-index: 900; border-radius: 12px; pointer-events: none;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.38), 0 0 0 3px #8b5cf6;
      transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
    }
    .bubble {
      position: fixed; z-index: 901; width: min(380px, calc(100vw - 24px)); padding: 16px 18px; border-radius: 14px;
      background: var(--surface); color: var(--text); border: 1px solid var(--border);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.25); animation: rise 0.25s ease-out;
      transition: top 0.25s ease, left 0.25s ease;
    }
    .bubble.center { top: 50% !important; left: 50% !important; transform: translate(-50%, -50%); width: min(460px, calc(100vw - 24px)); }
    .bubble.corner { top: auto !important; left: auto !important; right: 20px; bottom: 20px; }
    @keyframes rise { from { opacity: 0; translate: 0 8px; } to { opacity: 1; translate: 0 0; } }
    .meta { display: flex; justify-content: space-between; align-items: center; }
    .chapter { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8b5cf6; }
    .bar { height: 3px; border-radius: 999px; background: var(--surface-2); margin: 8px 0 10px; overflow: hidden; }
    .bar > div { height: 100%; background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899); transition: width 0.3s ease; }
    h3 { margin: 0 0 6px; font-size: 16px; }
    p { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--text-2); }
    .buttons { display: flex; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .bubble.center .buttons { flex-direction: column; align-items: stretch; }
    .spacer { flex: 1; }
    .skip { color: var(--text-3); padding-left: 0; }
    .pill {
      position: fixed; z-index: 901; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; align-items: center;
      gap: 10px; padding: 8px 14px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border);
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.2); font-size: 13px; max-width: calc(100vw - 24px);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #8b5cf6; animation: blink 1.2s infinite; flex: none; }
    @keyframes blink { 50% { opacity: 0.3; } }
    @media (prefers-reduced-motion: reduce) { .spot, .bubble, .bar > div { transition: none; animation: none; } }
  `
})
export class TourComponent implements OnInit, OnDestroy {
  protected readonly tour = inject(TourService);
  protected readonly rect = signal<Rect | null>(null);
  protected readonly dialogOpen = signal(false);
  /** The step waits for something (e.g. the test) and its element is not on screen. */
  private readonly waiting = signal(false);
  private timer: ReturnType<typeof setInterval> | null = null;
  private scrolledFor = -1;

  protected readonly mode = computed<'spot' | 'center' | 'pill'>(() => {
    if (this.dialogOpen() || this.waiting()) return 'pill';
    return this.tour.step().target && this.rect() ? 'spot' : 'center';
  });

  /** Tall elements (whole tables): the bubble goes to a corner instead of above or below. */
  protected readonly corner = computed(() => {
    const r = this.rect();
    return this.mode() === 'spot' && !!r && r.height > window.innerHeight * TALL;
  });

  protected readonly bubblePos = computed(() => {
    const r = this.rect();
    if (this.mode() !== 'spot' || !r || this.corner()) return null;
    const w = Math.min(380, window.innerWidth - 24);
    const below = r.top + r.height + 14;
    const top = below + 230 < window.innerHeight ? below : Math.max(12, r.top - 244);
    const left = Math.min(Math.max(12, r.left), window.innerWidth - w - 12);
    return { top, left };
  });

  constructor() {
    // A new step: scroll its element into view once.
    effect(() => {
      this.tour.index();
      this.scrolledFor = -1;
    });
  }

  ngOnInit(): void {
    this.timer = setInterval(() => this.tick(), 200);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private tick(): void {
    if (!this.tour.active()) return;
    const step = this.tour.step();
    this.dialogOpen.set(!!document.querySelector('.dialog-backdrop'));
    if (step.waitFor && document.querySelector(step.waitFor)) {
      this.waiting.set(false);
      this.tour.next();
      return;
    }
    const el = step.target ? (document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null) : null;
    this.waiting.set(!!step.waitFor && !el);
    if (!el) {
      this.rect.set(null);
      return;
    }
    if (this.scrolledFor !== this.tour.index()) {
      this.scrolledFor = this.tour.index();
      // Big blocks (tables, the whole calendar): their top goes to the top of the screen; small ones are centred.
      const box = el.getBoundingClientRect();
      if (box.height > window.innerHeight * TALL) {
        // Already starting in the upper half (e.g. right under the page title): leave the page as it opened.
        if (box.top < 0 || box.top > window.innerHeight * 0.5) {
          window.scrollTo({ top: Math.max(0, box.top + window.scrollY - 16), behavior: 'smooth' });
        }
      } else {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
    // Spotlight only on the visible part of the element.
    const b = el.getBoundingClientRect();
    const top = Math.max(b.top, 8);
    const bottom = Math.min(b.bottom, window.innerHeight - 8);
    const r = { top, left: b.left, width: b.width, height: Math.max(0, bottom - top) };
    const old = this.rect();
    if (!old || Math.abs(old.top - r.top) > 0.5 || Math.abs(old.left - r.left) > 0.5 || Math.abs(old.width - r.width) > 0.5 || Math.abs(old.height - r.height) > 0.5) {
      this.rect.set(r);
    }
  }
}
