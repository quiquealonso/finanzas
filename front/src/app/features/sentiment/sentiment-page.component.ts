import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { formatDay } from '../../shared/format.utils';
import { ListView, ViewToggleComponent } from '../../shared/view-toggle.component';
import { API_ORIGIN } from '../../core/api-origin';

const BASE = `${API_ORIGIN}/api/v2/sentiment`;
const FUND_KEY = 'sentiment.fund';

type Overview = {
  fund: string;
  funds: Array<{ id: string; label: string; benchmark: string }>;
  gauge: number | null;
  parts: Partial<Record<'vix' | 'fng' | 'trend' | 'breadth' | 'social' | 'funding', number | null>>;
  raw: { vix?: number | null; fng?: number | null; trend?: number | null; breadth?: number | null; social?: number | null; funding?: number | null; marketTone?: number | null; marketTonePosts?: number };
  asOf: string | null;
  history: Array<{ day: string; gauge: number }>;
  counts: { companies: number; posts: number; pending: number; mentions: number; sources: number };
  classifier: string;
  job: { running: boolean; startedAt: string | null; finishedAt: string | null; step: string };
};
type Stock = {
  symbol: string; name: string; sector: string | null; score: number | null; mentions: number; bull: number; bear: number;
  lastAt: string | null; last: number | null; ret1m: number | null; vsSma50: number | null; vsSma200: number | null;
};
type Mention = {
  stance: number; confidence: number; reason: string | null; ret1: number | null; ret7: number | null; ret30: number | null;
  excess7: number | null; hit7: boolean | null; text: string; url: string | null; postedAt: string; source: string; platform: string; curated: boolean;
};
type Detail = { symbol: string; name: string; sector: string | null; mentions: Mention[]; prices: Array<{ day: string; close: number }> };
type FeedPost = { id: string; text: string; url: string | null; postedAt: string; marketStance: number | null; source: string; platform: string; mentions: Array<{ symbol: string; stance: number; reason: string }> };
type Source = { id: string; name: string; platform: string; curated: boolean; posts: number; calls: number; evaluated: number; hits: number; avgExcess: number | null; weight: number };
type JobEvent = { at: string; text: string; level: 'info' | 'ok' | 'warn' };
type Sort = 'bull' | 'bear' | 'mentions' | 'momentum' | 'symbol';

/** Score of the last 7 days (-1..1) as a word. Never a buy or sell call. */
export function tone(score: number | null, mentions: number): { label: string; cls: string } {
  if (score == null || mentions < 2) return { label: 'Pocos datos', cls: 'none' };
  if (score >= 0.5) return { label: 'Muy alcista', cls: 'up2' };
  if (score >= 0.15) return { label: 'Alcista', cls: 'up1' };
  if (score <= -0.5) return { label: 'Muy bajista', cls: 'down2' };
  if (score <= -0.15) return { label: 'Bajista', cls: 'down1' };
  return { label: 'Neutral', cls: 'flat' };
}

/** Gauge 0..100 as a word. */
function mood(v: number | null): { label: string; cls: string } {
  if (v == null) return { label: 'Sin datos', cls: 'none' };
  if (v < 25) return { label: 'Miedo extremo', cls: 'down2' };
  if (v < 45) return { label: 'Miedo', cls: 'down1' };
  if (v <= 55) return { label: 'Neutral', cls: 'flat' };
  if (v <= 75) return { label: 'Codicia', cls: 'up1' };
  return { label: 'Codicia extrema', cls: 'up2' };
}

/**
 * "Sentimiento de mercado": a fear/greed gauge of the chosen index, the tone of influencers and news about each
 * of its companies, and how right each source was afterwards. Educational analysis, never investment advice.
 * The data comes from back/src/sentiment.ts (job every 30 minutes and the "Actualizar" button).
 */
@Component({
  selector: 'app-sentiment-page',
  standalone: true,
  imports: [FormsModule, ViewToggleComponent],
  templateUrl: './sentiment-page.component.html',
  styleUrl: './sentiment-page.component.css'
})
export class SentimentPageComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  protected readonly day = formatDay;
  protected readonly tone = tone;
  protected readonly mood = mood;

  protected readonly fund = signal<string>(readFund());
  protected readonly overview = signal<Overview | null>(null);
  protected readonly stocks = signal<Stock[]>([]);
  protected readonly feed = signal<FeedPost[]>([]);
  protected readonly sources = signal<Source[]>([]);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly events = signal<JobEvent[]>([]);
  protected readonly running = signal(false);
  protected readonly showHow = signal(false);
  protected readonly showLog = signal(false);

  protected readonly search = signal('');
  protected readonly sector = signal('');
  protected readonly sort = signal<Sort>('mentions');
  protected readonly onlyWithData = signal(true);
  protected readonly view = signal<ListView>('cards');
  protected readonly tab = signal<'feed' | 'sources'>('feed');

  private poll: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.load();
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
  }

  protected async load(): Promise<void> {
    const fund = this.fund();
    try {
      const [o, s, f, src] = await Promise.all([
        firstValueFrom(this.http.get<Overview>(`${BASE}/overview`, { params: { fund } })),
        firstValueFrom(this.http.get<{ rows: Stock[] }>(`${BASE}/stocks`, { params: { fund } })),
        firstValueFrom(this.http.get<{ posts: FeedPost[] }>(`${BASE}/feed`)),
        firstValueFrom(this.http.get<{ sources: Source[] }>(`${BASE}/sources`))
      ]);
      this.overview.set(o);
      this.stocks.set(s.rows);
      this.feed.set(f.posts);
      this.sources.set(src.sources);
      this.error.set(null);
      if (o.job.running && !this.poll) this.watchJob();
    } catch {
      this.error.set('No se ha podido cargar el sentimiento de mercado. ¿Está el backend arrancado?');
    }
  }

  protected pickFund(fund: string): void {
    this.fund.set(fund);
    this.sector.set('');
    this.detail.set(null);
    try {
      localStorage.setItem(FUND_KEY, fund);
    } catch {
      /* blocked storage: the choice lasts this visit */
    }
    void this.load();
  }

  protected async refresh(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${BASE}/refresh`, {}, { params: { fund: this.fund() } }));
      this.events.set([]);
      this.showLog.set(true);
      this.watchJob();
    } catch {
      this.error.set('No se ha podido lanzar la actualización.');
    }
  }

  /** Follows the job until it ends, then reloads everything. */
  private watchJob(): void {
    this.running.set(true);
    if (this.poll) clearInterval(this.poll);
    this.poll = setInterval(async () => {
      try {
        const j = await firstValueFrom(this.http.get<{ running: boolean; events: JobEvent[] }>(`${BASE}/job`));
        this.events.set(j.events);
        if (!j.running) {
          clearInterval(this.poll!);
          this.poll = null;
          this.running.set(false);
          await this.load();
        }
      } catch {
        /* backend restarting: try again on the next tick */
      }
    }, 2000);
  }

  protected async open(symbol: string): Promise<void> {
    if (this.detail()?.symbol === symbol) {
      this.detail.set(null);
      return;
    }
    try {
      this.detail.set(await firstValueFrom(this.http.get<Detail>(`${BASE}/stock/${encodeURIComponent(symbol)}`)));
      setTimeout(() => document.getElementById('sentiment-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    } catch {
      this.error.set(`No se ha podido abrir ${symbol}.`);
    }
  }

  protected readonly fundLabel = computed(() => this.overview()?.funds.find((f) => f.id === this.fund())?.label ?? '');

  protected readonly sectors = computed(() => [...new Set(this.stocks().map((s) => s.sector ?? 'Otros'))].sort());

  protected readonly rows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const sector = this.sector();
    const rows = this.stocks().filter((s) =>
      (!term || s.symbol.toLowerCase().includes(term) || s.name.toLowerCase().includes(term)) &&
      (!sector || (s.sector ?? 'Otros') === sector) &&
      (!this.onlyWithData() || s.mentions > 0)
    );
    const by: Record<Sort, (a: Stock, b: Stock) => number> = {
      bull: (a, b) => (b.mentions >= 2 ? b.score ?? -2 : -2) - (a.mentions >= 2 ? a.score ?? -2 : -2) || b.mentions - a.mentions,
      bear: (a, b) => (a.mentions >= 2 ? a.score ?? 2 : 2) - (b.mentions >= 2 ? b.score ?? 2 : 2) || b.mentions - a.mentions,
      mentions: (a, b) => b.mentions - a.mentions || a.symbol.localeCompare(b.symbol),
      momentum: (a, b) => (b.ret1m ?? -9) - (a.ret1m ?? -9),
      symbol: (a, b) => a.symbol.localeCompare(b.symbol)
    };
    return [...rows].sort(by[this.sort()]);
  });

  protected readonly withData = computed(() => this.stocks().filter((s) => s.mentions > 0).length);

  /** Companies with most bullish / bearish tone (at least 3 mentions). */
  protected readonly extremes = computed(() => {
    const list = this.stocks().filter((s) => s.score != null && s.mentions >= 3);
    const up = [...list].sort((a, b) => b.score! - a.score!).slice(0, 5).filter((s) => s.score! > 0.15);
    const down = [...list].sort((a, b) => a.score! - b.score!).slice(0, 5).filter((s) => s.score! < -0.15);
    return { up, down };
  });

  /** Gauge components in display order, with the raw reading. */
  protected readonly parts = computed(() => {
    const o = this.overview();
    if (!o) return [];
    const r = o.raw;
    const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d).replace('.', ',')} %`);
    return [
      { key: 'vix', label: 'Volatilidad (VIX)', raw: r.vix == null ? '—' : r.vix.toFixed(1).replace('.', ','), help: 'Miedo en la bolsa de EE. UU.: VIX alto = miedo.' },
      { key: 'breadth', label: 'Amplitud', raw: r.breadth == null ? '—' : `${r.breadth.toFixed(0)} % sobre su media de 200 días`, help: 'Cuántas empresas del índice están en tendencia alcista.' },
      { key: 'trend', label: 'Tendencia del índice', raw: r.trend == null ? '—' : `${pct(r.trend - 1)} vs. media de 200 días`, help: 'El índice por encima de su media larga = mercado fuerte.' },
      { key: 'social', label: 'Tono en redes y noticias', raw: r.social == null ? '—' : `${r.social >= 0 ? '+' : ''}${r.social.toFixed(2).replace('.', ',')} (−1 a +1)`, help: 'Media del tono de los últimos 3 días sobre empresas del índice.' },
      { key: 'fng', label: 'Fear & Greed cripto', raw: r.fng == null ? '—' : `${r.fng.toFixed(0)} / 100`, help: 'Índice público de alternative.me (euforia o pánico en cripto).' },
      { key: 'funding', label: 'Funding BTC (Hyperliquid)', raw: pct(r.funding), help: 'Lo que pagan los apalancados al alza al año: alto = euforia.' }
    ].map((p) => ({ ...p, value: (o.parts as Record<string, number | null | undefined>)[p.key] ?? null }));
  });

  /** Half-circle gauge: needle angle for the value (0 = left, 100 = right). */
  protected needle(v: number | null): { x: number; y: number } {
    const a = Math.PI * (1 - (v ?? 50) / 100);
    return { x: 100 + 72 * Math.cos(a), y: 100 - 72 * Math.sin(a) };
  }

  /** History line of the gauge (viewBox 600x120). */
  protected readonly historyPath = computed(() => {
    const h = this.overview()?.history ?? [];
    if (h.length < 2) return null;
    const pts = h.map((p, i) => `${((i / (h.length - 1)) * 600).toFixed(1)},${(120 - (p.gauge / 100) * 120).toFixed(1)}`);
    return { line: `M${pts.join('L')}`, first: h[0].day, last: h[h.length - 1].day };
  });

  /** Price line of the open company (viewBox 600x100). */
  protected readonly pricePath = computed(() => {
    const p = this.detail()?.prices ?? [];
    if (p.length < 2) return null;
    const min = Math.min(...p.map((x) => x.close));
    const max = Math.max(...p.map((x) => x.close));
    const span = max - min || 1;
    const pts = p.map((x, i) => `${((i / (p.length - 1)) * 600).toFixed(1)},${(95 - ((x.close - min) / span) * 90).toFixed(1)}`);
    return { line: `M${pts.join('L')}`, first: p[0].day, last: p[p.length - 1].day, min, max };
  });

  /** Hits of the open company's evaluated mentions. */
  protected readonly detailRecord = computed(() => {
    const m = this.detail()?.mentions.filter((x) => x.hit7 != null) ?? [];
    return { n: m.length, hits: m.filter((x) => x.hit7).length };
  });

  protected stanceLabel(s: number | null): string {
    return s == null ? '' : s > 0 ? 'Alcista' : s < 0 ? 'Bajista' : 'Neutral';
  }

  protected stanceCls(s: number | null): string {
    return s == null ? 'none' : s > 0 ? 'up1' : s < 0 ? 'down1' : 'flat';
  }

  /** Color of a heatmap tile: green for bullish, red for bearish, stronger with the score. */
  protected tileBg(s: Stock): string {
    if (s.score == null || s.mentions < 2 || Math.abs(s.score) < 0.1) return 'var(--surface-2)';
    const alpha = Math.min(0.85, 0.1 + Math.abs(s.score) * 0.75);
    return s.score >= 0 ? `rgba(34, 160, 90, ${alpha})` : `rgba(220, 80, 50, ${alpha})`;
  }

  /** Social tone and price trend together, in words. */
  protected combined(s: Stock): string {
    if (s.score == null || s.mentions < 2 || s.vsSma50 == null) return '';
    const social = s.score >= 0.15 ? 1 : s.score <= -0.15 ? -1 : 0;
    const price = s.vsSma50 > 0.02 ? 1 : s.vsSma50 < -0.02 ? -1 : 0;
    if (social === 1 && price === 1) return 'Redes y precio alcistas';
    if (social === -1 && price === -1) return 'Redes y precio bajistas';
    if (social === 1 && price === -1) return 'Redes optimistas, precio débil';
    if (social === -1 && price === 1) return 'Redes pesimistas, precio fuerte';
    return social === 0 ? 'Redes neutrales' : social > 0 ? 'Redes alcistas' : 'Redes bajistas';
  }

  protected pct(v: number | null, d = 1): string {
    if (v == null) return '—';
    return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d).replace('.', ',')} %`;
  }

  protected ago(iso: string): string {
    const h = (Date.now() - Date.parse(iso)) / 3_600_000;
    if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 24) return `hace ${Math.round(h)} h`;
    return `hace ${Math.round(h / 24)} d`;
  }

  protected platformLabel(p: string): string {
    return p === 'bluesky' ? 'Bluesky' : p === 'youtube' ? 'YouTube' : 'Noticias';
  }
}

function readFund(): string {
  try {
    return localStorage.getItem(FUND_KEY) || 'sp500';
  } catch {
    return 'sp500';
  }
}
