import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { formatMoney0, privacy } from '../../shared/format.utils';

export type SimLine = { label: string; color: string; values: number[] };

const W = 760;
const H = 280;
const PAD = { left: 52, right: 16, top: 14, bottom: 28 };

/**
 * Yearly chart of the Simulador: one or more lines (value of the investment) over a grey area (money put in).
 * Point i = end of year i (0 = today). Hover shows every value of that year.
 */
@Component({
  selector: 'app-sim-chart',
  standalone: true,
  template: `
    <div class="wrap" (mouseleave)="hover.set(null)">
      <svg [attr.viewBox]="'0 0 ' + W() + ' ' + H" (mousemove)="onMove($event)">
        @for (t of geo().ticks; track t.y) {
          <line class="grid" [attr.x1]="PAD.left" [attr.x2]="W() - PAD.right" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text class="ylab" [attr.x]="PAD.left - 6" [attr.y]="t.y + 4">{{ t.label }}</text>
        }
        <path class="paid" [attr.d]="geo().paidArea" />
        @for (l of geo().lines; track l.label) {
          <path class="line" [attr.d]="l.d" [attr.stroke]="l.color" />
        }
        @for (x of geo().xs; track x.i) {
          @if (x.label) { <text class="xlab" [attr.x]="x.x" [attr.y]="H - 8">{{ x.label }}</text> }
        }
        @if (hover() !== null) {
          <line class="cursor" [attr.x1]="geo().xs[hover()!].x" [attr.x2]="geo().xs[hover()!].x" [attr.y1]="PAD.top" [attr.y2]="H - PAD.bottom" />
          @for (l of geo().lines; track l.label) {
            <circle [attr.cx]="geo().xs[hover()!].x" [attr.cy]="l.ys[hover()!]" r="4" [attr.fill]="l.color" />
          }
        }
      </svg>
      @if (hover() !== null) {
        <div class="tip" [style.left.%]="(geo().xs[hover()!].x / W()) * 100" [class.flip]="hover()! > years() / 2">
          <div class="faint small">{{ hover() === 0 ? 'Hoy' : hover() + (hover() === 1 ? ' año' : ' años') }} · {{ startYear() + hover()! }}</div>
          @for (l of lines(); track l.label) {
            <div class="row"><span class="dot" [style.background]="l.color"></span>{{ l.label }}: <strong>{{ money(l.values[hover()!]) }}</strong></div>
          }
          <div class="row"><span class="dot paid-dot"></span>Tu aportación: <strong>{{ money(paid()[hover()!]) }}</strong></div>
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    svg { width: 100%; height: 280px; display: block; }
    .grid { stroke: var(--border); stroke-width: 1; }
    .ylab { fill: var(--text-3); font-size: 11px; text-anchor: end; }
    .xlab { fill: var(--text-3); font-size: 11px; text-anchor: middle; }
    .paid { fill: var(--surface-2); stroke: var(--border-strong); stroke-width: 1; }
    .line { fill: none; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .cursor { stroke: var(--border-strong); stroke-dasharray: 3 3; }
    .tip {
      position: absolute; top: 8px; transform: translateX(12px); min-width: 190px; padding: 8px 10px; border-radius: 10px;
      background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
      font-size: 12.5px; pointer-events: none; display: flex; flex-direction: column; gap: 3px;
    }
    .tip.flip { transform: translateX(calc(-100% - 12px)); }
    .row { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .row strong { font-variant-numeric: tabular-nums; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .paid-dot { background: var(--surface-2); border: 1px solid var(--border-strong); }
  `
})
export class SimChartComponent {
  readonly lines = input.required<SimLine[]>();
  /** Money put in at the end of each year. */
  readonly paid = input.required<number[]>();
  readonly startYear = input(new Date().getFullYear());
  protected readonly hover = signal<number | null>(null);
  /** Real width in pixels: the drawing is redone at that width, so the text is never stretched. */
  protected readonly W = signal(W);
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly resize = new ResizeObserver(([e]) => this.W.set(Math.max(200, Math.round(e.contentRect.width))));

  constructor() {
    afterNextRender(() => this.resize.observe(this.el.nativeElement.querySelector('.wrap')));
    inject(DestroyRef).onDestroy(() => this.resize.disconnect());
  }
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly years = computed(() => this.paid().length - 1);

  protected readonly geo = computed(() => {
    const n = this.paid().length;
    const all = [...this.paid(), ...this.lines().flatMap((l) => l.values)];
    const max = niceMax(Math.max(1, ...all));
    const min = Math.min(0, ...all);
    const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * (this.W() - PAD.left - PAD.right) : 0);
    const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);
    const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const bottom = y(Math.max(0, min));
    const paidArea = `${path(this.paid())}L${x(n - 1).toFixed(1)},${bottom.toFixed(1)}L${x(0).toFixed(1)},${bottom.toFixed(1)}Z`;
    const every = n > 26 ? 5 : n > 13 ? 2 : 1;
    const hide = privacy();
    return {
      lines: this.lines().map((l) => ({ ...l, d: path(l.values), ys: l.values.map(y) })),
      paidArea,
      xs: Array.from({ length: n }, (_, i) => ({ i, x: x(i), label: i % every === 0 || i === n - 1 ? String(this.startYear() + i) : '' })),
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: y(min + f * (max - min)), label: hide ? '•••' : compact(min + f * (max - min)) })),
    };
  });

  protected onMove(e: MouseEvent): void {
    const svg = e.currentTarget as SVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * this.W();
    const n = this.paid().length;
    const i = Math.round(((px - PAD.left) / (this.W() - PAD.left - PAD.right)) * (n - 1));
    this.hover.set(Math.max(0, Math.min(n - 1, i)));
  }

  protected money(v: number): string {
    return formatMoney0(v);
  }
}

function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p / 0.5) * 0.5 * p;
}

function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}
