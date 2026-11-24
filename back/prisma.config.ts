// Prisma 7 configuration (before: "prisma" in package.json and url/directUrl in schema.prisma).
// The CLI (generate, db execute…) uses the DIRECT connection; the app connects through src/prisma.ts (pooler).
// Prisma 7 does not read .env by itself: dotenv loads it here.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node prisma/seed.ts",
  },
  datasource: {
    // Optional: CI only runs `prisma generate`, which needs no database.
    url: process.env.DIRECT_URL ?? "",
  },
});
