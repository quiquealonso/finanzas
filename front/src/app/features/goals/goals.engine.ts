import { AssetRow, Overview } from '../../core/portfolio.models';

// Viability of a goal: what the portfolio did in the past (returns without contributions, volatility, worst fall)
// blended with long-term references for the current asset mix, then thousands of simulated futures.

/** Long-term nominal references per asset type: yearly expected return and volatility. */
export const TYPE_REFS: Record<string, { mu: number; vol: number }> = {
  FUND: { mu: 0.07, vol: 0.16 },
  ETF: { mu: 0.075, vol: 0.2 },
  STOCK: { mu: 0.08, vol: 0.3 },
  CRYPTO: { mu: 0.1, vol: 0.75 },
  METAL: { mu: 0.04, vol: 0.15 },
  REAL_ESTATE: { mu: 0.06, vol: 0.05 },
  LOANS: { mu: 0.08, vol: 0.06 },
  LIQUID: { mu: 0.02, vol: 0 }
};
/** Correlation assumed between two different risky assets. */
const RHO = 0.4;
/** Years of own history worth as much as the long-term references. */
const CREDIBILITY_YEARS = 5;

export type AssetRisk = { assetId: string; days: number; volatility: number };

export type YearReturn = { year: string; twr: number; partial: boolean };

export type TypeRisk = { code: string; name: string; weight: number; vol: number; mu: number };

export type PortfolioStats = {
  value: number;
  /** Blended assumptions used by the simulation. */
  mu: number;
  vol: number;
  histMu: number;
  histVol: number;
  histYears: number;
  mixMu: number;
  mixVol: number;
  maxDrawdown: number;
  years: YearReturn[];
  byType: TypeRisk[];
  riskiest: Array<{ name: string; weight: number; vol: number }>;
  /** Net money put in per month over the last 12 months (sales that stay in the portfolio don't count). */
  actualMonthly: number;
};

export function portfolioStats(overview: Overview, risk: AssetRisk[]): PortfolioStats {
  const series = overview.series;
  // Daily return without contributions: the change of value minus the net money put in that day.
  const returns: Array<{ date: string; r: number }> = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a.value <= 0) continue;
    const flow = b.cost - b.realized - (a.cost - a.realized);
    const r = (b.value - flow) / a.value - 1;
    if (Math.abs(r) < 0.5) returns.push({ date: b.date, r });
  }

  let index = 1;
  let peak = 1;
  let maxDrawdown = 0;
  const yearGrowth = new Map<string, number>();
  for (const { date, r } of returns) {
    index *= 1 + r;
    peak = Math.max(peak, index);
    maxDrawdown = Math.min(maxDrawdown, index / peak - 1);
    const y = date.slice(0, 4);
    yearGrowth.set(y, (yearGrowth.get(y) ?? 1) * (1 + r));
  }
  const last = series[series.length - 1]?.date ?? '';
  const years = [...yearGrowth.entries()].map(([year, g]) => ({ year, twr: g - 1, partial: last < `${year}-12-31` }));

  const n = returns.length;
  const mean = n ? returns.reduce((s, x) => s + x.r, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(returns.reduce((s, x) => s + (x.r - mean) ** 2, 0) / (n - 1)) : 0;
  const histYears = n / 365;
  const histMu = n ? index ** (365 / n) - 1 : 0;
  const histVol = sd * Math.sqrt(365);

  // Current mix: every asset with its own measured volatility when there is enough history.
  const riskById = new Map(risk.map((r) => [r.assetId, r]));
  const held = overview.assets.filter((a) => a.valueEur > 0);
  const value = held.reduce((s, a) => s + a.valueEur, 0);
  const volOf = (a: AssetRow) => {
    const ref = TYPE_REFS[a.typeCode] ?? TYPE_REFS['STOCK'];
    const measured = riskById.get(a.id);
    if (a.typeCode === 'LIQUID' || a.typeCode === 'REAL_ESTATE' || a.typeCode === 'LOANS') return ref.vol;
    return measured && measured.days >= 120 && measured.volatility > 0 ? measured.volatility : ref.vol;
  };
  const items = held.map((a) => ({ a, w: value > 0 ? a.valueEur / value : 0, vol: volOf(a), mu: (TYPE_REFS[a.typeCode] ?? TYPE_REFS['STOCK']).mu }));
  const mixMu = items.reduce((s, x) => s + x.w * x.mu, 0);
  let variance = 0;
  for (const x of items) for (const y of items) variance += x.w * y.w * x.vol * y.vol * (x === y ? 1 : RHO);
  const mixVol = Math.sqrt(variance);

  const byType = overview.types
    .map((t) => {
      const group = items.filter((x) => x.a.typeCode === t.code);
      const weight = group.reduce((s, x) => s + x.w, 0);
      return {
        code: t.code,
        name: t.name,
        weight,
        vol: weight > 0 ? group.reduce((s, x) => s + x.w * x.vol, 0) / weight : 0,
        mu: (TYPE_REFS[t.code] ?? TYPE_REFS['STOCK']).mu
      };
    })
    .filter((t) => t.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const riskiest = [...items]
    .sort((a, b) => b.w * b.vol - a.w * a.vol)
    .slice(0, 5)
    .map((x) => ({ name: x.a.name, weight: x.w, vol: x.vol }));

  // Own history gains weight as it grows; a lucky (or awful) short period can't dominate.
  const k = histYears / (histYears + CREDIBILITY_YEARS);
  const mu = k * clamp(histMu, -0.1, 0.15) + (1 - k) * mixMu;
  const vol = n > 60 ? (histVol + mixVol) / 2 : mixVol;

  const end = series[series.length - 1];
  const yearAgo = isoDaysBefore(last, 365);
  const start = [...series].reverse().find((p) => p.date <= yearAgo) ?? series[0];
  const months = start && end ? Math.max(1, daysBetween(start.date, end.date) / 30.4375) : 1;
  const actualMonthly = start && end ? (end.cost - end.realized - (start.cost - start.realized)) / months : 0;

  return { value, mu, vol, histMu, histVol, histYears, mixMu, mixVol, maxDrawdown, years, byType, riskiest, actualMonthly };
}

export type Simulation = {
  probability: number;
  /** Percentiles 10/25/50/75/90 of the value at the end of each month (index 0 = today). */
  bands: { p10: number[]; p25: number[]; p50: number[]; p75: number[]; p90: number[] };
  /** Month (from today) when half of the futures have reached the target; null = not within the horizon. */
  medianReachMonth: number | null;
};

/** Monthly random walk with lognormal returns; the contribution goes in at the start of every month. */
export function simulate(start: number, monthly: number, months: number, target: number, mu: number, vol: number, paths = 2000): Simulation {
  const rand = gaussian(1234567);
  const drift = Math.log(1 + mu) / 12 - (vol * vol) / 24;
  const step = vol / Math.sqrt(12);
  const values = new Float64Array((months + 1) * paths);
  const reached = new Int32Array(paths).fill(-1);
  for (let p = 0; p < paths; p++) {
    let v = start;
    values[p] = v;
    if (v >= target) reached[p] = 0;
    for (let m = 1; m <= months; m++) {
      v = (v + monthly) * Math.exp(drift + step * rand());
      values[m * paths + p] = v;
      if (reached[p] < 0 && v >= target) reached[p] = m;
    }
  }
  const pick = (sorted: Float64Array, q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const bands = { p10: [] as number[], p25: [] as number[], p50: [] as number[], p75: [] as number[], p90: [] as number[] };
  let final = new Float64Array(0);
  for (let m = 0; m <= months; m++) {
    const sorted = values.slice(m * paths, (m + 1) * paths).sort();
    bands.p10.push(pick(sorted, 0.1));
    bands.p25.push(pick(sorted, 0.25));
    bands.p50.push(pick(sorted, 0.5));
    bands.p75.push(pick(sorted, 0.75));
    bands.p90.push(pick(sorted, 0.9));
    final = sorted;
  }
  const probability = final.filter((v) => v >= target).length / paths;
  const reachMonths = [...reached].map((m) => (m < 0 ? Infinity : m)).sort((a, b) => a - b);
  const median = reachMonths[Math.floor(paths / 2)];
  return { probability, bands, medianReachMonth: Number.isFinite(median) ? median : null };
}

/** Smallest monthly contribution that reaches the target with the given probability (0 if already there). */
export function requiredMonthly(start: number, months: number, target: number, mu: number, vol: number, probability: number): number {
  const chance = (c: number) => simulate(start, c, months, target, mu, vol, 600).probability;
  if (chance(0) >= probability) return 0;
  let lo = 0;
  let hi = Math.max(50, target / Math.max(1, months));
  while (chance(hi) < probability && hi < target) hi *= 2;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (chance(mid) >= probability) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi / 5) * 5;
}

/** Value with constant growth and contributions (no randomness). */
export function futureValue(start: number, monthly: number, months: number, yearly: number): number {
  const g = (1 + yearly) ** (1 / 12);
  let v = start;
  for (let m = 0; m < months; m++) v = (v + monthly) * g;
  return v;
}

/** Yearly return needed to reach the target with this contribution; null if not even 60% a year is enough. */
export function requiredReturn(start: number, monthly: number, months: number, target: number): number | null {
  if (futureValue(start, monthly, months, -0.5) >= target) return -0.5;
  if (futureValue(start, monthly, months, 0.6) < target) return null;
  let lo = -0.5;
  let hi = 0.6;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (futureValue(start, monthly, months, mid) >= target) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Value needed today to reach the target with this contribution and the expected return. */
export function neededToday(monthly: number, months: number, target: number, mu: number): number {
  const fromContributions = futureValue(0, monthly, months, mu);
  return Math.max(0, (target - fromContributions) / (1 + mu) ** (months / 12));
}

export function monthsUntil(from: string, to: string): number {
  return Math.max(1, Math.round(daysBetween(from, to) / 30.4375));
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000;
}

function isoDaysBefore(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Seeded normal numbers (mulberry32 + Box-Muller), so the figures don't change on every redraw. */
function gaussian(seed: number): () => number {
  let s = seed >>> 0;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform() || 1e-12)) * Math.cos(2 * Math.PI * uniform());
}
