import { Express } from "express";
import { handler, HttpError } from "./portfolio";

/**
 * Indexes to compare the portfolio with (page Comparar). Each one is an accumulating UCITS ETF listed in euros, so
 * its price already includes the dividends and the dollar/euro move: what a Spanish investor really got. The IBEX 35
 * is the plain index (no dividends). The 60/40 portfolio is built here from two of them, rebalanced every day.
 * Daily closes from Yahoo, kept 6 h in memory (shared by every user, public market data).
 */
type Benchmark = { id: string; name: string; symbol: string; note: string; group: "Acciones" | "Otros" };

export const BENCHMARKS: Benchmark[] = [
  { id: "sp500", name: "S&P 500", symbol: "SXR8.DE", note: "iShares Core S&P 500 (acumulación, en euros)", group: "Acciones" },
  { id: "msci-world", name: "MSCI World", symbol: "EUNL.DE", note: "iShares Core MSCI World (acumulación, en euros)", group: "Acciones" },
  { id: "msci-acwi", name: "MSCI ACWI", symbol: "IUSQ.DE", note: "iShares MSCI All Country World (acumulación, en euros)", group: "Acciones" },
  { id: "nasdaq100", name: "Nasdaq 100", symbol: "SXRV.DE", note: "iShares Nasdaq 100 (acumulación, en euros)", group: "Acciones" },
  { id: "msci-em", name: "MSCI Emergentes", symbol: "IS3N.DE", note: "iShares Core MSCI EM IMI (acumulación, en euros)", group: "Acciones" },
  { id: "eurostoxx50", name: "Euro Stoxx 50", symbol: "SXRT.DE", note: "iShares Core Euro Stoxx 50 (acumulación)", group: "Acciones" },
  { id: "ibex35", name: "IBEX 35", symbol: "^IBEX", note: "Índice sin dividendos", group: "Acciones" },
  { id: "bonds", name: "Bonos globales", symbol: "EUNA.DE", note: "iShares Core Global Aggregate Bond, cubierto a euros (acumulación)", group: "Otros" },
  { id: "gold", name: "Oro", symbol: "4GLD.DE", note: "Xetra-Gold, en euros", group: "Otros" },
  { id: "bitcoin", name: "Bitcoin", symbol: "BTC-EUR", note: "Bitcoin en euros", group: "Otros" },
];
/** Built from two of the above: 60 % MSCI World + 40 % global bonds, back to 60/40 every day. */
const MIX = { id: "60-40", name: "Cartera 60/40", note: "60 % MSCI World + 40 % bonos globales, reequilibrada", group: "Otros" as const, parts: [["msci-world", 0.6], ["bonds", 0.4]] as const };

const UA = { "User-Agent": "finanzas-class-project/1.0" };
const TTL = 6 * 3600_000;
const cache = new Map<string, { at: number; closes: Array<[string, number]> }>();

/** Daily closes of a symbol since 2010 (dividend-adjusted when Yahoo has it), oldest first. With range=max Yahoo gives monthly ones. */
async function closesOf(symbol: string): Promise<Array<[string, number]>> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL) return hit.closes;
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${Math.floor(Date.UTC(2010, 0, 1) / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    if (hit) return hit.closes; // Yahoo down for a moment: the old copy is better than nothing
    throw new HttpError(502, `Yahoo no responde para ${symbol} (${res.status})`);
  }
  const r = (await res.json())?.chart?.result?.[0];
  if (r?.meta?.currency && r.meta.currency !== "EUR") throw new HttpError(500, `${symbol} no cotiza en euros`);
  const ts: number[] = r?.timestamp ?? [];
  const adj: Array<number | null> = r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close ?? [];
  const offset = Number(r?.meta?.gmtoffset ?? 0);
  const byDay = new Map<string, number>();
  ts.forEach((t, i) => {
    const v = adj[i];
    if (v != null && Number.isFinite(v) && v > 0) byDay.set(new Date((t + offset) * 1000).toISOString().slice(0, 10), Number(v.toPrecision(7)));
  });
  const closes = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  cache.set(symbol, { at: Date.now(), closes });
  return closes;
}

/** 60/40 index: starts at 100 on the first day both parts have a close, each day the weighted mean of their returns. */
function mixCloses(parts: Array<{ weight: number; closes: Array<[string, number]> }>): Array<[string, number]> {
  const maps = parts.map((p) => new Map(p.closes));
  const days = [...new Set(parts.flatMap((p) => p.closes.map(([d]) => d)))].sort();
  const last: Array<number | null> = parts.map(() => null);
  const out: Array<[string, number]> = [];
  let level = 100;
  for (const d of days) {
    const now = maps.map((m, i) => m.get(d) ?? last[i]);
    if (now.every((v) => v != null) && last.every((v) => v != null)) {
      level *= 1 + parts.reduce((s, p, i) => s + p.weight * (now[i]! / last[i]! - 1), 0);
    }
    if (now.every((v) => v != null)) out.push([d, Math.round(level * 1e6) / 1e6]);
    now.forEach((v, i) => (last[i] = v));
  }
  return out;
}

export function registerBenchmarkRoutes(app: Express): void {
  // Daily closes in euros of every index since `from` (YYYY-MM-DD; default 5 years ago), plus the close just before.
  app.get("/api/v2/benchmarks", handler(async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? "")) ? String(req.query.from) : new Date(Date.now() - 5 * 365 * 86_400_000).toISOString().slice(0, 10);
    const all = new Map<string, Array<[string, number]>>();
    const results = await Promise.allSettled(BENCHMARKS.map(async (b) => all.set(b.id, await closesOf(b.symbol))));
    const failed = BENCHMARKS.filter((_, i) => results[i].status === "rejected").map((b) => b.name);
    if (all.has("msci-world") && all.has("bonds")) {
      all.set(MIX.id, mixCloses(MIX.parts.map(([id, weight]) => ({ weight, closes: all.get(id)! }))));
    }
    const since = (closes: Array<[string, number]>) => {
      const i = closes.findIndex(([d]) => d >= from);
      return i < 0 ? closes.slice(-1) : closes.slice(Math.max(0, i - 1));
    };
    const list = [...BENCHMARKS, MIX].filter((b) => all.has(b.id)).map((b) => ({
      id: b.id, name: b.name, note: b.note, group: b.group, symbol: "symbol" in b ? b.symbol : null,
      first: all.get(b.id)![0]?.[0] ?? null, closes: since(all.get(b.id)!),
    }));
    res.json({ benchmarks: list, failed });
  }));
}
