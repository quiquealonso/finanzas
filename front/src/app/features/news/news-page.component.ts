import { Component, computed, inject, signal } from '@angular/core';
import { errorMessage, PortfolioApi } from '../../core/portfolio-api.service';
import { NewsData, NewsItem, NewsTier } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';

type TierFilter = NewsTier | 'all';
type ScopeFilter = 'all' | 'daily' | 'monthly';

export const TIER_LABELS: Record<NewsTier, string> = {
  important: 'Importante',
  minor: 'Sin mucha importancia',
  low: 'Poco relevante'
};

@Component({
  selector: 'app-news-page',
  standalone: true,
  templateUrl: './news-page.component.html',
  styleUrl: './news-page.component.css'
})
export class NewsPageComponent {
  private readonly api = inject(PortfolioApi);
  private readonly store = inject(PortfolioStore);
  protected readonly tierLabels = TIER_LABELS;

  protected readonly data = signal<NewsData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly tier = signal<TierFilter>('all');
  protected readonly scope = signal<ScopeFilter>('all');
  protected readonly asset = signal<string | null>(null);
  protected readonly digestIndex = signal(0);
  /** Low-relevance items show only their title until opened. */
  protected readonly opened = signal<ReadonlySet<string>>(new Set());

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await this.api.news(90));
      this.error.set(null);
    } catch (e) {
      this.error.set(errorMessage(e, 'No se han podido cargar las noticias.'));
    }
  }

  /** Weight in the portfolio of each position, by name (same company in two banks counts once). */
  private readonly weights = computed(() => {
    const assets = this.store.assets().filter((a) => a.valueEur > 0);
    const total = assets.reduce((s, a) => s + a.valueEur, 0);
    const byName = new Map<string, number>();
    for (const a of assets) byName.set(a.name, (byName.get(a.name) ?? 0) + a.valueEur);
    const byId = new Map<string, string>(assets.map((a) => [a.id, a.name]));
    return { total, byName, byId };
  });

  protected weightOf(item: NewsItem): number | null {
    const w = this.weights();
    if (!w.total) return null;
    const name = (item.assetId && w.byId.get(item.assetId)) || item.assetName;
    const value = name ? w.byName.get(name) : undefined;
    return value ? value / w.total : null;
  }

  private readonly scoped = computed(() => {
    const items = this.data()?.items ?? [];
    const scope = this.scope();
    return scope === 'all' ? items : items.filter((i) => i.scope === scope);
  });

  protected readonly counts = computed(() => {
    const items = this.scoped().filter((i) => !this.asset() || i.assetName === this.asset());
    return {
      all: items.length,
      important: items.filter((i) => i.tier === 'important').length,
      minor: items.filter((i) => i.tier === 'minor').length,
      low: items.filter((i) => i.tier === 'low').length
    };
  });

  /** Positions with news, heaviest first, to filter by one of them. */
  protected readonly assetChips = computed(() => {
    const map = new Map<string, { name: string; count: number; important: number; weight: number }>();
    for (const i of this.scoped()) {
      if (!i.assetName) continue;
      const cur = map.get(i.assetName) ?? { name: i.assetName, count: 0, important: 0, weight: this.weightOf(i) ?? 0 };
      cur.count++;
      if (i.tier === 'important') cur.important++;
      map.set(i.assetName, cur);
    }
    return [...map.values()].sort((a, b) => b.weight - a.weight);
  });

  protected readonly days = computed(() => {
    const tier = this.tier();
    const asset = this.asset();
    const items = this.scoped().filter((i) => (tier === 'all' || i.tier === tier) && (!asset || i.assetName === asset));
    const groups: Array<{ day: string; items: NewsItem[] }> = [];
    for (const i of items) {
      const last = groups[groups.length - 1];
      if (last?.day === i.publishedAt) last.items.push(i);
      else groups.push({ day: i.publishedAt, items: [i] });
    }
    return groups;
  });

  protected readonly digest = computed(() => this.data()?.digests[this.digestIndex()] ?? null);
  protected readonly digestCount = computed(() => this.data()?.digests.length ?? 0);
  protected readonly paragraphs = computed(() =>
    (this.digest()?.body ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  );

  protected toggle(id: string): void {
    const next = new Set(this.opened());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.opened.set(next);
  }

  protected pickAsset(name: string): void {
    this.asset.set(this.asset() === name ? null : name);
  }

  protected pct(v: number): string {
    return (v * 100).toLocaleString('es-ES', { maximumFractionDigits: v < 0.1 ? 2 : 1 }) + ' %';
  }

  protected dayLabel(day: string): string {
    const d = new Date(`${day}T12:00:00`);
    const label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  protected weekLabel(monday: string): string {
    const start = new Date(`${monday}T12:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const f = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    return `Semana del ${f(start)} al ${f(end)}`;
  }
}
