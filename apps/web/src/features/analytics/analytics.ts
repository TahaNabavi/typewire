import { dialect, withDb } from "@/lib/db";
import { parseScored, redis } from "@/lib/redis";

/**
 * Cookieless analytics.
 *
 * A visitor is sha256(ip + user-agent + secret + UTC date), truncated. That
 * counts returning-within-a-day without storing anything that identifies a
 * person, and the identifier becomes uncorrelatable at midnight when the date
 * component rolls over. No cookie is set, so no consent banner is owed.
 *
 * Redis carries the live counters the panel reads on every load; Postgres
 * carries the rows the history is drawn from.
 */

const SALT = process.env.ANALYTICS_SALT ?? "typewire-dev-salt";

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function visitorHash(ip: string, userAgent: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${userAgent}|${SALT}|${today()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Coarse device class — enough to answer "is anyone reading this on a phone". */
export function deviceFrom(userAgent: string): "mobile" | "tablet" | "desktop" | "bot" {
  const ua = userAgent.toLowerCase();
  if (/bot|crawler|spider|crawling|headless|lighthouse|preview/.test(ua)) return "bot";
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobi|android|iphone/.test(ua)) return "mobile";
  return "desktop";
}

/** Referrer host only — the full URL is more than the panel ever needs. */
export function referrerHost(referrer: string | null, selfHost: string): string {
  if (!referrer) return "direct";
  try {
    const host = new URL(referrer).host;
    return !host || host === selfHost ? "direct" : host;
  } catch {
    return "direct";
  }
}

export interface PageviewInput {
  path: string;
  referrer: string;
  country: string;
  device: string;
  visitor: string;
}

/** 90 days of live counters; Postgres keeps the rest. */
const COUNTER_TTL = 60 * 60 * 24 * 90;

export async function recordPageview(view: PageviewInput): Promise<void> {
  const day = today();

  await redis.pipeline([
    ["INCR", "pv:total"],
    ["INCR", `pv:day:${day}`],
    ["PFADD", `uniq:day:${day}`, view.visitor],
    ["ZINCRBY", `pv:paths:${day}`, 1, view.path],
    ["ZINCRBY", `pv:refs:${day}`, 1, view.referrer],
    ["ZINCRBY", `pv:countries:${day}`, 1, view.country],
    ["ZINCRBY", `pv:devices:${day}`, 1, view.device],
    ["EXPIRE", `pv:day:${day}`, COUNTER_TTL],
    ["EXPIRE", `uniq:day:${day}`, COUNTER_TTL],
    ["EXPIRE", `pv:paths:${day}`, COUNTER_TTL],
    ["EXPIRE", `pv:refs:${day}`, COUNTER_TTL],
    ["EXPIRE", `pv:countries:${day}`, COUNTER_TTL],
    ["EXPIRE", `pv:devices:${day}`, COUNTER_TTL],
  ]);

  await withDb(async (db) => {
    await db.pageview.create({
      data: {
        path: view.path,
        referrer: view.referrer,
        country: view.country,
        device: view.device,
        visitor: view.visitor,
      },
    });
    return true;
  }, false);
}

export interface DayPoint {
  day: string;
  views: number;
  visitors: number;
}

/** Counts come back as bigint on both engines; the chart wants numbers. */
function toDayPoints(rows: Array<Record<string, unknown>>): DayPoint[] {
  return rows.map((row) => ({
    day: String(row.day),
    views: Number(row.views),
    visitors: Number(row.visitors),
  }));
}

/**
 * The panel's chart.
 *
 * Bucketing by day is the one thing Prisma's groupBy cannot express, so it is
 * raw SQL — and raw SQL is where two providers stop being interchangeable. Both
 * dialects are written here, next to each other, so a change to one is an
 * obvious omission if it is not made to the other. This function and `totals`
 * are the *only* two places in the app that know which database it is talking
 * to; everything else goes through Prisma's query API.
 */
export async function viewsByDay(days = 30): Promise<DayPoint[]> {
  return withDb(async (db) => {
    const rows =
      dialect === "mysql"
        ? await db.$queryRaw<Array<Record<string, unknown>>>`
            select date_format(ts, '%Y-%m-%d') as day,
                   count(*)                    as views,
                   count(distinct visitor)     as visitors
            from pageview
            where ts > date_sub(now(), interval ${days} day)
              and device <> 'bot'
            group by 1
            order by 1
          `
        : await db.$queryRaw<Array<Record<string, unknown>>>`
            select to_char(date_trunc('day', ts), 'YYYY-MM-DD') as day,
                   count(*)                                     as views,
                   count(distinct visitor)                      as visitors
            from pageview
            where ts > now() - make_interval(days => ${days})
              and device <> 'bot'
            group by 1
            order by 1
          `;
    return toDayPoints(rows);
  }, []);
}

export interface Ranked {
  label: string;
  count: number;
}

async function rankedToday(key: string, limit: number): Promise<Ranked[]> {
  const flat = await redis.zrevrange(`${key}:${today()}`, limit);
  return parseScored(flat).map((s) => ({ label: s.member, count: s.score }));
}

/** Live "today" rankings, straight from Redis. */
export async function todayBreakdown(limit = 8) {
  const [paths, referrers, countries, devices, views, visitors] = await Promise.all([
    rankedToday("pv:paths", limit),
    rankedToday("pv:refs", limit),
    rankedToday("pv:countries", limit),
    rankedToday("pv:devices", limit),
    redis.get(`pv:day:${today()}`),
    redis.pfcount(`uniq:day:${today()}`),
  ]);

  return { paths, referrers, countries, devices, views: Number(views ?? 0), visitors: visitors ?? 0 };
}

function since(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Longer-range rankings come from Postgres, which keeps every row. */
export async function topPaths(days = 30, limit = 10): Promise<Ranked[]> {
  return withDb(async (db) => {
    const rows = await db.pageview.groupBy({
      by: ["path"],
      where: { ts: { gt: since(days) }, device: { not: "bot" } },
      _count: { path: true },
      orderBy: { _count: { path: "desc" } },
      take: limit,
    });
    return rows.map((row) => ({ label: row.path, count: row._count.path }));
  }, []);
}

export async function topReferrers(days = 30, limit = 10): Promise<Ranked[]> {
  return withDb(async (db) => {
    const rows = await db.pageview.groupBy({
      by: ["referrer"],
      where: { ts: { gt: since(days) }, device: { not: "bot" } },
      _count: { referrer: true },
      orderBy: { _count: { referrer: "desc" } },
      take: limit,
    });
    return rows.map((row) => ({ label: row.referrer ?? "direct", count: row._count.referrer }));
  }, []);
}

export interface Totals {
  views: number;
  visitors: number;
  days: number;
}

const NO_TOTALS: Totals = { views: 0, visitors: 0, days: 0 };

/** The second and last dialect-aware query — see the note on `viewsByDay`. */
export async function totals(): Promise<Totals> {
  return withDb(async (db) => {
    const rows =
      dialect === "mysql"
        ? await db.$queryRaw<Array<Record<string, unknown>>>`
            select count(*)                        as views,
                   count(distinct visitor)         as visitors,
                   coalesce(datediff(now(), min(ts)), 0) as days
            from pageview
            where device <> 'bot'
          `
        : await db.$queryRaw<Array<Record<string, unknown>>>`
            select count(*)                                       as views,
                   count(distinct visitor)                        as visitors,
                   coalesce(extract(day from now() - min(ts)), 0) as days
            from pageview
            where device <> 'bot'
          `;

    const row = rows[0];
    if (!row) return NO_TOTALS;
    return {
      views: Number(row.views),
      visitors: Number(row.visitors),
      days: Number(row.days),
    };
  }, NO_TOTALS);
}
