// Prisma client for the scripts (Prisma 7: connects through the pg driver adapter, like src/prisma.ts → createClient).
// Loads back/.env. Uses DIRECT_URL (Supabase pooler in session mode): see src/prisma.ts → createClient for why.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

function createClient(url = process.env.DIRECT_URL || process.env.DATABASE_URL) {
  if (!url) throw new Error("Falta DIRECT_URL en back/.env");
  const u = new URL(url);
  for (const option of ["pgbouncer", "connection_limit", "pool_timeout", "schema"]) u.searchParams.delete(option);
  const adapter = new PrismaPg({ connectionString: u.toString(), ssl: { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 10_000 });
  return new PrismaClient({ adapter, transactionOptions: { maxWait: 10_000, timeout: 60_000 } });
}

module.exports = { createClient };
