// Prints, as JSON, the positions the scheduled news tasks have to follow, with their weight in the portfolio,
// plus the news already saved recently (to avoid repeating them).
// Usage (from back/): node scripts/news-positions.js [days=21] [full]
// "full" adds the summary and impact of each saved news item (for the weekly digest).
require("dotenv").config({ path: __dirname + "/../.env", quiet: true });
const { userClient } = require("./user-client");

// Funds whose managers pick the companies (their letters and moves hint at their thesis). Index funds are skipped.
const ACTIVE_FUNDS = ["Azvalor Internacional", "Horos Value Internacional", "MyInvestor Value"];

(async () => {
  const prisma = userClient(); // only the news user's positions and news
  const days = Number(process.argv[2]) || 21;
  try {
    const rows = await prisma.$queryRawUnsafe(`
      with d as (select max(date) as d from daily_asset_snapshots)
      select a.id, a.name, a."marketSymbol" as symbol, t.code as type, b.name as bank, s."valueEur"::float as value,
             to_char(d.d, 'YYYY-MM-DD') as day
        from daily_asset_snapshots s
        join d on s.date = d.d
        join assets a on a.id = s."assetId"
        join asset_types t on t.id = a."assetTypeId"
        left join banks b on b.id = a."bankId"
       where s."valueEur" > 0`);
    const total = rows.reduce((s, r) => s + r.value, 0);
    const pct = (v) => Math.round((v / total) * 10000) / 100;

    // Same company in two banks = one position.
    const stocks = new Map();
    for (const r of rows.filter((r) => r.type === "STOCK")) {
      const key = r.symbol || r.name;
      const cur = stocks.get(key) ?? { assetId: r.id, name: r.name, symbol: r.symbol, banks: [], valueEur: 0 };
      cur.banks.push(r.bank);
      cur.valueEur += r.value;
      stocks.set(key, cur);
    }
    const stockList = [...stocks.values()]
      .map((s) => ({ ...s, valueEur: Math.round(s.valueEur), weightPct: pct(s.valueEur) }))
      .sort((a, b) => b.valueEur - a.valueEur);
    const funds = rows
      .filter((r) => r.type === "FUND" && ACTIVE_FUNDS.includes(r.name))
      .map((r) => ({ assetId: r.id, name: r.name, symbol: r.symbol, valueEur: Math.round(r.value), weightPct: pct(r.value) }))
      .sort((a, b) => b.valueEur - a.valueEur);

    const full = process.argv[3] === "full";
    const recent = await prisma.$queryRawUnsafe(
      `select "assetName", scope, tier, title, url, sentiment${full ? ", summary, impact" : ""}, to_char("publishedAt", 'YYYY-MM-DD') as "publishedAt"
         from news_items where "publishedAt" >= current_date - $1::int order by "publishedAt" desc`,
      days
    );
    // The active funds are reviewed once a month: in the first weekly run of a month without a fund review.
    const [{ due }] = await prisma.$queryRawUnsafe(`
      select not exists (
        select 1 from news_digests
         where "fundsChecked"
           and date_trunc('month', "createdAt" at time zone 'Europe/Madrid') = date_trunc('month', now() at time zone 'Europe/Madrid')
      ) as due`);
    console.log(JSON.stringify({
      snapshotDay: rows[0]?.day ?? null,
      fundsDue: due,
      portfolioEur: Math.round(total),
      stocks: stockList,
      activeFunds: funds,
      recentNews: recent
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
