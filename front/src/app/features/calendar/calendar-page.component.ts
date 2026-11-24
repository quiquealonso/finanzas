import { Component, computed, effect, inject, signal } from '@angular/core';
import { errorMessage, PortfolioApi } from '../../core/portfolio-api.service';
import { CalendarDay, CalendarDayDetail, TYPE_COLORS } from '../../core/portfolio.models';
import { PortfolioStore } from '../../core/portfolio.store';
import { formatSignedMoney, formatSignedPercent, signClass } from '../../shared/format.utils';

type Mode = 'eur' | 'pct';
type Cell = { date: string; day: number; data: CalendarDay | null; future: boolean } | null;
/** One row of a month: its 7 days and the total of the days of that month in the row (null when none had data). */
type Week = { cells: Cell[]; pnl: number | null; pct: number | null };
type Month = { key: string; name: string; weeks: Week[]; pnl: number; pct: number | null; up: number; down: number };

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/**
 * Daily gain/loss heatmap: one calendar per month, each day green (gain) or red (loss), stronger the bigger it is.
 * The colour scale is the 95th percentile of the year, so one extreme day doesn't wash out all the others.
 */
@Component({
  selector: 'app-calendar-page',
  standalone: true,
  templateUrl: './calendar-page.component.html',
  styleUrl: './calendar-page.component.css',
  host: { '(document:keydown.escape)': 'selected.set(null)' }
})
export class CalendarPageComponent {
  private readonly api = inject(PortfolioApi);
  private readonly store = inject(PortfolioStore);
  protected readonly weekdays = WEEKDAYS;
  protected readonly typeColors = TYPE_COLORS;
  protected readonly fmt = { formatSignedMoney, formatSignedPercent, signClass };

  protected readonly days = signal<CalendarDay[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly mode = signal<Mode>('eur');
  protected readonly year = signal(new Date().getFullYear());
  protected readonly selected = signal<string | null>(null);
  protected readonly detail = signal<CalendarDayDetail | null>(null);
  protected readonly detailLoading = signal(false);

  private readonly reload = effect(() => {
    this.store.version();
    this.api.calendar()
      .then((r) => { this.days.set(r.days); this.error.set(null); })
      .catch((e) => this.error.set(errorMessage(e, 'No se pudo cargar el calendario.')));
  });

  private readonly byDate = computed(() => new Map((this.days() ?? []).map((d) => [d.date, d])));

  protected readonly years = computed(() => {
    const set = new Set((this.days() ?? []).map((d) => Number(d.date.slice(0, 4))));
    return [...set].sort((a, b) => b - a);
  });

  private readonly yearDays = computed(() => (this.days() ?? []).filter((d) => d.date.startsWith(String(this.year()))));

  /** Colour scale: 95th percentile of the absolute daily moves of the year. */
  private readonly scale = computed(() => {
    const vals = this.yearDays().map((d) => Math.abs(this.metric(d) ?? 0)).filter((v) => v > 0).sort((a, b) => a - b);
    return vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] : 1;
  });

  protected readonly months = computed<Month[]>(() => {
    const y = this.year();
    const today = new Date().toISOString().slice(0, 10);
    const map = this.byDate();
    const out: Month[] = [];
    for (let m = 0; m < 12; m++) {
      const first = new Date(Date.UTC(y, m, 1));
      if (first.toISOString().slice(0, 10) > today) break;
      const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const lead = (first.getUTCDay() + 6) % 7; // Monday first
      const cells: Cell[] = Array.from({ length: lead }, () => null);
      let pnl = 0, up = 0, down = 0;
      const monthDays: CalendarDay[] = [];
      for (let d = 1; d <= daysIn; d++) {
        const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const data = map.get(date) ?? null;
        if (data) {
          pnl += data.pnl;
          if (data.pnl > 0.5) up++;
          else if (data.pnl < -0.5) down++;
          monthDays.push(data);
        }
        cells.push({ date, day: d, data, future: date > today });
      }
      while (cells.length % 7) cells.push(null);
      const weeks: Week[] = [];
      for (let i = 0; i < cells.length; i += 7) {
        const row = cells.slice(i, i + 7);
        const withData = row.filter((c) => c?.data).map((c) => c!.data!);
        const pnl = withData.length ? withData.reduce((s, d) => s + d.pnl, 0) : null;
        weeks.push({ cells: row, pnl, pct: withData.length ? this.moneyReturn(withData) : null });
      }
      out.push({ key: `${y}-${m}`, name: MONTHS[m], weeks, pnl, pct: monthDays.length ? this.moneyReturn(monthDays) : null, up, down });
    }
    return out.reverse(); // newest month first
  });

  /** Position of each day in the whole list, to find the day before a period. */
  private readonly index = computed(() => new Map((this.days() ?? []).map((d, i) => [d.date, i])));

  /**
   * % of a run of days with the sign of its euros: the gain over the money that was invested (Modified Dietz,
   * like "Rentab. de tu dinero" in Resumen): value the day before plus each contribution weighted by the share
   * of the period it was in. Money put in during the period doesn't inflate it.
   */
  private moneyReturn(list: CalendarDay[]): number | null {
    const all = this.days() ?? [];
    const i0 = this.index().get(list[0].date) ?? 0;
    let last = i0 > 0 ? all[i0 - 1].value : 0;
    let base = last;
    const n = list.length;
    list.forEach((d, i) => {
      const flow = d.value - last - d.pnl;
      base += flow * ((n - i) / n);
      last = d.value;
    });
    const gain = list.reduce((s, d) => s + d.pnl, 0);
    return base > 0 ? gain / base : null;
  }

  protected readonly summary = computed(() => {
    const list = this.yearDays();
    if (!list.length) return null;
    const total = list.reduce((s, d) => s + d.pnl, 0);
    const moving = list.filter((d) => Math.abs(d.pnl) > 0.5);
    const best = list.reduce((a, b) => (b.pnl > a.pnl ? b : a));
    const worst = list.reduce((a, b) => (b.pnl < a.pnl ? b : a));
    // Current streak: consecutive days (newest first) with the same sign, skipping flat days.
    let streak = 0, sign = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = Math.sign(Math.abs(list[i].pnl) > 0.5 ? list[i].pnl : 0);
      if (!s) continue;
      if (!sign) sign = s;
      if (s !== sign) break;
      streak++;
    }
    return {
      total, best, worst, streak, streakUp: sign > 0,
      upShare: moving.length ? moving.filter((d) => d.pnl > 0).length / moving.length : 0,
      avg: moving.length ? total / moving.length : 0
    };
  });

  private metric(d: CalendarDay): number | null {
    return this.mode() === 'eur' ? d.pnl : d.pct;
  }

  /** Background of a day: green or red, from faint to full at the scale (95th percentile). */
  protected color(d: CalendarDay | null): string | null {
    if (!d) return null;
    const v = this.metric(d);
    if (v === null || Math.abs(d.pnl) < 0.5) return 'var(--surface-2)';
    const t = Math.min(1, Math.abs(v) / this.scale());
    const pct = Math.round(18 + t * 72);
    return `color-mix(in srgb, ${v > 0 ? 'var(--heat-up)' : 'var(--heat-down)'} ${pct}%, var(--surface))`;
  }

  /** Strong cells get white text, faint ones the normal text colour. */
  protected strong(d: CalendarDay | null): boolean {
    if (!d) return false;
    const v = this.metric(d);
    return v !== null && Math.abs(v) / this.scale() > 0.55;
  }

  protected tip(c: NonNullable<Cell>): string {
    if (!c.data) return c.future ? '' : `${this.dayLabel(c.date)} · sin datos`;
    return `${this.dayLabel(c.date)} · ${formatSignedMoney(c.data.pnl)}${c.data.pct !== null ? ' (' + formatSignedPercent(c.data.pct) + ')' : ''}`;
  }

  /** Short money for a cell: +312, −1,2k, +15k. */
  protected short(pnl: number): string {
    const v = Math.abs(pnl);
    const s = v >= 10000 ? Math.round(v / 1000) + 'k' : v >= 1000 ? (v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + 'k' : Math.round(v).toString();
    return (pnl < 0 ? '−' : '+') + s + ' €';
  }

  /** Short percent for a cell: +0,4 %. */
  protected shortPct(pct: number | null): string {
    if (pct === null) return '';
    return (pct < 0 ? '−' : '+') + Math.abs(pct * 100).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
  }

  protected pickYear(value: string): void {
    this.year.set(Number(value));
    this.selected.set(null);
  }

  /** Weekly total: same colours as a day, on the scale of a week (about 5 times a day). */
  protected weekColor(w: Week): string | null {
    const v = this.mode() === 'eur' ? w.pnl : w.pct;
    if (v === null || w.pnl === null || Math.abs(w.pnl) < 0.5) return null;
    const t = Math.min(1, Math.abs(v) / (this.scale() * 2.2));
    return `color-mix(in srgb, ${v > 0 ? 'var(--heat-up)' : 'var(--heat-down)'} ${Math.round(14 + t * 50)}%, var(--surface))`;
  }

  protected weekTip(w: Week): string {
    if (w.pnl === null) return '';
    return `Semana: ${formatSignedMoney(w.pnl)}${w.pct !== null ? ' (' + formatSignedPercent(w.pct) + ')' : ''}`;
  }

  protected dayLabel(date: string): string {
    return new Date(date + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  protected pctText(v: number | null): string {
    return v === null ? '' : formatSignedPercent(v);
  }

  protected async open(c: Cell): Promise<void> {
    if (!c?.data) return;
    if (this.selected() === c.date) {
      this.selected.set(null);
      return;
    }
    this.selected.set(c.date);
    this.detail.set(null);
    this.detailLoading.set(true);
    try {
      this.detail.set(await this.api.calendarDay(c.date));
    } catch (e) {
      this.store.error(e, 'No se pudo cargar el día.');
    } finally {
      this.detailLoading.set(false);
    }
  }

  protected readonly selectedDay = computed(() => (this.selected() ? this.byDate().get(this.selected()!) ?? null : null));
}
