// Saves news found by the scheduled tasks. Input: a JSON file with
//   { "items": [ { assetId?, assetName?, scope: "daily"|"monthly", tier: "important"|"minor"|"low",
//                  title, summary?, impact?, sentiment?: "up"|"down"|"neutral", source?, url, publishedAt: "YYYY-MM-DD" } ],
//     "digest": { weekStart: "YYYY-MM-DD" (a Monday), headline, body } }
// Both keys optional. Items with a URL already saved are skipped; the digest of a week is replaced.
// An item may carry "ref": "k12" instead of url/source/publishedAt/assetId/assetName: they are taken from the
// refs file written by news-feed.js --text (fields given in the item win).
// The digest may carry "fundsChecked": true when that run also reviewed the active funds.
// Usage (from back/): node scripts/news-save.js path/to/file.json [--refs path/to/refs.json]
require("dotenv").config({ path: __dirname + "/../.env", quiet: true });
const fs = require("fs");
const { userClient } = require("./user-client");

const TIERS = ["important", "minor", "low"];
const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "")) && !Number.isNaN(Date.parse(v));
const text = (v, max) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));

(async () => {
  const file = process.argv[2];
  if (!file) throw new Error("Falta el fichero JSON.");
  const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const refsAt = process.argv.indexOf("--refs");
  const refs = refsAt > 0 ? JSON.parse(fs.readFileSync(process.argv[refsAt + 1], "utf8")) : {};
  const prisma = userClient(); // only the news user's positions and news
  let saved = 0, skipped = 0, rejected = [];
  try {
    for (const raw of data.items ?? []) {
      const ref = raw.ref ? refs[raw.ref] : null;
      if (raw.ref && !ref) { rejected.push(`${raw.title ?? "?"} (ref ${raw.ref} desconocida)`); continue; }
      const it = { ...(ref ?? {}), ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v != null)) };
      const problem =
        !TIERS.includes(it.tier) ? "tier" :
        !text(it.title, 300) ? "title" :
        !/^https?:\/\//.test(String(it.url ?? "")) ? "url" :
        !day(it.publishedAt) ? "publishedAt" : null;
      if (problem) { rejected.push(`${it.title ?? "?"} (${problem})`); continue; }
      let assetId = it.assetId || null;
      if (assetId) {
        const found = await prisma.$queryRawUnsafe(`select 1 from assets where id = $1`, assetId);
        if (!found.length) assetId = null;
      }
      const n = await prisma.$executeRawUnsafe(
        `insert into news_items ("assetId", "assetName", scope, tier, title, summary, impact, sentiment, source, url, "publishedAt")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::date)
         on conflict ("userId", url) do nothing`,
        assetId, text(it.assetName, 80), it.scope === "monthly" ? "monthly" : "daily", it.tier,
        text(it.title, 300), text(it.summary, 1500), text(it.impact, 800),
        ["up", "down", "neutral"].includes(it.sentiment) ? it.sentiment : null,
        text(it.source, 80), String(it.url).trim(), it.publishedAt
      );
      n ? saved++ : skipped++;
    }
    const d = data.digest;
    if (d) {
      if (!day(d.weekStart) || !text(d.headline, 200) || !text(d.body, 20000)) throw new Error("Resumen semanal no valido.");
      await prisma.$executeRawUnsafe(
        `insert into news_digests ("weekStart", headline, body, "fundsChecked") values ($1::date, $2, $3, $4)
         on conflict ("userId", "weekStart") do update set headline = excluded.headline, body = excluded.body,
           "fundsChecked" = news_digests."fundsChecked" or excluded."fundsChecked", "createdAt" = now()`,
        d.weekStart, text(d.headline, 200), text(d.body, 20000), d.fundsChecked === true
      );
    }
    console.log(JSON.stringify({ saved, skipped, rejected, digest: Boolean(d) }));
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
