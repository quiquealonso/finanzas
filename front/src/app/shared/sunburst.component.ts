import { Component, computed, input, output, signal } from '@angular/core';

export type SunChild = { key: string; name: string; value: number };
export type SunGroup = { key: string; name: string; color: string; value: number; children: SunChild[] };

type Arc = { key: string; group: string; name: string; d: string; color: string; opacity: number; share: number };

const SIZE = 320;
const C = SIZE / 2;
const RINGS = { inner: [62, 104], outer: [108, 156] } as const;
/** One ring only (no products ring): thicker. */
const SINGLE = [72, 156] as const;

/**
 * Two rings: asset types inside, the products of each type outside, both as a share of the whole.
 * Clicking a type selects it (the rest fades); the centre names what is under the pointer.
 */
@Component({
  selector: 'app-sunburst',
  standalone: true,
  template: `
    <svg [attr.viewBox]="'0 0 ' + size + ' ' + size" role="img" [attr.aria-label]="ariaLabel()">
      @for (a of arcs().inner; track a.key) {
        <path [attr.d]="a.d" [style.fill]="a.color" [attr.fill-opacity]="dim(a.group) ? 0.25 : 1"
              class="arc" (mouseenter)="hover.set(a)" (mouseleave)="hover.set(null)" (click)="toggle(a.group)" />
      }
      @for (a of arcs().outer; track a.key) {
        <path [attr.d]="a.d" [style.fill]="a.color" [attr.fill-opacity]="dim(a.group) ? 0.12 : a.opacity"
              class="arc" (mouseenter)="hover.set(a)" (mouseleave)="hover.set(null)" (click)="toggle(a.group)" />
      }
      <text [attr.x]="c" [attr.y]="c - 8" class="c-name">{{ center().name }}</text>
      <text [attr.x]="c" [attr.y]="c + 16" class="c-value">{{ center().value }}</text>
    </svg>
  `,
  styles: `
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; max-width: 360px; margin: 0 auto; }
    .arc { stroke: var(--surface); stroke-width: 1.5; cursor: pointer; transition: fill-opacity 0.15s; }
    .arc:hover { fill-opacity: 1 !important; }
    text { text-anchor: middle; fill: var(--text); }
    .c-name { font-size: 12px; fill: var(--text-2); }
    .c-value { font-size: 20px; font-weight: 600; }
  `
})
export class SunburstComponent {
  readonly groups = input.required<SunGroup[]>();
  readonly selected = input<string | null>(null);
  /** Centre text when nothing is hovered or selected. */
  readonly totalLabel = input('Total');
  readonly totalValue = input('');
  /** Draw only the groups ring (each group its own colour), e.g. the products of one type. */
  readonly single = input(false);
  readonly selectedChange = output<string | null>();

  protected readonly size = SIZE;
  protected readonly c = C;
  protected readonly hover = signal<Arc | null>(null);

  protected readonly arcs = computed(() => {
    const groups = this.groups().filter((g) => g.value > 0);
    const total = groups.reduce((s, g) => s + g.value, 0);
    const inner: Arc[] = [];
    const outer: Arc[] = [];
    if (total <= 0) return { inner, outer };
    let angle = 0;
    for (const g of groups) {
      const span = (g.value / total) * 360;
      inner.push({ key: g.key, group: g.key, name: g.name, d: arc(this.single() ? SINGLE : RINGS.inner, angle, angle + span), color: g.color, opacity: 1, share: g.value / total });
      const kids = this.single() ? [] : g.children.filter((k) => k.value > 0);
      const kidsTotal = kids.reduce((s, k) => s + k.value, 0);
      let a = angle;
      kids.forEach((k, i) => {
        const kSpan = kidsTotal > 0 ? (k.value / kidsTotal) * span : 0;
        outer.push({
          key: `${g.key}/${k.key}`,
          group: g.key,
          name: k.name,
          d: arc(RINGS.outer, a, a + kSpan),
          color: g.color,
          // Biggest product darkest, fading to the smallest.
          opacity: kids.length > 1 ? 0.95 - (i / (kids.length - 1)) * 0.55 : 0.85,
          share: (kidsTotal > 0 ? k.value / kidsTotal : 0) * (g.value / total)
        });
        a += kSpan;
      });
      angle += span;
    }
    return { inner, outer };
  });

  protected readonly center = computed(() => {
    const h = this.hover();
    if (h) return { name: h.name, value: pct(h.share) };
    const sel = this.arcs().inner.find((a) => a.key === this.selected());
    if (sel) return { name: sel.name, value: pct(sel.share) };
    return { name: this.totalLabel(), value: this.totalValue() };
  });

  protected readonly ariaLabel = computed(() =>
    this.arcs().inner.map((a) => `${a.name} ${pct(a.share)}`).join(', ')
  );

  protected dim(group: string): boolean {
    const sel = this.selected();
    return sel !== null && sel !== group;
  }

  protected toggle(group: string): void {
    this.selectedChange.emit(this.selected() === group ? null : group);
  }
}

/** Two decimals under 10 % so small shares don't all read as "1 %". */
export function sharePct(share: number): string {
  const d = share < 0.1 ? 2 : 1;
  return `${(share * 100).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
}

const pct = sharePct;

/** Ring segment between two angles (degrees, 0 = top, clockwise). */
function arc([r0, r1]: readonly [number, number], from: number, to: number): string {
  const end = Math.min(to, from + 359.99);
  const p = (r: number, deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(C + r * Math.cos(rad)).toFixed(2)},${(C + r * Math.sin(rad)).toFixed(2)}`;
  };
  const large = end - from > 180 ? 1 : 0;
  return `M${p(r1, from)}A${r1},${r1} 0 ${large} 1 ${p(r1, end)}L${p(r0, end)}A${r0},${r0} 0 ${large} 0 ${p(r0, from)}Z`;
}
