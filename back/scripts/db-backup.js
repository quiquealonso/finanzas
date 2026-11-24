// Full data backup of the public schema, without pg_dump.
//
//   node scripts/db-backup.js
//
// Writes backups/db_<YYYY-MM-DD_HHmm>/ at the project root with:
//   - <table>.json      every row of every table in the public schema
//   - _columns.json     column names, types, nullability and defaults per table
//   - schema.prisma     copy of the Prisma schema
//   - supabase/*.sql    copy of the extra SQL files (tables created outside Prisma)
// Restore: recreate the schema (prisma db push + supabase/*.sql) and insert the rows back.
require("dotenv").config({ path: __dirname + "/../.env", quiet: true });
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, 16).replace(" ", "_").replace(":", "");
  const dir = path.join(__dirname, "..", "..", "backups", `db_${stamp}`);
  fs.mkdirSync(path.join(dir, "supabase"), { recursive: true });
  try {
    const tables = await prisma.$queryRawUnsafe(
      `select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`
    );
    const columns = await prisma.$queryRawUnsafe(
      `select table_name, column_name, data_type, is_nullable, column_default
         from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`
    );
    fs.writeFileSync(path.join(dir, "_columns.json"), JSON.stringify(columns, null, 1));
    const counts = {};
    for (const { name } of tables) {
      // Cast every row to json in the DB so numerics and dates keep their exact text.
      const rows = await prisma.$queryRawUnsafe(`select coalesce(json_agg(t), '[]'::json) as rows from public."${name}" t`);
      fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows[0].rows));
      counts[name] = rows[0].rows.length;
    }
    fs.copyFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), path.join(dir, "schema.prisma"));
    const sqlDir = path.join(__dirname, "..", "supabase");
    for (const f of fs.readdirSync(sqlDir)) if (f.endsWith(".sql")) fs.copyFileSync(path.join(sqlDir, f), path.join(dir, "supabase", f));
    console.log(JSON.stringify({ dir, tables: Object.keys(counts).length, rows: Object.values(counts).reduce((a, b) => a + b, 0), counts }, null, 1));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
