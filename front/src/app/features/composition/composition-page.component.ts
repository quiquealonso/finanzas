import { Component, computed, effect, inject, signal } from '@angular/core';
import { PortfolioApi } from '../../core/portfolio-api.service';
import { AllocationTarget, TYPE_COLORS } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatMoney0 } from '../../shared/format.utils';
import { sharePct, SunburstComponent, SunChild, SunGroup } from '../../shared/sunburst.component';

type View = 'real' | 'target';

/** One product of the plan: an asset (held or not) or a free name for one not bought yet. */
type PlanProduct = { key: string; assetId: string | null; name: string; pct: number };
type PlanType = { typeCode: string; name: string; color: string; pct: number; products: PlanProduct[] };

/** Colours to tell apart the products of one type. */
const PRODUCT_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#f97316', '#a855f7', '#0ea5e9', '#eab308', '#22c55e', '#e11d48'];

/** How a metal is held: an ETF/ETC or the physical metal. Only set inside the metals type. */
type Via = 'ETF' | 'Físico';
type Child = SunChild & { via?: Via };
type Group = Omit<SunGroup, 'children'> & { children: Child[] };

/** ETFs that track a metal (gold, silver, copper…): for the composition they count as metals, not as ETFs. */
const METAL_ETF = /\b(oro|plata|cobre|platino|paladio|gold|silver|copper|platinum|palladium|metal)/i;
const groupCode = (a: { typeCode: string; name: string }) => (a.typeCode === 'ETF' && METAL_ETF.test(a.name) ? 'METAL' : a.typeCode);

/** Below this a difference isn't worth a buy or a sale: 100 € or 0.15 % of the portfolio (one-decimal % rounding). */
const minMove = (total: number) => Math.max(100, total * 0.0015);

@Component({
  selector: 'app-composition-page',
  standalone: true,
  imports: [SunburstComponent],
  templateUrl: './composition-page.component.html',
  styleUrl: './composition-page.component.css'
})
export class CompositionPageComponent {
  private readonly api = inject(PortfolioApi);
  protected readonly store = inject(PortfolioStore);
  protected readonly money = formatMoney0;

  protected readonly view = signal<View>('real');
  protected readonly selected = signal<string | null>(null);

  // ---- Real portfolio ----

  private readonly held = computed(() => this.store.assets().filter((a) => a.valueEur > 0));
  protected readonly total = computed(() => this.held().reduce((s, a) => s + a.valueEur, 0));

  /** Types (biggest first) with their products (biggest first). Metal ETFs go with the metals, tagged ETF or Físico. */
  protected readonly real = computed<Group[]>(() =>
    this.store
      .types()
      .map((t) => {
        const children: Child[] = this.held()
          .filter((a) => groupCode(a) === t.code)
          .map((a) => ({ key: a.id, name: a.name, value: a.valueEur, via: t.code === 'METAL' ? ((a.typeCode === 'METAL' ? 'Físico' : 'ETF') as Via) : undefined }))
          .sort((a, b) => b.value - a.value);
        return { key: t.code, name: t.name, color: TYPE_COLORS[t.code] ?? '#888', value: children.reduce((s, c) => s + c.value, 0), children };
      })
      .filter((g) => g.value > 0)
      .sort((a, b) => b.value - a.value)
  );

  /**
   * For display: the same product bought in different banks (same name) shows as one.
   * The target plan keeps working per asset with real().
   */
  protected readonly display = computed<Group[]>(() =>
    this.real().map((g) => {
      const byName = new Map<string, Child>();
      for (const c of g.children) {
        const id = c.name.trim().toLowerCase() + '|' + (c.via ?? '');
        const prev = byName.get(id);
        byName.set(id, prev ? { ...prev, value: prev.value + c.value } : { ...c });
      }
      return { ...g, children: [...byName.values()].sort((a, b) => b.value - a.value) };
    })
  );

  /** For the rings only: products under 0.4 % of the portfolio join one "Otros" slice, so the ring stays readable. */
  protected readonly realChart = computed<Group[]>(() => {
    const total = this.total();
    return this.display().map((g) => {
      const small = g.children.filter((c) => c.value / total < 0.004);
      if (small.length < 2) return g;
      const rest = small.reduce((s, c) => s + c.value, 0);
      return { ...g, children: [...g.children.filter((c) => !small.includes(c)), { key: 'otros', name: `Otros (${small.length})`, value: rest }] };
    });
  });

  /** Products of the selected type, each in its own colour, for its one-ring chart and the list below it. */
  protected readonly selectedProducts = computed(() => {
    const g = this.display().find((x) => x.key === this.selected());
    if (!g) return null;
    const items = g.children.map((c, i) => ({ ...c, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length] }));
    const chart: SunGroup[] = items.map((c) => ({ key: c.key, name: c.name, color: c.color, value: c.value, children: [] }));
    return { items, chart };
  });

  protected readonly hoverProduct = signal<string | null>(null);

  protected readonly selectedGroup = computed(() => this.display().find((g) => g.key === this.selected()) ?? null);

  /** For a group that mixes ETFs and physical metal: the € in each, so both read apart while the type shows the total. */
  protected viaSplit(g: Group): Array<{ via: Via; value: number }> {
    const out = (['Físico', 'ETF'] as Via[]).map((via) => ({ via, value: g.children.filter((c) => c.via === via).reduce((s, c) => s + c.value, 0) }));
    return out.filter((x) => x.value > 0).length > 1 ? out : [];
  }

  // ---- Target allocation ----

  protected readonly plan = signal<PlanType[]>([]);
  protected readonly open = signal<string | null>(null);
  protected readonly dirty = signal(false);
  protected readonly saving = signal(false);
  private readonly saved = signal<AllocationTarget[] | null>(null);

  constructor() {
    void this.loadTargets();
    // Build the editable plan once both the portfolio and the saved targets are in.
    effect(() => {
      const saved = this.saved();
      if (saved && this.store.overview() && !this.plan().length) this.plan.set(this.buildPlan(saved));
    });
  }

  private async loadTargets(): Promise<void> {
    try {
      this.saved.set(await this.api.allocationTargets());
    } catch (error) {
      this.store.error(error, 'No se pudo cargar la cartera objetivo.');
      this.saved.set([]);
    }
  }

  /** Saved targets on top of the current portfolio; with nothing saved, the plan starts as the portfolio is today. */
  private buildPlan(saved: AllocationTarget[]): PlanType[] {
    const total = this.total();
    const assets = this.store.assets();
    return this.store.types().map((t) => {
      const typeRow = saved.find((r) => r.typeCode === t.code && !r.assetId && !r.name);
      const group = this.real().find((g) => g.key === t.code);
      const products: PlanProduct[] = (group?.children ?? []).map((c) => {
        const row = saved.find((r) => r.assetId === c.key);
        return { key: c.key, assetId: c.key, name: c.name, pct: row ? row.pct : saved.length ? 0 : round1((c.value / (group?.value || 1)) * 100) };
      });
      for (const r of saved.filter((r) => r.typeCode === t.code && (r.assetId || r.name))) {
        if (r.assetId && products.some((p) => p.assetId === r.assetId)) continue;
        const name = r.assetId ? assets.find((a) => a.id === r.assetId)?.name ?? 'Producto' : r.name!;
        products.push({ key: r.assetId ?? `new:${name}`, assetId: r.assetId, name, pct: r.pct });
      }
      const pct = typeRow ? typeRow.pct : saved.length ? 0 : round1(((group?.value ?? 0) / (total || 1)) * 100);
      return { typeCode: t.code, name: t.name, color: TYPE_COLORS[t.code] ?? '#888', pct, products };
    });
  }

  protected copyCurrent(): void {
    this.plan.set(this.buildPlan([]));
    this.dirty.set(true);
  }

  protected setTypePct(code: string, value: string): void {
    this.plan.update((plan) => plan.map((t) => (t.typeCode === code ? { ...t, pct: clampPct(value) } : t)));
    this.dirty.set(true);
  }

  protected setProductPct(code: string, key: string, value: string): void {
    this.plan.update((plan) =>
      plan.map((t) => (t.typeCode === code ? { ...t, products: t.products.map((p) => (p.key === key ? { ...p, pct: clampPct(value) } : p)) } : t))
    );
    this.dirty.set(true);
  }

  protected addProduct(code: string, input: HTMLInputElement): void {
    const name = input.value.trim();
    if (!name) return;
    this.plan.update((plan) =>
      plan.map((t) => (t.typeCode === code ? { ...t, products: [...t.products, { key: `new:${name}:${Date.now()}`, assetId: null, name, pct: 0 }] } : t))
    );
    input.value = '';
    this.dirty.set(true);
  }

  protected removeProduct(code: string, key: string): void {
    this.plan.update((plan) => plan.map((t) => (t.typeCode === code ? { ...t, products: t.products.filter((p) => p.key !== key) } : t)));
    this.dirty.set(true);
  }

  /** Spreads what's missing (or over) to reach 100 % proportionally among the rows. */
  protected balanceTypes(): void {
    this.plan.update((plan) => scaleTo100(plan));
    this.dirty.set(true);
  }

  protected balanceProducts(code: string): void {
    this.plan.update((plan) => plan.map((t) => (t.typeCode === code ? { ...t, products: scaleTo100(t.products) } : t)));
    this.dirty.set(true);
  }

  protected readonly typesSum = computed(() => round1(this.plan().reduce((s, t) => s + t.pct, 0)));

  protected productsSum(t: PlanType): number {
    return round1(t.products.reduce((s, p) => s + p.pct, 0));
  }

  /** Each row of the plan against today: shares of the whole portfolio and euros to move. */
  protected readonly comparison = computed(() => {
    const total = this.total();
    return this.plan().map((t) => {
      const group = this.real().find((g) => g.key === t.typeCode);
      const realEur = group?.value ?? 0;
      const targetEur = (total * t.pct) / 100;
      const productsSum = t.products.reduce((s, p) => s + p.pct, 0);
      const products = t.products.map((p) => {
        const pReal = group?.children.find((c) => c.key === p.assetId)?.value ?? 0;
        // Inside the type the product shares are scaled to 100 %, so a half-filled type still adds up.
        const pTarget = productsSum > 0 ? (targetEur * p.pct) / productsSum : 0;
        return { product: p, realPct: total ? pReal / total : 0, targetPct: total ? pTarget / total : 0, move: pTarget - pReal };
      });
      return { type: t, realPct: total ? realEur / total : 0, targetPct: t.pct / 100, move: targetEur - realEur, products };
    });
  });

  /** Buys and sales to go from today to the plan, product by product (biggest first). */
  protected readonly moves = computed(() => {
    const out: Array<{ name: string; typeName: string; color: string; eur: number }> = [];
    const min = this.minMove();
    for (const row of this.comparison()) {
      if (row.products.length) {
        for (const p of row.products) if (Math.abs(p.move) >= min) out.push({ name: p.product.name, typeName: row.type.name, color: row.type.color, eur: p.move });
      } else if (Math.abs(row.move) >= min) {
        out.push({ name: row.type.name, typeName: row.type.name, color: row.type.color, eur: row.move });
      }
    }
    return out.sort((a, b) => Math.abs(b.eur) - Math.abs(a.eur));
  });

  protected readonly minMove = computed(() => minMove(this.total()));

  /** The plan drawn with the same two rings. */
  protected readonly targetChart = computed<SunGroup[]>(() =>
    this.comparison()
      .filter((r) => r.targetPct > 0)
      .map((r) => ({
        key: r.type.typeCode,
        name: r.type.name,
        color: r.type.color,
        value: r.targetPct,
        children: r.products.filter((p) => p.targetPct > 0).map((p) => ({ key: p.product.key, name: p.product.name, value: p.targetPct })).sort((a, b) => b.value - a.value)
      }))
      .sort((a, b) => b.value - a.value)
  );

  protected async save(): Promise<void> {
    const rows: AllocationTarget[] = [];
    for (const t of this.plan()) {
      rows.push({ typeCode: t.typeCode, assetId: null, name: null, pct: t.pct });
      for (const p of t.products) rows.push({ typeCode: t.typeCode, assetId: p.assetId, name: p.assetId ? null : p.name, pct: p.pct });
    }
    this.saving.set(true);
    try {
      await this.api.saveAllocationTargets(rows);
      this.dirty.set(false);
      this.store.toast('ok', 'Cartera objetivo guardada');
    } catch (error) {
      this.store.error(error, 'No se pudo guardar.');
    } finally {
      this.saving.set(false);
    }
  }

  protected pct(share: number): string {
    return sharePct(share);
  }

  protected signedPoints(diff: number): string {
    const pts = round1(diff * 100);
    return `${pts > 0 ? '+' : pts < 0 ? '−' : ''}${Math.abs(pts).toLocaleString('es-ES')} pp`;
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function clampPct(raw: string): number {
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
}

function scaleTo100<T extends { pct: number }>(rows: T[]): T[] {
  const sum = rows.reduce((s, r) => s + r.pct, 0);
  if (sum <= 0) return rows;
  const scaled = rows.map((r) => ({ ...r, pct: round1((r.pct / sum) * 100) }));
  // Rounding leftovers go to the biggest row so the total is exactly 100.
  const diff = round1(100 - scaled.reduce((s, r) => s + r.pct, 0));
  const biggest = scaled.reduce((best, r, i) => (r.pct > scaled[best].pct ? i : best), 0);
  scaled[biggest] = { ...scaled[biggest], pct: round1(scaled[biggest].pct + diff) };
  return scaled;
}
