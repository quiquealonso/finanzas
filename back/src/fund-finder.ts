import { Express } from "express";
import AdmZip from "adm-zip";
import { randomUUID } from "crypto";
import { base, currentUser, DEFAULT_USER, prisma, sharedQuery } from "./prisma";
import { handler, HttpError } from "./portfolio";
import { tickerForIsin } from "./bbva-orders";
import { askGeminiJson, GeminiError, geminiConfigured } from "./gemini";

/**
 * Fund finder: after the risk test, the user picks regions and the app proposes the 5 funds that best fit their
 * profile there. Educational, never investment advice.
 *
 * Universe (table fund_universe, shared, refreshed when older than 35 days):
 *   - CNMV (official, public): every Spanish-registered fund from the newest quarterly ZIP of "Descarga de ficheros
 *     de información individual de IIC". FONDREGISTRO (names, manager), FONDTRIM (returns and volatility of the last
 *     4 quarters, expense ratio, assets, holders) and FONDCART (holdings: the ISIN country of each one tells where
 *     the fund invests). One class per fund compartment: the biggest.
 *   - Yahoo: a short list of popular international index funds and ETFs (not registered in Spain, so not in the
 *     CNMV files); return, volatility and drawdown computed from 3 years of daily prices. No expense ratio.
 * Search: risk level of the profile (SRRI scale from the volatility) + regions → objective pre-selection (return
 * per unit of risk, costs, size) → Gemini picks 5 and explains why (falls back to the top 5 if Gemini is busy).
 */

// The CNMV site (ASP.NET) answers 500 to the default "Accept-Language: *" of Node: send a real language.
const UA = { "User-Agent": "finanzas-class-project/1.0", "Accept-Language": "es-ES,es;q=0.9" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const q = <T = any>(sql: string, ...args: unknown[]) => sharedQuery<T>(sql, ...args);

export const REGIONS = ["ES", "EU", "US", "JP", "CN", "APAC", "EM", "LATAM"] as const;
type Region = (typeof REGIONS)[number];
const REGION_NAME: Record<Region | "GLOBAL", string> = {
  ES: "España", EU: "Europa", US: "EE. UU.", JP: "Japón", CN: "China", APAC: "Asia-Pacífico", EM: "Emergentes", LATAM: "Latinoamérica", GLOBAL: "Global",
};

/** Country of an ISIN (its first two letters) -> region. IE, LU, XS… are fund or bond domiciles: unknown. */
const COUNTRY_REGION: Record<string, Region> = {
  ES: "ES",
  DE: "EU", FR: "EU", IT: "EU", NL: "EU", BE: "EU", AT: "EU", FI: "EU", PT: "EU", GR: "EU", GB: "EU", CH: "EU", SE: "EU",
  DK: "EU", NO: "EU", PL: "EU", CZ: "EU", HU: "EU", SK: "EU", SI: "EU", EE: "EU", LV: "EU", LT: "EU", RO: "EU", HR: "EU", JE: "EU", GG: "EU",
  US: "US", CA: "US", BM: "US",
  JP: "JP",
  CN: "CN", HK: "CN", KY: "CN", MO: "CN",
  AU: "APAC", NZ: "APAC", SG: "APAC",
  KR: "EM", TW: "EM", IN: "EM", ID: "EM", TH: "EM", MY: "EM", PH: "EM", TR: "EM", ZA: "EM", SA: "EM", AE: "EM", QA: "EM", IL: "EM", EG: "EM", VN: "EM",
  BR: "LATAM", MX: "LATAM", CL: "LATAM", CO: "LATAM", PE: "LATAM", AR: "LATAM", UY: "LATAM", PA: "LATAM",
};

/** Regions guessed from a fund name or category, when its holdings don't tell (funds of funds, IE/LU ETFs). */
const NAME_REGION: Array<[RegExp, Region]> = [
  [/ESPA[ÑN]|IBEX|IBERI|ESPA\b|SPAIN/i, "ES"],
  [/EUROPA|EUROPE|EURO\b|EUROZONA|EUROZONE|EMU|STOXX/i, "EU"],
  [/EE\.? ?UU|USA|AMERICA\b|AMÉRICA\b|NORTEAM|S&P|SP500|S\.?P\.? ?500|NASDAQ|U\.S\.|US\b/i, "US"],
  [/JAP[OÓ]N|JAPAN|NIKKEI/i, "JP"],
  [/CHINA|CHINESE/i, "CN"],
  [/PAC[IÍ]FIC|ASIA/i, "APAC"],
  [/EMERG|INDIA|COREA|KOREA/i, "EM"],
  [/LATAM|LATINOAM|LATIN AMERICA|BRASIL|BRAZIL|MEXIC/i, "LATAM"],
];

/** SRRI scale (1..7) from the yearly volatility. */
export function riskFromVol(vol: number | null): number | null {
  if (vol == null || !Number.isFinite(vol)) return null;
  const v = vol * 100;
  return v < 0.5 ? 1 : v < 2 ? 2 : v < 5 ? 3 : v < 10 ? 4 : v < 15 ? 5 : v < 25 ? 6 : 7;
}

/** Risk levels that fit each profile of the test (features/risk-profile/risk-questions.ts). */
const PROFILE_RISK: Record<string, number[]> = {
  conservador: [1, 2, 3], moderado: [3, 4], equilibrado: [4, 5], dinamico: [5, 6], agresivo: [6, 7],
};
const PROFILE_NAME: Record<string, string> = {
  conservador: "Conservador", moderado: "Moderado", equilibrado: "Equilibrado", dinamico: "Dinámico", agresivo: "Agresivo",
};

/** International index funds and ETFs often used from Spain (Yahoo prices). Unknown ISINs are skipped. */
const INTERNATIONAL: Array<{ isin: string; name: string; manager: string; region: Region | "GLOBAL"; assetClass: string; category: string }> = [
  { isin: "IE00B03HD191", name: "Vanguard Global Stock Index Fund EUR Acc", manager: "Vanguard", region: "GLOBAL", assetClass: "equity", category: "RV Global (índice)" },
  { isin: "IE0032126645", name: "Vanguard U.S. 500 Stock Index Fund EUR Acc", manager: "Vanguard", region: "US", assetClass: "equity", category: "RV EE. UU. (índice)" },
  { isin: "IE0007987690", name: "Vanguard European Stock Index Fund EUR Acc", manager: "Vanguard", region: "EU", assetClass: "equity", category: "RV Europa (índice)" },
  { isin: "IE0008248803", name: "Vanguard Eurozone Stock Index Fund EUR Acc", manager: "Vanguard", region: "EU", assetClass: "equity", category: "RV Zona euro (índice)" },
  { isin: "IE0007286036", name: "Vanguard Japan Stock Index Fund EUR Acc", manager: "Vanguard", region: "JP", assetClass: "equity", category: "RV Japón (índice)" },
  { isin: "IE0007201266", name: "Vanguard Pacific ex-Japan Stock Index Fund EUR Acc", manager: "Vanguard", region: "APAC", assetClass: "equity", category: "RV Pacífico (índice)" },
  { isin: "IE0031786696", name: "Vanguard Emerging Markets Stock Index Fund EUR Acc", manager: "Vanguard", region: "EM", assetClass: "equity", category: "RV Emergentes (índice)" },
  { isin: "IE00B42W4L06", name: "Vanguard Global Small-Cap Index Fund EUR Acc", manager: "Vanguard", region: "GLOBAL", assetClass: "equity", category: "RV Global pequeñas (índice)" },
  { isin: "IE00B18GC888", name: "Vanguard Global Bond Index Fund EUR Hedged Acc", manager: "Vanguard", region: "GLOBAL", assetClass: "bond", category: "RF Global (índice)" },
  { isin: "IE0007472990", name: "Vanguard Euro Government Bond Index Fund EUR Acc", manager: "Vanguard", region: "EU", assetClass: "bond", category: "RF Gobiernos euro (índice)" },
  { isin: "LU0996182563", name: "Amundi Index MSCI World AE-C", manager: "Amundi", region: "GLOBAL", assetClass: "equity", category: "RV Global (índice)" },
  { isin: "LU0996179007", name: "Amundi Index S&P 500 AE-C", manager: "Amundi", region: "US", assetClass: "equity", category: "RV EE. UU. (índice)" },
  { isin: "IE00BYX5NX33", name: "Fidelity MSCI World Index Fund P-ACC-EUR", manager: "Fidelity", region: "GLOBAL", assetClass: "equity", category: "RV Global (índice)" },
  { isin: "IE00BYX5MX67", name: "Fidelity S&P 500 Index Fund P-ACC-EUR", manager: "Fidelity", region: "US", assetClass: "equity", category: "RV EE. UU. (índice)" },
  { isin: "IE00B4L5Y983", name: "iShares Core MSCI World UCITS ETF", manager: "iShares", region: "GLOBAL", assetClass: "equity", category: "ETF RV Global" },
  { isin: "IE00B5BMR087", name: "iShares Core S&P 500 UCITS ETF", manager: "iShares", region: "US", assetClass: "equity", category: "ETF RV EE. UU." },
  { isin: "IE00BKM4GZ66", name: "iShares Core MSCI EM IMI UCITS ETF", manager: "iShares", region: "EM", assetClass: "equity", category: "ETF RV Emergentes" },
  { isin: "IE00B4K48X80", name: "iShares Core MSCI Europe UCITS ETF", manager: "iShares", region: "EU", assetClass: "equity", category: "ETF RV Europa" },
  { isin: "IE00B4L5YX21", name: "iShares Core MSCI Japan IMI UCITS ETF", manager: "iShares", region: "JP", assetClass: "equity", category: "ETF RV Japón" },
  { isin: "IE00BJ5JPG56", name: "iShares MSCI China UCITS ETF", manager: "iShares", region: "CN", assetClass: "equity", category: "ETF RV China" },
  { isin: "IE00B27YCK28", name: "iShares MSCI EM Latin America UCITS ETF", manager: "iShares", region: "LATAM", assetClass: "equity", category: "ETF RV Latinoamérica" },
  { isin: "IE00BZCQB185", name: "iShares MSCI India UCITS ETF", manager: "iShares", region: "EM", assetClass: "equity", category: "ETF RV India" },
  { isin: "IE00BK5BQT80", name: "Vanguard FTSE All-World UCITS ETF Acc", manager: "Vanguard", region: "GLOBAL", assetClass: "equity", category: "ETF RV Global" },
  { isin: "IE00B4WXJJ64", name: "iShares Core Euro Government Bond UCITS ETF", manager: "iShares", region: "EU", assetClass: "bond", category: "ETF RF Gobiernos euro" },
  { isin: "IE00BDBRDM35", name: "iShares Core Global Aggregate Bond UCITS ETF EUR Hedged", manager: "iShares", region: "GLOBAL", assetClass: "bond", category: "ETF RF Global" },
  { isin: "FR0010251744", name: "Amundi IBEX 35 UCITS ETF", manager: "Amundi", region: "ES", assetClass: "equity", category: "ETF RV España" },
];

// ---------------------------------------------------------------- jobs (progress shown in the dialog)

type Event = { n: number; level: "info" | "ok" | "ai" | "warn" | "error"; text: string };
type Pick = {
  isin: string; name: string; manager: string | null; category: string | null; source: string; regions: Record<string, number>;
  ret1y: number | null; ret3y: number | null; vol: number | null; risk: number | null; ter: number | null; aum: number | null;
  reason: string; score: number;
};
type Job = { id: string; userId: string; phase: "running" | "done" | "error"; events: Event[]; picks: Pick[]; model: string | null; considered: number; matched: number };
const jobs = new Map<string, Job>();
const log = (job: Job, level: Event["level"], text: string) => job.events.push({ n: job.events.length, level, text });

// ---------------------------------------------------------------- CNMV

const xmlValue = (block: string, tag: string) => (block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) ?? [])[1]?.trim() ?? null;
const num = (s: string | null) => (s == null || s === "" ? null : Number(s));

/** The CNMV site sometimes takes long to connect: three tries before giving up. */
async function fetchRetry(url: string, timeoutMs: number, job: Job): Promise<Response> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      last = e;
      if (attempt < 3) {
        log(job, "warn", `La CNMV tarda en responder; reintento ${attempt + 1} de 3…`);
        await sleep(3000 * attempt);
      }
    }
  }
  throw new Error(`La CNMV no responde (${String((last as any)?.cause?.code ?? (last as any)?.message ?? last)}). Prueba en unos minutos.`);
}

/** Newest CNMV monthly ZIP that has the quarterly file (FONDTRIM). */
async function newestCnmvZip(job: Job): Promise<{ zip: AdmZip; period: string }> {
  const year = new Date().getFullYear();
  const links: string[] = [];
  for (const y of [year, year - 1]) {
    const res = await fetchRetry(`https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual?ejercicio=${y}`, 30_000, job);
    const html = await res.text();
    links.push(...[...html.matchAll(/href="(https:\/\/www\.cnmv\.es\/webservices\/verdocumento\/ver\?e=[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")));
  }
  for (const link of links.slice(0, 5)) {
    log(job, "info", "Descargando un fichero de la CNMV…");
    const res = await fetchRetry(link, 180_000, job);
    if (!res.ok) continue;
    const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
    const trim = zip.getEntries().find((e) => /^FONDTRIM_\d{6}\.xml$/.test(e.entryName));
    if (trim) return { zip, period: trim.entryName.slice(9, 15) };
    log(job, "info", "Ese mes no trae datos trimestrales; probando el anterior…");
    await sleep(500);
  }
  throw new Error(links.length ? "No se encontró ningún fichero trimestral reciente de la CNMV." : "La página de descargas de la CNMV no trae enlaces ahora mismo.");
}

async function loadCnmv(job: Job): Promise<number> {
  const { zip, period } = await newestCnmvZip(job);
  // Some CNMV files are UTF-8 and others latin1: UTF-8 unless it does not decode cleanly.
  const decode = (buf: Buffer) => { const s = buf.toString("utf8"); return s.includes("\uFFFD") ? buf.toString("latin1") : s; };
  const read = (prefix: string) => decode(zip.getEntries().find((e) => e.entryName.startsWith(prefix) && e.entryName.endsWith(".xml"))!.getData());
  log(job, "ok", `Datos de la CNMV del trimestre ${period.slice(4)}/${period.slice(0, 4)}. Leyendo los fondos…`);

  // Names and managers per class.
  const names = new Map<string, { fund: string; compartment: string | null; cls: string | null; manager: string | null; etf: boolean }>();
  for (const ent of read("FONDREGISTRO_").split("<Entidad>").slice(1)) {
    const fund = xmlValue(ent, "Denominacion") ?? "";
    const manager = xmlValue(ent, "DenominacionGestora");
    const etf = xmlValue(ent, "ETF") === "SI";
    for (const comp of ent.split("<Compartimento>").slice(1)) {
      const compName = xmlValue(comp, "DenominacionCompartimento");
      for (const cls of comp.split("<Clase>").slice(1)) {
        const isin = xmlValue(cls, "ISIN");
        if (isin) names.set(isin, { fund, compartment: compName && !/^COMPARTIMENTO 0$/i.test(compName) ? compName : null, cls: xmlValue(cls, "DenominacionClase"), manager, etf });
      }
    }
  }

  // Where each fund compartment invests: holdings by ISIN country.
  log(job, "info", "Leyendo las carteras para saber dónde invierte cada fondo…");
  const regionsOf = new Map<string, { w: Record<string, number>; known: number; total: number }>();
  for (const ent of read("FONDCART_").split("<Entidad>").slice(1)) {
    const reg = xmlValue(ent, "NumeroRegistro");
    for (const comp of ent.split("<Compartimento>").slice(1)) {
      const key = `${reg}|${xmlValue(comp, "NumeroCompartimento")}`;
      const acc = { w: {} as Record<string, number>, known: 0, total: 0 };
      for (const m of comp.matchAll(/<CodigoISIN>([A-Z]{2})[^<]*<\/CodigoISIN>[\s\S]*?<ValorMercado>(-?[\d.]+)<\/ValorMercado>/g)) {
        const value = Number(m[2]);
        if (!(value > 0)) continue;
        acc.total += value;
        const region = COUNTRY_REGION[m[1]];
        if (region) { acc.w[region] = (acc.w[region] ?? 0) + value; acc.known += value; }
      }
      regionsOf.set(key, acc);
    }
  }

  // Figures per class; keep the biggest class of each compartment.
  const best = new Map<string, any>();
  for (const ent of read("FONDTRIM_").split("<Entidad>").slice(1)) {
    const reg = xmlValue(ent, "NumeroRegistro");
    for (const comp of ent.split("<Compartimento>").slice(1)) {
      const key = `${reg}|${xmlValue(comp, "NumeroCompartimento")}`;
      const category = xmlValue(comp, "VocacionInversora");
      for (const cls of comp.split("<Clase>").slice(1)) {
        const isin = xmlValue(cls, "ISIN");
        const aum = num(xmlValue(cls, "Patrimonio"));
        if (!isin || !aum) continue;
        const rets = ["Rentabilidad_TrimestreActual", "Rentabilidad_T_1", "Rentabilidad_T_2", "Rentabilidad_T_3"].map((t) => num(xmlValue(cls, t)));
        const vols = ["Volatilidad_TrimestreActual", "Volatilidad_T_1", "Volatilidad_T_2", "Volatilidad_T_3"].map((t) => num(xmlValue(cls, t))).filter((v): v is number => v != null);
        const ters = ["RatioTotalGastos_TrimestreActual", "RatioTotalGastos_T_1", "RatioTotalGastos_T_2", "RatioTotalGastos_T_3"].map((t) => num(xmlValue(cls, t))).filter((v): v is number => v != null);
        const row = {
          isin, key, category, aum, holders: num(xmlValue(cls, "NumeroParticipes")),
          ret1y: rets.every((r) => r != null) ? rets.reduce((g, r) => g * (1 + r! / 100), 1) - 1 : null,
          vol: vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length / 100 : null,
          ter: ters.length === 4 ? ters.reduce((a, b) => a + b, 0) / 100 : ters.length ? (ters.reduce((a, b) => a + b, 0) / ters.length) * 4 / 100 : null,
        };
        const cur = best.get(key);
        if (!cur || row.aum > cur.aum) best.set(key, row);
      }
    }
  }

  const rows = [...best.values()].map((r) => {
    const n = names.get(r.isin);
    const name = [n?.fund ?? r.isin, n?.compartment, n?.cls && !/^CLASE 0$/i.test(n.cls) ? n.cls : null].filter(Boolean).join(" · ");
    const reg = regionsOf.get(r.key);
    let regions: Record<string, number> = {};
    let guess = true;
    if (reg && reg.total > 0 && reg.known / reg.total >= 0.4) {
      for (const [k, v] of Object.entries(reg.w)) regions[k] = Math.round((v / reg.known) * 1000) / 1000;
      guess = false;
    } else {
      const hits = NAME_REGION.filter(([re]) => re.test(`${name} ${r.category ?? ""}`)).map(([, reg]) => reg);
      for (const h of new Set(hits)) regions[h] = 1 / new Set(hits).size;
    }
    return { ...r, name, manager: n?.manager ?? null, regions, guess, assetClass: assetClassOf(r.category ?? "") };
  });
  log(job, "ok", `${rows.length} fondos españoles con datos de la CNMV.`);
  await saveRows(rows.map((r) => ({
    isin: r.isin, source: "cnmv", name: r.name, manager: r.manager, category: r.category, assetClass: r.assetClass, regions: r.regions,
    regionGuess: r.guess, ret1y: r.ret1y, ret3y: null, vol: r.vol, maxDrawdown: null, risk: riskFromVol(r.vol), ter: r.ter, aum: r.aum,
    holders: r.holders, symbol: null, period,
  })));
  return rows.length;
}

function assetClassOf(category: string): string {
  if (/Garantizado|Protecci/i.test(category)) return "guaranteed";
  if (/Monetario/i.test(category)) return "money";
  if (/Mixta|Global/i.test(category)) return "mixed";
  if (/Renta Variable/i.test(category)) return "equity";
  if (/Renta Fija/i.test(category)) return "bond";
  return "other";
}

type Row = {
  isin: string; source: string; name: string; manager: string | null; category: string | null; assetClass: string; regions: Record<string, number>;
  regionGuess: boolean; ret1y: number | null; ret3y: number | null; vol: number | null; maxDrawdown: number | null; risk: number | null;
  ter: number | null; aum: number | null; holders: number | null; symbol: string | null; period: string;
};

async function saveRows(rows: Row[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 400) {
    const part = rows.slice(i, i + 400);
    await base.$executeRawUnsafe(
      `insert into fund_universe (isin, source, name, manager, category, "assetClass", regions, "regionGuess", "ret1y", "ret3y", vol, "maxDrawdown", risk, ter, aum, holders, symbol, period, "updatedAt")
         select *, now() from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::jsonb[], $8::boolean[],
                                     $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::int[], $14::numeric[], $15::numeric[], $16::int[], $17::text[], $18::text[])
       on conflict (isin) do update set source = excluded.source, name = excluded.name, manager = excluded.manager, category = excluded.category,
         "assetClass" = excluded."assetClass", regions = excluded.regions, "regionGuess" = excluded."regionGuess", "ret1y" = excluded."ret1y",
         "ret3y" = excluded."ret3y", vol = excluded.vol, "maxDrawdown" = excluded."maxDrawdown", risk = excluded.risk, ter = excluded.ter,
         aum = excluded.aum, holders = excluded.holders, symbol = excluded.symbol, period = excluded.period, "updatedAt" = now()`,
      part.map((r) => r.isin), part.map((r) => r.source), part.map((r) => r.name), part.map((r) => r.manager), part.map((r) => r.category),
      part.map((r) => r.assetClass), part.map((r) => JSON.stringify(r.regions)), part.map((r) => r.regionGuess), part.map((r) => r.ret1y),
      part.map((r) => r.ret3y), part.map((r) => r.vol), part.map((r) => r.maxDrawdown), part.map((r) => r.risk), part.map((r) => r.ter),
      part.map((r) => r.aum), part.map((r) => r.holders), part.map((r) => r.symbol), part.map((r) => r.period)
    );
  }
}

// ---------------------------------------------------------------- Yahoo (international funds)

async function loadInternational(job: Job): Promise<number> {
  log(job, "info", `Calculando rentabilidad y riesgo de ${INTERNATIONAL.length} fondos y ETFs internacionales (precios de Yahoo)…`);
  const rows: Row[] = [];
  for (const f of INTERNATIONAL) {
    try {
      const t = await tickerForIsin(f.isin, "");
      if (!t) continue;
      const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t.symbol)}?range=3y&interval=1d`, { headers: UA, signal: AbortSignal.timeout(20_000) });
      const r = (await res.json())?.chart?.result?.[0];
      const closes: number[] = (r?.indicators?.adjclose?.[0]?.adjclose ?? r?.indicators?.quote?.[0]?.close ?? []).filter((x: number | null) => x != null && x > 0);
      if (closes.length < 200) continue;
      const last = closes[closes.length - 1];
      const yearAgo = closes[Math.max(0, closes.length - 253)];
      const daily = closes.slice(-253).slice(1).map((c, i, a) => Math.log(c / (i === 0 ? closes[closes.length - 253] : a[i - 1])));
      const mean = daily.reduce((s, x) => s + x, 0) / daily.length;
      const vol = Math.sqrt(daily.reduce((s, x) => s + (x - mean) ** 2, 0) / (daily.length - 1)) * Math.sqrt(252);
      let peak = closes[0], maxDd = 0;
      for (const c of closes) { peak = Math.max(peak, c); maxDd = Math.min(maxDd, c / peak - 1); }
      const years = closes.length / 252;
      rows.push({
        isin: f.isin, source: "yahoo", name: f.name, manager: f.manager, category: f.category, assetClass: f.assetClass,
        regions: f.region === "GLOBAL" ? {} : { [f.region]: 1 }, regionGuess: false,
        ret1y: last / yearAgo - 1, ret3y: years >= 2.5 ? Math.pow(last / closes[0], 1 / years) - 1 : null, vol, maxDrawdown: maxDd,
        risk: riskFromVol(vol), ter: null, aum: null, holders: null, symbol: t.symbol, period: new Date().toISOString().slice(0, 10),
      });
    } catch {
      // one missing fund doesn't stop the rest
    }
    await sleep(200);
  }
  await saveRows(rows);
  log(job, "ok", `${rows.length} fondos internacionales listos.`);
  return rows.length;
}

/** Refreshes the universe when it is missing or older than 35 days. */
async function ensureUniverse(job: Job): Promise<void> {
  const [s] = await q<{ cnmv: number; yahoo: number; fresh: boolean }>(
    `select count(*) filter (where source = 'cnmv')::int as cnmv, count(*) filter (where source = 'yahoo')::int as yahoo,
            coalesce(min("updatedAt") > now() - interval '35 days', false) as fresh from fund_universe`
  );
  if (s.cnmv > 0 && s.yahoo > 0 && s.fresh) {
    log(job, "ok", `Usando los datos guardados: ${s.cnmv.toLocaleString("es-ES")} fondos de la CNMV y ${s.yahoo} internacionales.`);
    return;
  }
  log(job, "info", "Actualizando la base de fondos (una vez al mes)…");
  await loadCnmv(job);
  await loadInternational(job);
}

// ---------------------------------------------------------------- search

/** Share of the fund in the chosen regions (a fund without regions = global). */
function regionShare(regions: Record<string, number>, picked: string[]): number {
  const entries = Object.entries(regions);
  if (!entries.length) return picked.includes("GLOBAL") ? 1 : 0;
  const top = Math.max(...entries.map(([, v]) => v));
  // "Global": diversified funds (no region above 60 %).
  if (picked.includes("GLOBAL") && top < 0.6) return 1;
  return entries.filter(([k]) => picked.includes(k)).reduce((s, [, v]) => s + v, 0);
}

async function search(job: Job, profile: string, picked: string[]): Promise<void> {
  try {
    const levels = PROFILE_RISK[profile];
    const zones = picked.map((r) => REGION_NAME[r as Region] ?? r).join(", ");
    log(job, "ai", `Interpretando tu perfil ${PROFILE_NAME[profile]}: fondos con riesgo ${levels.join(" o ")} de 7 (volatilidad ${volRange(levels)}).`);
    await sleep(600);
    await ensureUniverse(job);
    const all = await q<any>(
      `select isin, source, name, manager, category, "assetClass", regions, "regionGuess", "ret1y"::float as "ret1y", "ret3y"::float as "ret3y",
              vol::float as vol, "maxDrawdown"::float as "maxDrawdown", risk, ter::float as ter, aum::float as aum, holders
         from fund_universe where risk is not null and "ret1y" is not null`
    );
    job.considered = all.length;
    log(job, "info", `Filtrando ${all.length.toLocaleString("es-ES")} fondos por tu nivel de riesgo y por ${zones}…`);
    await sleep(500);
    const fit = all.filter((f) =>
      levels.includes(f.risk) && regionShare(f.regions, picked) >= 0.6 &&
      (f.source === "yahoo" || ((f.aum ?? 0) >= 20e6 && (f.holders ?? 0) >= 200)) && f.assetClass !== "guaranteed"
    );
    job.matched = fit.length;
    if (!fit.length) {
      log(job, "warn", "Ningún fondo encaja con ese riesgo en esas zonas. Prueba a añadir zonas o «Global».");
      job.phase = "done";
      return;
    }
    // Objective pre-selection: return per unit of risk, cheap, big enough.
    for (const f of fit) {
      const sharpe = (f.ret1y - 0.02) / Math.max(f.vol, 0.005);
      f.score = sharpe + (f.ret3y != null ? (f.ret3y - 0.02) / Math.max(f.vol, 0.005) * 0.5 : 0) - (f.ter ?? 0.004) * 50 + Math.log10(Math.max(f.aum ?? 1e8, 1e6)) * 0.05;
    }
    fit.sort((a, b) => b.score - a.score);
    const shortlist = fit.slice(0, 25);
    log(job, "ok", `${fit.length} fondos encajan. Preselección de los 25 con mejor rentabilidad ajustada al riesgo y menores costes.`);

    let picks: Pick[] = [];
    if (geminiConfigured()) {
      log(job, "ai", "La IA analiza la preselección: rentabilidad, riesgo, costes, tamaño y diversificación…");
      try {
        const { data, model } = await askGeminiJson<Array<{ isin: string; reason: string }>>(
          prompt(profile, zones, shortlist),
          { type: "ARRAY", items: { type: "OBJECT", properties: { isin: { type: "STRING" }, reason: { type: "STRING" } }, required: ["isin", "reason"] } },
          (m) => log(job, "ai", `Consultando el modelo ${m}…`)
        );
        job.model = model;
        for (const d of data) {
          const f = shortlist.find((x) => x.isin === d.isin);
          if (f && !picks.some((p) => p.isin === f.isin)) picks.push(toPick(f, d.reason));
          if (picks.length === 5) break;
        }
        log(job, "ok", `La IA (${model}) ha elegido ${picks.length} fondos.`);
      } catch (e: any) {
        log(job, "warn", e instanceof GeminiError && e.kind === "busy" ? "La IA está saturada ahora mismo: se muestran los 5 con mejor puntuación." : `IA no disponible (${e?.message ?? e}): se muestran los 5 con mejor puntuación.`);
      }
    } else {
      log(job, "warn", "Falta la clave de Gemini: se muestran los 5 con mejor puntuación.");
    }
    for (const f of shortlist) {
      if (picks.length >= 5) break;
      if (!picks.some((p) => p.isin === f.isin)) picks.push(toPick(f, autoReason(f)));
    }
    job.picks = picks;
    log(job, "ok", "Listo.");
    job.phase = "done";
  } catch (e: any) {
    log(job, "error", String(e?.message ?? e));
    job.phase = "error";
  }
}

function volRange(levels: number[]): string {
  const edges = [0, 0.5, 2, 5, 10, 15, 25, 100];
  const lo = edges[Math.min(...levels) - 1], hi = edges[Math.max(...levels)];
  return hi >= 100 ? `más de ${lo} %` : `${lo}–${hi} %`;
}

function toPick(f: any, reason: string): Pick {
  return {
    isin: f.isin, name: f.name, manager: f.manager, category: f.category, source: f.source, regions: f.regions, ret1y: f.ret1y,
    ret3y: f.ret3y, vol: f.vol, risk: f.risk, ter: f.ter, aum: f.aum, reason, score: f.score,
  };
}

function autoReason(f: any): string {
  const parts = [`${(f.ret1y * 100).toFixed(1)} % en 12 meses con volatilidad ${(f.vol * 100).toFixed(1)} %`];
  if (f.ter != null) parts.push(`gastos ${(f.ter * 100).toFixed(2)} %`);
  return `Buena relación rentabilidad/riesgo: ${parts.join(", ")}.`;
}

function prompt(profile: string, zones: string, list: any[]): string {
  const rows = list.map((f) => ({
    isin: f.isin, nombre: f.name, gestora: f.manager, categoria: f.category, tipo: f.assetClass,
    zonas: f.regions, rent12m: pctOrNull(f.ret1y), rent3aAnual: pctOrNull(f.ret3y), volatilidad: pctOrNull(f.vol),
    caidaMax3a: pctOrNull(f.maxDrawdown), riesgo1a7: f.risk, gastosAnuales: pctOrNull(f.ter), patrimonioMillones: f.aum ? Math.round(f.aum / 1e6) : null,
    fuente: f.source === "cnmv" ? "CNMV (fondo español)" : "Yahoo (fondo/ETF internacional)",
  }));
  return `Eres un analista que ayuda en un proyecto educativo (no es asesoramiento). Perfil de riesgo del usuario: ${PROFILE_NAME[profile]}.
Zonas en las que quiere invertir: ${zones}.
De esta preselección (ya filtrada por su nivel de riesgo y zonas), elige los 5 fondos que mejor le encajan.
Valora: rentabilidad ajustada al riesgo, costes bajos, tamaño suficiente, estabilidad, y que entre los 5 haya diversificación (no 5 casi iguales).
Desconfía de rentabilidades de 12 meses extraordinarias con poca historia. Prefiere fondos indexados baratos cuando sean comparables.
Para cada uno, "reason": una frase en español (máx. 25 palabras), concreta, con cifras, de por qué encaja con su perfil y zonas.
Responde solo con el JSON: [{"isin": "...", "reason": "..."}], 5 elementos, del mejor al quinto.
Fondos:
${JSON.stringify(rows)}`;
}
const pctOrNull = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 10);

// ---------------------------------------------------------------- routes

export function registerFundFinderRoutes(app: Express): void {
  app.post("/api/v2/fund-finder", handler(async (req, res) => {
    const userId = currentUser() ?? DEFAULT_USER;
    const profile = String(req.body?.profile ?? "");
    if (!PROFILE_RISK[profile]) throw new HttpError(400, "Perfil no válido.");
    const regions = (Array.isArray(req.body?.regions) ? req.body.regions : []).map(String).filter((r: string) => r === "GLOBAL" || (REGIONS as readonly string[]).includes(r));
    if (!regions.length) throw new HttpError(400, "Elige al menos una zona.");
    const job: Job = { id: randomUUID(), userId, phase: "running", events: [], picks: [], model: null, considered: 0, matched: 0 };
    jobs.set(job.id, job);
    void search(job, profile, regions);
    res.status(202).json({ jobId: job.id });
  }));

  app.get("/api/v2/fund-finder/:id", handler(async (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.userId !== (currentUser() ?? DEFAULT_USER)) throw new HttpError(404, "Búsqueda no encontrada.");
    const after = Number(req.query.after ?? -1);
    res.json({ ...job, events: job.events.filter((e) => e.n > after) });
  }));

  // Saved funds (supabase/saved-funds.sql): the user keeps picks per profile and sees them on the page.
  app.get("/api/v2/saved-funds", handler(async (_req, res) => {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `select id, isin, profile, zones, data, "createdAt" from saved_funds order by "createdAt" desc`
    );
    res.json(rows);
  }));

  // Saves one or more picks for a profile (again = refresh the photo, keeps one row per fund and profile).
  app.post("/api/v2/saved-funds", handler(async (req, res) => {
    const profile = String(req.body?.profile ?? "");
    if (!PROFILE_RISK[profile]) throw new HttpError(400, "Perfil no válido.");
    const zones = (Array.isArray(req.body?.zones) ? req.body.zones : []).map(String).slice(0, 10);
    const picks = (Array.isArray(req.body?.picks) ? req.body.picks : []).filter((p: any) => p && typeof p.isin === "string" && p.name);
    if (!picks.length || picks.length > 10) throw new HttpError(400, "Nada que guardar.");
    for (const p of picks) {
      await prisma.$executeRawUnsafe(
        `insert into saved_funds (isin, profile, zones, data) values ($1, $2, $3::text[], $4::jsonb)
         on conflict ("userId", isin, profile) do update set zones = excluded.zones, data = excluded.data, "createdAt" = now()`,
        p.isin.slice(0, 20), profile, zones, JSON.stringify(p)
      );
    }
    res.json({ saved: picks.length });
  }));

  app.delete("/api/v2/saved-funds/:id", handler(async (req, res) => {
    await prisma.$executeRawUnsafe(`delete from saved_funds where id = $1`, String(req.params.id));
    res.json({ ok: true });
  }));
}
