import { defineConfig, env } from "prisma/config";

// Prisma 7 dropped implicit .env loading, so the CLI would not see a local
// DATABASE_URL. Node loads it without a dependency; on Vercel there is no .env
// file and the variable is already in the environment.
try {
  process.loadEnvFile();
} catch {
  /* no .env file — the environment is expected to carry the variable */
}

/**
 * Prisma CLI configuration.
 *
 * The schema pointed at here is the *derived* one — `scripts/prisma-schema.mjs`
 * writes it from `prisma/schema.prisma` with the datasource provider matched to
 * whatever DATABASE_URL points at (MySQL in development, Postgres in
 * production). Editing the derived file is pointless; edit the canonical one.
 *
 * Prisma 7 no longer reads the connection URL from the schema, so it is
 * supplied here for migrate/push/studio. The client gets a driver adapter
 * instead — see src/lib/db.ts.
 */
export default defineConfig({
  schema: "prisma/schema.generated.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    path: "prisma/migrations",
  },
});
