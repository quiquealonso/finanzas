import { Component, computed, input, signal } from '@angular/core';
import { formatDay, formatMoney0, formatSignedPercent } from './format.utils';

export type ChartPoint = { date: string; value: number; cost?: number; /** Overrides the date in axis and tooltip. */ label?: string };

const W = 1000;

// Lightweight responsive line chart: value line + area, optional dashed cost line, hover readout.
@Component({
  selector: 'app-line-chart',
  standalone: true,
  template: `
    <div class="chart" [style.height.px]="height()">
      @if (geometry(); as g) {
        @for (y of g.grid; track y.y) {
          <span class="ylabel" [style.top.px]="y.y - 8">{{ y.label }}</span>
        }
        <div class="plot" (mousemove)="onMove($event)" (mouseleave)="hover.set(null)">
          <svg [attr.viewBox]="'0 0 ' + W + ' ' + height()" preserveAspectRatio="none">
            @for (y of g.grid; track y.y) {
              <line x1="0" [attr.x2]="W" [attr.y1]="y.y" [attr.y2]="y.y" class="grid" />
            }
            <path [attr.d]="g.area" class="area" />
            @if (g.costPath) {
              <path [attr.d]="g.costPath" class="cost" />
            }
            <path [attr.d]="g.line" class="line" />
            @if (hoverPoint(); as h) {
              <line [attr.x1]="h.x" [attr.x2]="h.x" y1="0" [attr.y2]="height()" class="cursor" />
            }
          </svg>
          <div class="xlabels">
            @for (x of g.xLabels; track x.label) {
              <span [style.left.%]="x.pct">{{ x.label }}</span>
            }
          </div>
          @if (hoverPoint(); as h) {
            <span class="marker" [style.left.%]="h.pct" [style.top.px]="h.y"></span>
            <div class="tip" [style.left.%]="h.pct" [class.flip]="h.pct > 65">
              <div class="faint small">{{ h.day }}</div>
              <div class="num"><strong>{{ h.value }}</strong></div>
              @if (h.cost) { <div class="faint small num">Coste {{ h.cost }} · {{ h.pnl }}</div> }
            </div>
          }
        </div>
      } @else {
        <div class="empty">Sin datos todavia</div>
      }
    </div>
  `,
  styles: `
    .chart { position: relative; width: 100%; margin-bottom: 22px; user-select: none; }
    .plot { position: absolute; left: 52px; right: 0; top: 0; bottom: 0; }
    svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .grid { stroke: var(--border); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .line { fill: none; stroke: var(--accent); stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
    .area { fill: var(--accent); opacity: 0.07; }
    .cost { fill: none; stroke: var(--text-3); stroke-width: 1.25; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
    .cursor { stroke: var(--border-strong); stroke-width: 1; vector-effect: non-scaling-stroke; }
    .ylabel { position: absolute; left: 0; width: 44px; text-align: right; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
    .xlabels { position: absolute; left: 0; right: 0; bottom: -20px; height: 16px; }
    .xlabels span { position: absolute; transform: translateX(-50%); font-size: 11px; color: var(--text-3); white-space: nowrap; }
    .xlabels span:first-child { transform: none; }
    .xlabels span:last-child { transform: translateX(-100%); }
    .marker { position: absolute; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); border: 2px solid var(--surface); transform: translate(-50%, -50%); pointer-events: none; }
    .tip { position: absolute; top: -4px; transform: translateX(12px); background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 6px 9px; box-shadow: 0 6px 18px rgba(0,0,0,0.1); pointer-events: none; white-space: nowrap; z-index: 2; }
    .tip.flip { transform: translateX(calc(-100% - 12px)); }
    .empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--text-3); }
  `
})
export class LineChartComponent {
  readonly points = input<ChartPoint[]>([]);
  readonly height = input(220);
  readonly showCost = input(true);

  protected readonly W = W;
  protected readonly hover = signal<number | null>(null);

  protected readonly geometry = computed(() => {
    const pts = this.points();
    const h = this.height();
    if (pts.length < 2) return null;

    const values = pts.map((p) => p.value);
    const costs = this.showCost() ? pts.map((p) => p.cost ?? NaN).filter((v) => Number.isFinite(v)) : [];
    let min = Math.min(...values, ...costs);
    let max = Math.max(...values, ...costs);
    const pad = (max - min) * 0.08 || max * 0.05 || 1;
    min = Math.max(0, min - pad);
    max = max + pad;

    const x = (i: number) => (i / (pts.length - 1)) * W;
    const y = (v: number) => h - ((v - min) / (max - min)) * h;

    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    const area = `${line}L${W},${h}L0,${h}Z`;
    const costPath = costs.length === pts.length
      ? pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.cost!).toFixed(1)}`).join('')
      : null;

    const grid = [0.15, 0.5, 0.85].map((f) => {
      const v = max - (max - min) * f;
      return { y: h * f, label: compact(v) };
    });

    const labelCount = Math.min(6, pts.length);
    const xLabels = Array.from({ length: labelCount }, (_, k) => {
      const i = Math.round((k / Math.max(1, labelCount - 1)) * (pts.length - 1));
      return { pct: (i / (pts.length - 1)) * 100, label: pts[i].label ?? shortDate(pts[i].date, pts.length) };
    }).filter((l, idx, arr) => arr.findIndex((o) => o.label === l.label) === idx);

    return { line, area, costPath, grid, xLabels, x, y };
  });

  protected readonly hoverPoint = computed(() => {
    const i = this.hover();
    const g = this.geometry();
    const pts = this.points();
    if (i === null || !g || !pts[i]) return null;
    const p = pts[i];
    const pct = (i / (pts.length - 1)) * 100;
    return {
      x: g.x(i),
      y: g.y(p.value),
      pct,
      day: p.label ?? formatDay(p.date),
      value: formatMoney0(p.value),
      cost: p.cost !== undefined && this.showCost() ? formatMoney0(p.cost) : null,
      pnl: p.cost ? formatSignedPercent(p.value / p.cost - 1) : ''
    };
  });

  protected onMove(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const n = this.points().length;
    if (n < 2) return;
    this.hover.set(Math.round(ratio * (n - 1)));
  }
}

function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return `${Math.round(v)}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function shortDate(day: string, span: number): string {
  const [y, m, d] = day.split('-');
  if (span > 120) return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}
