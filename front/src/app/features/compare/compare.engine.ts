/**
 * Maths of the page Comparar (no Angular here, easy to test): the portfolio (or a part of it) against indexes.
 *
 * - Portfolio curve: TTWROR, the same as the Resumen (daily gain / (value the day before + money put in that day),
 *   chained), so money coming in or out does not move it. That is the only fair way to put it next to an index.
 * - Index curve: its close in euros, carried over the days it does not trade (weekends, holidays).
 * - Both start at 0 % on the day before the period (the last point before `from`).
 * - "Con el mismo dinero": every euro that went into that part of the portfolio, on the same day and the same
 *   amount, buys the index instead (and every euro taken out sells it). What it would be worth today.
 */
export type SeriesPoint = { date: string; value: number; result: number; opening?: number };
export type Closes = Array<[string, number]>;
/** One value per day of the axis: growth of 1 € since the start (1 = 0 %). */
export type Curve = number[];
export type Stats = {
  total: number;
  /** Annualized (only with a year or more; null under). */
  annual: number | null;
  /** Annualized, from weekly returns (null with less than 8 weeks). */
  volatility: number | null;
  /** Worst fall from a high, as a negative number. */
  maxDrawdown: number;
};

const DAY = 86_400_000;
const dayNum = (d: string) => Date.parse(d.slice(0, 10) + 'T12:00:00Z') / DAY;

/** Every calendar day from `from` (or the first day of the series) to the last one, plus the day before as start. */
export function axisOf(series: SeriesPoint[], from: string): string[] {
  if (!series.length) return [];
  const last = series[series.length - 1].date.slice(0, 10);
  const first = series[0].date.slice(0, 10);
  const start = from > first ? addDays(from, -1) : first;
  const out: string[] = [];
  for (let d = start; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

export function addDays(day: string, n: number): string {
  return new Date((dayNum(day) + n) * DAY).toISOString().slice(0, 10);
}

/** TTWROR of a series over the axis. Days missing in the series (or with no money in) add nothing. */
export function portfolioCurve(series: SeriesPoint[], axis: string[]): Curve {
  const byDay = new Map(series.map((p) => [p.date.slice(0, 10), p]));
  let prev = lastBefore(series, axis[0]);
  let growth = 1;
  return axis.map((d, i) => {
    const p = byDay.get(d);
    if (i > 0 && p && prev) {
      const gain = p.result - prev.result;
      const flow = p.value - prev.value - gain;
      const base = prev.value + Math.max(0, flow);
      if (base > 0) growth *= 1 + gain / base;
    }
    if (p) prev = p;
    return growth;
  });
}

/** Index over the axis: last close on or before each day, divided by the one of the first day. */
export function indexCurve(closes: Closes, axis: string[]): Curve | null {
  const levels = levelsOn(closes, axis);
  const start = levels[0];
  if (!start) return null; // the index did not exist yet at the start of the period
  return levels.map((v) => (v ?? start) / start);
}

function levelsOn(closes: Closes, axis: string[]): Array<number | null> {
  let j = -1;
  return axis.map((d) => {
    while (j + 1 < closes.length && closes[j + 1][0] <= d) j++;
    return j >= 0 ? closes[j][1] : null;
  });
}

function lastBefore(series: SeriesPoint[], day: string): SeriesPoint | null {
  let found: SeriesPoint | null = null;
  for (const p of series) {
    if (p.date.slice(0, 10) <= day) found = p;
    else break;
  }
  return found;
}

export function statsOf(curve: Curve, axis: string[]): Stats {
  const n = curve.length;
  const total = n ? curve[n - 1] / curve[0] - 1 : 0;
  const days = n > 1 ? dayNum(axis[n - 1]) - dayNum(axis[0]) : 0;
  const annual = days >= 365 ? Math.pow(1 + total, 365 / days) - 1 : null;
  // Weekly returns, counted back from the last day: the same sampling for funds, stocks and crypto (which trade on
  // weekends), so one does not look calmer only because it has more days.
  const weekly: number[] = [];
  for (let i = n - 1; i - 7 >= 0; i -= 7) weekly.push(curve[i] / curve[i - 7] - 1);
  let volatility: number | null = null;
  if (weekly.length >= 8) {
    const mean = weekly.reduce((s, r) => s + r, 0) / weekly.length;
    const variance = weekly.reduce((s, r) => s + (r - mean) ** 2, 0) / (weekly.length - 1);
    volatility = Math.sqrt(variance) * Math.sqrt(52);
  }
  let peak = curve[0] ?? 1;
  let maxDrawdown = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    maxDrawdown = Math.min(maxDrawdown, v / peak - 1);
  }
  return { total, annual, volatility, maxDrawdown };
}

export type SameMoney = { put: number; real: number; inIndex: number };

/**
 * The same money in the index: value at the start of the period and every later flow (money in or out, at market
 * value, the same rule as the Resumen) buy or sell the index on its day. Units never go below 0.
 */
export function sameMoney(series: SeriesPoint[], closes: Closes, axis: string[]): SameMoney | null {
  const levels = levelsOn(closes, axis);
  if (!levels[0]) return null;
  const byDay = new Map(series.map((p) => [p.date.slice(0, 10), p]));
  let prev = lastBefore(series, axis[0]);
  let units = prev ? prev.value / levels[0] : 0;
  let put = prev?.value ?? 0;
  for (let i = 1; i < axis.length; i++) {
    const p = byDay.get(axis[i]);
    if (!p) continue;
    if (prev) {
      const flow = p.value - prev.value - (p.result - prev.result);
      if (Math.abs(flow) > 0.005) {
        units = Math.max(0, units + flow / (levels[i] ?? levels[0]));
        put += flow;
      }
    } else if (p.value > 0) {
      units = p.value / (levels[i] ?? levels[0]);
      put = p.value;
    }
    prev = p;
  }
  const end = levels[levels.length - 1] ?? levels[0];
  return { put, real: prev?.value ?? 0, inIndex: units * end };
}

/** Difference of two returns in percentage points (+ = the first one did better). */
export const pointsAhead = (a: number, b: number) => (a - b) * 100;
