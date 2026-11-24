import { Express } from "express";
import { prisma } from "./prisma";
import { handler } from "./portfolio";

// News board (see supabase/news.sql). Items and digests are written by back/scripts/news-save.js
// from the scheduled news tasks; the app only reads them.

export function registerNewsRoutes(app: Express): void {
  app.get("/api/v2/news", handler(async (req, res) => {
    const days = Math.min(365, Math.max(7, Number(req.query.days) || 60));
    const items = await prisma.$queryRawUnsafe(
      `select id, "assetId", "assetName", scope, tier, title, summary, impact, sentiment, source, url,
              to_char("publishedAt", 'YYYY-MM-DD') as "publishedAt", "createdAt"
         from news_items
        where "publishedAt" >= (now() at time zone 'Europe/Madrid')::date - $1::int
        order by "publishedAt" desc, case tier when 'important' then 0 when 'minor' then 1 else 2 end, "createdAt" desc`,
      days
    );
    const digests = await prisma.$queryRawUnsafe(
      `select id, to_char("weekStart", 'YYYY-MM-DD') as "weekStart", headline, body
         from news_digests order by "weekStart" desc limit 12`
    );
    res.json({ items, digests });
  }));
}
