import { Component, computed, effect, inject, signal } from '@angular/core';
import { formatMoney, formatMoney0, formatSignedMoney, formatSignedPercent, signClass } from './format.utils';
import { ChartPoint, LineChartComponent } from './line-chart.component';
import { PortfolioService, Range, SeriesPoint, Summary } from './portfolio.service';

const hour = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' });
const stamp = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

@Component({
  selector: 'app-root',
  imports: [LineChartComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly api = inject(PortfolioService);

  protected readonly ranges: Array<{ id: Range; label: string }> = [
    { id: '1D', label: 'Día' },
    { id: '1S', label: 'Semana' },
    { id: '1M', label: 'Mes' },
    { id: 'YTD', label: 'Año' }
  ];
  protected readonly range = signal<Range>('1D');
  protected readonly summary = signal<Summary | null>(null);
  protected readonly points = signal<SeriesPoint[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly signingIn = signal(false);

  protected readonly fmt = { formatMoney, formatMoney0, formatSignedMoney, formatSignedPercent, signClass };

  constructor() {
    // Load when signed in and whenever the range changes.
    effect(() => {
      if (this.api.session()) void this.load(this.range());
    });
  }

  /** Dashed line = money put in net of what sales returned, as in the desktop overview. */
  protected readonly chart = computed<ChartPoint[]>(() =>
    this.points().map((p) => ({
      date: p.t.slice(0, 10),
      value: p.value,
      cost: p.cost - p.realized,
      label: this.range() === '1D' ? (p.close ? `Cierre ${p.t.slice(8, 10)}/${p.t.slice(5, 7)}` : hour.format(new Date(p.t))) : undefined
    }))
  );

  /** Result in the period without money put in or taken out; one day = change on the last close. */
  protected readonly period = computed(() => {
    const s = this.summary();
    if (this.range() === '1D') return s ? { pnl: s.dayChangeEur, pct: s.dayChangePct } : null;
    const pts = this.points();
    if (pts.length < 2) return null;
    const result = (p: SeriesPoint) => p.value - p.cost + p.realized;
    const first = pts[0];
    const pnl = result(pts[pts.length - 1]) - result(first);
    return { pnl, pct: first.value > 0 ? pnl / first.value : 0 };
  });

  protected readonly periodLabel = computed(() => {
    const s = this.summary();
    switch (this.range()) {
      case '1D': return s && s.lastCloseDay === s.asOf ? 'hoy' : 'en el último cierre';
      case '1S': return 'en la semana';
      case '1M': return 'en el mes';
      default: return 'en el año';
    }
  });

  protected readonly updated = computed(() => {
    const at = this.summary()?.updatedAt;
    return at ? `Precios del ${stamp.format(new Date(at))}` : '';
  });

  protected async load(range: Range): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [summary, points] = await Promise.all([this.api.summary(), this.api.series(range)]);
      this.summary.set(summary);
      this.points.set(points);
    } catch (e) {
      this.error.set((e as Error).message || 'No se pudieron cargar los datos.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async signIn(event: Event): Promise<void> {
    event.preventDefault();
    this.signingIn.set(true);
    this.error.set(null);
    try {
      await this.api.signIn(this.email().trim(), this.password());
      this.password.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.signingIn.set(false);
    }
  }

  protected refresh(): void {
    void this.load(this.range());
  }

  protected async signOut(): Promise<void> {
    await this.api.signOut();
    this.summary.set(null);
    this.points.set([]);
  }
}
