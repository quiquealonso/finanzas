// Prisma client for the scripts, scoped to one user like the app (see src/prisma.ts and supabase/users.sql):
// every raw query runs as role finanzas_app with app.user_id set, so it only sees and writes that user's rows.
// User: FINANZAS_USER environment variable, user1 by default (the owner of the news task).
const { createClient } = require("./prisma-client");

const SCOPE = `select set_config('app.user_id', $1, true), set_config('role', 'finanzas_app', true)`;

function userClient(userId = process.env.FINANZAS_USER || "user1") {
  const prisma = createClient();
  const scoped = (query) => prisma.$transaction([prisma.$executeRawUnsafe(SCOPE, userId), query]).then((r) => r[1]);
  return {
    userId,
    $queryRawUnsafe: (...args) => scoped(prisma.$queryRawUnsafe(...args)),
    $executeRawUnsafe: (...args) => scoped(prisma.$executeRawUnsafe(...args)),
    $disconnect: () => prisma.$disconnect(),
  };
}

module.exports = { userClient };
