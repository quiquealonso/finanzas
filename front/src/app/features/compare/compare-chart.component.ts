import { Component, computed, input, signal } from '@angular/core';
import { formatDay, formatSignedPercent } from '../../shared/format.utils';

export type CompareLine = { id: string; label: string; color: string; values: number[]; dashed?: boolean; bold?: boolean };

const W = 900;
const H = 320;
const PAD = { left: 48, right: 14, top: 14, bottom: 28 };

/**
 * Chart of the page Comparar: one line per part of the portfolio and per index, all as % since the start of the
 * period (values = growth of 1 €; 1 = 0 %). Indexes dashed. Hover shows every line on that day, best first.
 */
@Component({
  selector: 'app-compare-chart',
  standalone: true,
  template: `
    <div class="wrap" (mouseleave)="hover.set(null)">
      <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" (mousemove)="onMove($event)">
        @for (t of geo().ticks; track t.y) {
          <line class="grid" [class.zero]="t.zero" [attr.x1]="PAD.left" [attr.x2]="W - PAD.right" [attr.y1]="t.y" [attr.y2]="t.y" />
          <text class="ylab" [attr.x]="PAD.left - 6" [attr.y]="t.y + 4">{{ t.label }}</text>
        }
        @for (x of geo().xs; track x.x) { <text class="xlab" [attr.x]="x.x" [attr.y]="H - 8">{{ x.label }}</text> }
        @for (l of geo().lines; track l.id) {
          <path class="line" [class.dashed]="l.dashed" [class.bold]="l.bold" [attr.d]="l.d" [attr.stroke]="l.color" />
        }
        @if (hover() !== null) {
          <line class="cursor" [attr.x1]="geo().x(hover()!)" [attr.x2]="geo().x(hover()!)" [attr.y1]="PAD.top" [attr.y2]="H - PAD.bottom" />
          @for (l of geo().lines; track l.id) {
            <circle [attr.cx]="geo().x(hover()!)" [attr.cy]="geo().y(l.values[hover()!])" r="3.5" [attr.fill]="l.color" />
          }
        }
      </svg>
      @if (hover() !== null) {
        <div class="tip" [style.left.%]="(geo().x(hover()!) / W) * 100" [class.flip]="hover()! > axis().length / 2">
          <div class="faint small">{{ day(axis()[hover()!]) }}</div>
          @for (r of tipRows(); track r.id) {
            <div class="row"><span class="dot" [style.background]="r.color"></span><span class="name">{{ r.label }}</span><strong>{{ pct(r.value) }}</strong></div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .wrap { position: relative; }
    svg { width: 100%; height: 320px; display: block; }
    .grid { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .grid.zero { stroke: var(--border-strong); }
    .ylab, .xlab { fill: var(--text-3); font-size: 11px; }
    .ylab { text-anchor: end; }
    .xlab { text-anchor: middle; }
    .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .line.bold { stroke-width: 3; }
    .line.dashed { stroke-dasharray: 6 4; stroke-width: 1.8; }
    .cursor { stroke: var(--border-strong); stroke-dasharray: 3 3; vector-effect: non-scaling-stroke; }
    .tip {
      position: absolute; top: 8px; transform: translateX(12px); min-width: 200px; padding: 8px 10px; border-radius: 10px;
      background: var(--surface); border: 1px solid var(--border-strong); box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
      font-size: 12.5px; pointer-events: none; display: flex; flex-direction: column; gap: 3px; z-index: 2;
    }
    .tip.flip { transform: translateX(calc(-100% - 12px)); }
    .row { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
    .row .name { flex: 1; }
    .row strong { font-variant-numeric: tabular-nums; margin-left: 10px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  `
})
export class CompareChartComponent {
  readonly lines = input.required<CompareLine[]>();
  readonly axis = input.required<string[]>();
  protected readonly hover = signal<number | null>(null);
  protected readonly W = W;
  protected readonly H = H;
  protected readonly PAD = PAD;
  protected readonly pct = (v: number) => formatSignedPercent(v, 1);
  protected readonly day = formatDay;

  protected readonly geo = computed(() => {
    const n = this.axis().length;
    const vals = this.lines().flatMap((l) => l.values).map((v) => v - 1);
    const [lo, hi] = niceRange(Math.min(0, ...vals), Math.max(0, ...vals));
    const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * (W - PAD.left - PAD.right) : 0);
    const y = (g: number) => PAD.top + (1 - (g - 1 - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
    // Long periods: one point every few days is enough for the drawing (hover still has every day).
    const step = Math.max(1, Math.floor(n / 600));
    const path = (v: number[]) => {
      let d = '';
      for (let i = 0; i < n; i += step) d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v[i]).toFixed(1)}`;
      if ((n - 1) % step) d += `L${x(n - 1).toFixed(1)},${y(v[n - 1]).toFixed(1)}`;
      return d;
    };
    const ticks = Array.from({ length: 5 }, (_, k) => lo + (k / 4) * (hi - lo)).map((v) => ({
      y: y(v + 1), label: `${(v * 100).toLocaleString('es-ES', { maximumFractionDigits: Math.abs(hi - lo) < 0.1 ? 1 : 0 })} %`, zero: Math.abs(v) < 1e-9,
    }));
    if (lo < 0 && hi > 0 && !ticks.some((t) => t.zero)) ticks.push({ y: y(1), label: '0 %', zero: true });
    return { lines: this.lines().map((l) => ({ ...l, d: path(l.values) })), x, y, ticks, xs: xLabels(this.axis(), x) };
  });

  protected readonly tipRows = computed(() => {
    const i = this.hover();
    if (i === null) return [];
    return this.lines().map((l) => ({ id: l.id, label: l.label, color: l.color, value: l.values[i] - 1 })).sort((a, b) => b.value - a.value);
  });

  protected onMove(e: MouseEvent): void {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const n = this.axis().length;
    const i = Math.round(((px - PAD.left) / (W - PAD.left - PAD.right)) * (n - 1));
    this.hover.set(n ? Math.max(0, Math.min(n - 1, i)) : null);
  }
}

function niceRange(lo: number, hi: number): [number, number] {
  const span = hi - lo || 0.01;
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const stepSize = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
  return [Math.floor(lo / stepSize) * stepSize, Math.ceil(hi / stepSize) * stepSize];
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** About 6 labels: month names, with the year on January (or on every one for long periods). */
function xLabels(axis: string[], x: (i: number) => number): Array<{ x: number; label: string }> {
  const n = axis.length;
  if (n < 2) return [];
  const months = axis.map((d, i) => ({ i, d })).filter(({ d }, i) => i > 0 && d.slice(8) === '01');
  if (months.length < 2) {
    return [0, Math.floor(n / 2), n - 1].map((i) => ({ x: x(i), label: `${Number(axis[i].slice(8))} ${MONTHS[Number(axis[i].slice(5, 7)) - 1]}` }));
  }
  const every = Math.max(1, Math.ceil(months.length / 6));
  const long = months.length > 18;
  return months.filter((_, k) => k % every === 0).map(({ i, d }) => {
    const m = Number(d.slice(5, 7));
    const label = long ? (m === 1 ? d.slice(0, 4) : `${MONTHS[m - 1]} ${d.slice(2, 4)}`) : m === 1 ? `${MONTHS[0]} ${d.slice(2, 4)}` : MONTHS[m - 1];
    return { x: x(i), label };
  });
}
