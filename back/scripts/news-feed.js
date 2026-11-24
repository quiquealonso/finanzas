// Collects candidate headlines for every stock (and active fund) in the portfolio from news aggregators,
// so the scheduled news task starts from a wide net instead of a few web searches:
//   - Google News RSS in Spanish and English (Expansión, Cinco Días, El Economista, Reuters, Bloomberg, CNBC...)
//   - Yahoo Finance news by ticker (press releases from GlobeNewswire / Business Wire, Motley Fool, Zacks...)
// Each position also lists its own investor-relations page and regulator to check by hand.
// Headlines already saved in news_items are left out.
// Usage (from back/): node scripts/news-feed.js [days=2] [stocks|funds] [--to-yesterday] [--text <refs.json>]
//   --to-yesterday  leave out today's headlines (the weekly run covers Thursday to Wednesday).
//   --text <file>   print a compact list (key | date | source | title) instead of JSON, and write the
//                   full headlines to <file>; news-save.js --refs <file> fills url/source/date from each "ref" key.
//                   Saves many tokens: Google News URLs are long.
require("dotenv").config({ path: __dirname + "/../.env", quiet: true });
const { userClient } = require("./user-client");

// Search terms and official sources per position (key = market symbol, or name when there is none).
// q: Google News queries; es/en: which editions to read; ir: company investor page; reg: regulator filings.
const SOURCES = {
  "BBVA.MC": { q: ['"BBVA" (acciones OR resultados OR dividendo OR recompra OR OPA OR Sabadell OR Garanti OR México OR beneficio OR CNMV) -estadio -liga -futbol', '"BBVA" (shares OR earnings OR buyback OR dividend OR Garanti OR Mexico)'], es: true, en: true, ir: "https://shareholdersandinvestors.bbva.com/", reg: "CNMV: https://www.cnmv.es (Otra información relevante, BBVA)" },
  "SAN.MC": { q: ['"Santander" (acciones OR resultados OR dividendo OR recompra OR Webster OR TSB OR beneficio OR Botín OR CNMV) -Racing -lotería', '"Banco Santander" (shares OR earnings OR buyback OR Webster OR TSB)'], es: true, en: true, ir: "https://www.santander.com/es/accionistas-e-inversores", reg: "CNMV (Banco Santander)" },
  ONDS: { q: ['"Ondas Holdings"', '"Ondas" drones'], en: true, ir: "https://ir.ondas.com/press-releases", reg: "SEC EDGAR 8-K (ONDS)" },
  ABCL: { q: ['"AbCellera"'], en: true, ir: "https://investors.abcellera.com/", reg: "SEC EDGAR (ABCL)" },
  "NXT.MC": { q: ['"Nextil"', '"Nextil" textil acciones'], es: true, ir: "https://www.nextil.com/", reg: "CNMV (Nextil)" },
  NVDA: { q: ['"Nvidia"'], en: true, es: true, ir: "https://nvidianews.nvidia.com/", reg: "SEC EDGAR (NVDA)" },
  "WIZZ.L": { q: ['"Wizz Air"'], en: true, es: true, ir: "https://corporate.wizzair.com/en-GB/investor_relations", reg: "LSE RNS (WIZZ)" },
  UNH: { q: ['"UnitedHealth"'], en: true, ir: "https://www.unitedhealthgroup.com/newsroom.html", reg: "SEC EDGAR (UNH)" },
  OSCR: { q: ['"Oscar Health"'], en: true, ir: "https://ir.hioscar.com/", reg: "SEC EDGAR (OSCR)" },
  MOH: { q: ['"Molina Healthcare"'], en: true, ir: "https://investors.molinahealthcare.com/", reg: "SEC EDGAR (MOH)" },
  BIDU: { q: ['"Baidu"'], en: true, ir: "https://ir.baidu.com/", reg: "SEC EDGAR 6-K (BIDU) / HKEX 9888" },
  "OHLA.MC": { q: ['"OHLA"'], es: true, ir: "https://www.ohla-group.com/accionistas-e-inversores/", reg: "CNMV (OHLA / Obrascón Huarte Lain)" },
  "TEF.MC": { q: ['"Telefónica" (acciones OR resultados OR dividendo OR Murtra OR compra OR venta OR CNMV OR deuda)'], es: true, en: true, ir: "https://www.telefonica.com/es/accionistas-inversores/", reg: "CNMV (Telefónica)" },
  "N9J.F": { q: ['"NagaCorp"', '"NagaWorld" (casino OR revenue OR Cambodia OR shares)'], en: true, ir: "https://www.nagacorp.com/", reg: "HKEXnews (3918)" },
  PDD: { q: ['"PDD Holdings"', '"Temu" PDD'], en: true, ir: "https://investor.pddholdings.com/", reg: "SEC EDGAR 6-K (PDD)" },
  NVAX: { q: ['"Novavax"'], en: true, ir: "https://ir.novavax.com/press-releases", reg: "SEC EDGAR (NVAX)" },
  "AMP.MC": { q: ['"Amper" empresa', '"Grupo Amper"'], es: true, ir: "https://www.grupoamper.com/", reg: "CNMV (Amper)" },
  JD: { q: ['"JD.com"'], en: true, ir: "https://ir.jd.com/", reg: "SEC EDGAR 6-K (JD) / HKEX 9618" },
  "TPG0.DE": { q: ['"The Platform Group"'], en: true, es: false, de: true, ir: "https://www.the-platform-group.com/investor-relations", reg: "EQS ad-hoc (The Platform Group)" },
  // Active funds (monthly task).
  "Azvalor Internacional": { q: ['"Azvalor"', '"Álvaro Guzmán de Lázaro"'], es: true, ir: "https://www.azvalor.com/", reg: "Cartas trimestrales en azvalor.com" },
  "Horos Value Internacional": { q: ['"Horos Asset Management"', '"Horos Value"', '"Javier Ruiz" Horos'], es: true, ir: "https://horosam.com/", reg: "Cartas trimestrales en horosam.com" },
  "MyInvestor Value": { q: ['"MyInvestor Value"'], es: true, ir: "https://myinvestor.es/", reg: "Informes CNMV del fondo" }
};

const EDITIONS = {
  es: "hl=es&gl=ES&ceid=ES:es",
  en: "hl=en-US&gl=US&ceid=US:en",
  de: "hl=de&gl=DE&ceid=DE:de"
};

const decode = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "").trim();
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1]) : null; };
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const norm = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (news-reader)" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function googleNews(query, edition, days) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:${days}d`)}&${EDITIONS[edition]}`;
  const xml = await get(url);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const source = tag(it, "source");
    let title = tag(it, "title") ?? "";
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return { title, source, url: tag(it, "link"), date: iso(tag(it, "pubDate")), via: `google-${edition}` };
  });
}

async function yahooNews(symbol) {
  const json = JSON.parse(await get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=15&quotesCount=0`));
  return (json.news ?? []).map((n) => ({ title: n.title, source: n.publisher, url: n.link, date: iso(n.providerPublishTime * 1000), via: "yahoo" }));
}

(async () => {
  const args = process.argv.slice(2);
  const flag = (name) => args.indexOf(name);
  const textAt = flag("--text");
  const refsPath = textAt >= 0 ? args[textAt + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith("--") && !(textAt >= 0 && i === textAt + 1));
  const days = Number(positional[0]) || 2;
  const which = positional[1] || "stocks";
  const today = iso(Date.now());
  const toYesterday = flag("--to-yesterday") >= 0;
  const prisma = userClient(); // only the news user's positions and news
  try {
    const rows = await prisma.$queryRawUnsafe(`
      with d as (select max(date) as d from daily_asset_snapshots)
      select a.id, a.name, a."marketSymbol" as symbol, t.code as type, s."valueEur"::float as value
        from daily_asset_snapshots s join d on s.date = d.d
        join assets a on a.id = s."assetId" join asset_types t on t.id = a."assetTypeId"
       where s."valueEur" > 0`);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const wanted = new Map();
    for (const r of rows) {
      const key = r.type === "STOCK" ? r.symbol || r.name : r.name;
      const isFund = r.type === "FUND" && SOURCES[r.name];
      if (which === "stocks" ? r.type !== "STOCK" : !isFund) continue;
      const cur = wanted.get(key) ?? { assetId: r.id, name: r.name, symbol: r.symbol, valueEur: 0 };
      cur.valueEur += r.value;
      wanted.set(key, cur);
    }
    const saved = await prisma.$queryRawUnsafe(`select url, title from news_items where "publishedAt" >= current_date - 30`);
    const seenUrls = new Set(saved.map((s) => s.url));
    const seenTitles = new Set(saved.map((s) => norm(s.title)));

    const since = iso(Date.now() - days * 86400000);
    const out = [];
    const failures = [];
    for (const [key, pos] of [...wanted.entries()].sort((a, b) => b[1].valueEur - a[1].valueEur)) {
      const src = SOURCES[key] ?? { q: [`"${pos.name}"`], en: true, es: true };
      const jobs = [];
      for (const q of src.q) for (const ed of ["es", "en", "de"]) if (src[ed]) jobs.push(googleNews(q, ed, days).catch((e) => (failures.push(e.message), [])));
      if (which === "stocks" && pos.symbol) jobs.push(yahooNews(pos.symbol).catch((e) => (failures.push(e.message), [])));
      const found = (await Promise.all(jobs)).flat().filter((n) => n.title && n.url && n.date >= since && (!toYesterday || n.date < today));
      const byTitle = new Map();
      for (const n of found) {
        const k = norm(n.title);
        if (seenUrls.has(n.url) || seenTitles.has(k) || byTitle.has(k)) continue;
        byTitle.set(k, n);
      }
      out.push({
        assetId: pos.assetId,
        name: pos.name,
        symbol: pos.symbol,
        weightPct: Math.round((pos.valueEur / total) * 10000) / 100,
        investorPage: src.ir ?? null,
        regulator: src.reg ?? null,
        headlines: [...byTitle.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60)
      });
    }
    if (!refsPath) {
      console.log(JSON.stringify({ since, positions: out, failures: failures.slice(0, 10) }, null, 1));
      return;
    }
    const refs = {};
    const lines = [`since ${since}${toYesterday ? ` to ${iso(Date.now() - 86400000)}` : ""}`];
    let k = 0;
    for (const p of out) {
      lines.push("", `## ${p.name} | assetId ${p.assetId} | ${p.weightPct} % | IR ${p.investorPage ?? "-"} | REG ${p.regulator ?? "-"}`);
      if (!p.headlines.length) lines.push("(sin titulares)");
      for (const h of p.headlines) {
        const key = `k${++k}`;
        refs[key] = { url: h.url, source: h.source, publishedAt: h.date, assetId: p.assetId, assetName: p.name };
        lines.push(`${key} ${h.date.slice(5)} ${(h.source ?? "").slice(0, 22)} | ${h.title}`);
      }
    }
    if (failures.length) lines.push("", "failures: " + failures.slice(0, 10).join("; "));
    require("fs").writeFileSync(refsPath, JSON.stringify(refs));
    console.log(lines.join("\n"));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
