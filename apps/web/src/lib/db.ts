import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma, against whichever database DATABASE_URL points at.
 *
 *   development  MySQL on localhost, through the MariaDB driver adapter
 *   production   Neon Postgres, through Neon's serverless adapter
 *
 * Prisma 7 takes a driver adapter rather than a connection string, which is
 * what makes one client work across both: the adapter is chosen from the URL
 * scheme, imported dynamically so the unused driver never enters the bundle.
 * The schema itself is derived per provider — see scripts/prisma-schema.mjs.
 *
 * `withDb` is the only way in. It returns the fallback when no database is
 * configured or a query fails, because analytics and the panel are
 * observability: they must never take a page down.
 */

const URL_ = process.env.DATABASE_URL;

export const dbConfigured = Boolean(URL_);

/** "mysql" | "postgresql" — also decides which SQL dialect raw queries use. */
export const dialect: "mysql" | "postgresql" = URL_?.startsWith("mysql")
  ? "mysql"
  : "postgresql";

async function create(): Promise<PrismaClient | null> {
  if (!URL_) return null;

  const { PrismaClient } = await import("@/generated/prisma/client");

  if (dialect === "mysql") {
    const { PrismaMariaDb } = await import("@prisma/adapter-mariadb");
    return new PrismaClient({ adapter: new PrismaMariaDb(URL_) });
  }

  const { PrismaNeon } = await import("@prisma/adapter-neon");
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: URL_ }) });
}

// Cached on globalThis so hot reload in development does not leak a client per
// edit, and so a warm serverless instance reuses its connection.
const globalForPrisma = globalThis as unknown as {
  __twPrisma?: Promise<PrismaClient | null>;
};

function getPrisma(): Promise<PrismaClient | null> {
  globalForPrisma.__twPrisma ??= create();
  return globalForPrisma.__twPrisma;
}

export async function withDb<T>(
  fn: (client: PrismaClient) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!URL_) return fallback;
  try {
    const client = await getPrisma();
    if (!client) return fallback;
    return await fn(client);
  } catch (error) {
    console.error("[db]", error);
    return fallback;
  }
}
