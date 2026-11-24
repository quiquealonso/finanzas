import { Component, computed, input, signal } from '@angular/core';
import { formatMoney0 } from './format.utils';

/** One slice. `extra` is an optional small figure next to the value (e.g. the gain of a bank), with its CSS class. */
export type DonutSegment = { key: string; label: string; value: number; color: string; extra?: string; extraClass?: string };

const R = 70;
const STROKE = 28;
const C = 2 * Math.PI * R;

/**
 * Donut with a compact legend, half and half: the chart is the main thing. Hovering a slice or a legend row
 * highlights it and shows it in the center. Used by Distribución and Resumen.
 */
@Component({
  selector: 'app-donut-chart',
  standalone: true,
  template: `
    <div class="donut">
      <div class="chart">
        <svg viewBox="0 0 180 180" role="img" [attr.aria-label]="title()">
          <circle cx="90" cy="90" [attr.r]="R" class="track" [attr.stroke-width]="STROKE" />
          @for (s of arcs(); track s.key) {
            <circle cx="90" cy="90" [attr.r]="R" fill="none"
                    [attr.stroke]="s.color" [attr.stroke-width]="hover() === s.key ? STROKE + 8 : STROKE"
                    [attr.stroke-dasharray]="s.dash" [attr.stroke-dashoffset]="s.offset"
                    [class.dim]="hover() && hover() !== s.key"
                    transform="rotate(-90 90 90)"
                    (mouseenter)="hover.set(s.key)" (mouseleave)="hover.set(null)" />
          }
          <text x="90" y="82" text-anchor="middle" class="c-label">{{ center().label }}</text>
          <text x="90" y="102" text-anchor="middle" class="c-value">{{ center().value }}</text>
          @if (center().sub) { <text x="90" y="118" text-anchor="middle" class="c-sub">{{ center().sub }}</text> }
        </svg>
      </div>
      <ul class="legend">
        @for (s of arcs(); track s.key) {
          <li [class.dim]="hover() && hover() !== s.key" (mouseenter)="hover.set(s.key)" (mouseleave)="hover.set(null)">
            <span class="dot" [style.background]="s.color"></span>
            <span class="name" [title]="s.label">{{ s.label }}</span>
            @if (hasExtra()) { <span class="extra num" [class]="'extra num ' + (s.extraClass ?? '')">{{ s.extra ?? '' }}</span> }
            <span class="val num">{{ money(s.value) }}</span>
            <span class="pct num">{{ (s.pct * 100).toFixed(1) }} %</span>
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    :host { display: block; }
    /* Chart a little narrower than the legend, so the legend fits name, euros and % in one line. */
    .donut { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); gap: 20px; align-items: center; }
    .chart { display: flex; justify-content: center; }
    svg { width: 100%; max-width: 260px; aspect-ratio: 1; height: auto; }
    circle { transition: stroke-width 0.12s, opacity 0.12s; cursor: default; }
    .track { fill: none; stroke: var(--surface-2); }
    .dim { opacity: 0.35; }
    .c-label { font-size: 10.5px; fill: var(--text-2); }
    .c-value { font-size: 17px; font-weight: 600; fill: var(--text); }
    .c-sub { font-size: 10px; fill: var(--text-3); }
    .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; min-width: 0; }
    .legend li {
      display: flex; align-items: center; gap: 10px;
      padding: 6px 0; border-top: 1px solid var(--border); font-size: 13px; line-height: 1.3; transition: opacity 0.12s;
    }
    .legend li:first-child { border-top: 0; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .val { width: 92px; text-align: right; flex: none; }
    .pct { width: 54px; text-align: right; flex: none; font-weight: 600; }
    .extra { width: 84px; text-align: right; flex: none; font-size: 12px; }
    @media (max-width: 560px) { .donut { grid-template-columns: minmax(0, 1fr); } svg { max-width: 200px; } }
  `
})
export class DonutChartComponent {
  readonly segments = input<DonutSegment[]>([]);
  readonly title = input('');
  /** What the middle says when nothing is hovered (default: the total in euros). */
  readonly centerLabel = input('Total');
  readonly centerValue = input<string | null>(null);

  protected readonly R = R;
  protected readonly STROKE = STROKE;
  protected readonly hover = signal<string | null>(null);
  protected readonly money = formatMoney0;

  /** Some slice has an extra figure: the legend gets that column for every row, so they stay aligned. */
  protected readonly hasExtra = computed(() => this.segments().some((s) => s.extra));

  private readonly total = computed(() => this.segments().reduce((s, x) => s + Math.max(0, x.value), 0));

  protected readonly arcs = computed(() => {
    const total = this.total();
    if (total <= 0) return [];
    let acc = 0;
    return this.segments()
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((s) => {
        const pct = s.value / total;
        const len = pct * C;
        // Small gap between slices.
        const arc = { ...s, pct, dash: `${Math.max(0, len - 1.5)} ${C}`, offset: -acc };
        acc += len;
        return arc;
      });
  });

  protected readonly center = computed(() => {
    const key = this.hover();
    const hit = this.arcs().find((a) => a.key === key);
    if (hit) return { label: hit.label.length > 22 ? hit.label.slice(0, 21) + '…' : hit.label, value: `${(hit.pct * 100).toFixed(1)} %`, sub: formatMoney0(hit.value) };
    return { label: this.centerLabel(), value: this.centerValue() ?? formatMoney0(this.total()), sub: '' };
  });
}
