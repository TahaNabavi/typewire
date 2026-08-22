import { NextResponse } from "next/server";

import { getRepoStats } from "@/features/project-status/github";
import { getWeeklyDownloadsFor } from "@/features/project-status/npm";
import { withDb } from "@/lib/db";
import { publishedPackages } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Daily snapshot of numbers that cannot be backfilled.
 *
 * GitHub will tell you today's star count and npm today's download count;
 * neither will tell you last month's. One row per day is the only way to have
 * a trend line a year from now.
 *
 * Scheduled by vercel.json. Vercel signs cron requests with CRON_SECRET when it
 * is set — anything else is rejected so the route cannot be poked from outside.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const [stats, downloads] = await Promise.all([
    getRepoStats(),
    getWeeklyDownloadsFor(publishedPackages.map((p) => p.npm)),
  ]);

  const downloadMap: Record<string, number> = {};
  for (const entry of downloads) {
    if (entry.downloads !== null) downloadMap[entry.pkg] = entry.downloads;
  }

  // Midnight UTC — the column is a date, and re-running the cron must land on
  // the same row rather than creating a second one for the same day.
  const day = new Date(new Date().toISOString().slice(0, 10));

  const record = {
    stars: stats.data.stars,
    forks: stats.data.forks,
    openIssues: stats.data.openIssues,
    downloads: downloadMap,
  };

  const stored = await withDb(async (db) => {
    await db.snapshot.upsert({
      where: { day },
      create: { day, ...record },
      update: record,
    });
    return true;
  }, false);

  return NextResponse.json({
    ok: true,
    stored,
    stale: stats.stale,
    packages: Object.keys(downloadMap).length,
  });
}
