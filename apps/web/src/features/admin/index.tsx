import { Chip } from "@/components/ui/chip";
import { Container } from "@/components/ui/container";
import { Panel } from "@/components/ui/panel";
import {
  todayBreakdown,
  topPaths,
  topReferrers,
  totals,
  viewsByDay,
  type DayPoint,
  type Ranked,
} from "@/features/analytics/analytics";
import { dbConfigured, withDb } from "@/lib/db";
import { redis } from "@/lib/redis";
import { generatedAt, packages, registryComplete } from "@/lib/registry";
import { compactNumber, relativeTime } from "@/utils/format";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Panel>
      <p className="font-mono text-[11px] uppercase tracking-wider text-dim">{label}</p>
      <p className="mt-2 font-mono text-3xl text-fg">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Panel>
  );
}

/** Inline SVG bars — the panel should not pull a charting library for this. */
function DayChart({ points }: { points: DayPoint[] }) {
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-dim">No pageviews recorded yet.</p>;
  }
  const max = Math.max(...points.map((p) => p.views), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-1">
        {points.map((point) => (
          <div key={point.day} className="group relative flex-1" title={`${point.day}: ${point.views} views · ${point.visitors} visitors`}>
            <div
              className="w-full rounded-sm bg-linear-to-t from-blue-strong to-purple-strong"
              style={{ height: `${Math.max((point.views / max) * 100, 2)}%` }}
            />
            <div
              className="absolute bottom-0 w-full rounded-sm bg-cyan/60"
              style={{ height: `${Math.max((point.visitors / max) * 100, 1)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-dim">
        <span>{points[0]?.day}</span>
        <span>
          <span className="text-blue">views</span> · <span className="text-cyan">visitors</span>
        </span>
        <span>{points[points.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function RankList({ title, items, empty }: { title: string; items: Ranked[]; empty: string }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <Panel>
      <h2 className="font-mono text-[11px] uppercase tracking-wider text-dim">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-dim">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.label} className="relative">
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-sm bg-blue/10"
                style={{ width: `${(item.count / max) * 100}%` }}
              />
              <div className="relative flex justify-between gap-3 px-2 py-1 font-mono text-xs">
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="text-fg">{item.count}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export async function AdminPage() {
  const [today, byDay, paths, referrers, allTime, feedback, snapshots] = await Promise.all([
    todayBreakdown(),
    viewsByDay(30),
    topPaths(30),
    topReferrers(30),
    totals(),
    withDb((db) => db.feedback.findMany({ orderBy: { ts: "desc" }, take: 20 }), []),
    withDb(
      (db) =>
        db.snapshot.findMany({
          orderBy: { day: "desc" },
          take: 30,
          select: { day: true, stars: true },
        }),
      [],
    ),
  ]);

  const latest = snapshots[0];
  const previous = snapshots[snapshots.length - 1];
  const starDelta =
    latest?.stars != null && previous?.stars != null ? latest.stars - previous.stars : null;

  const behind = packages.filter(
    (p) => p.npmVersion && p.localVersion !== p.npmVersion,
  );

  return (
    <Container className="py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan">// PANEL</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Site & project health</h1>
        </div>
        <div className="flex gap-2">
          <a
            href="/"
            className="rounded-lg border border-hair px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-fg"
          >
            Back to site
          </a>
          <a
            href="/api/admin/logout"
            className="rounded-lg border border-hair px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-fg"
          >
            Sign out
          </a>
        </div>
      </header>

      {(!dbConfigured || !redis.configured) && (
        <p className="mt-6 rounded-lg border border-dashed border-amber/40 bg-amber/10 p-4 text-sm text-amber">
          {!dbConfigured && "DATABASE_URL is not set — history and feedback are unavailable. "}
          {!redis.configured && "Upstash Redis is not configured — live counters are unavailable. "}
          The site still runs; only this panel is degraded.
        </p>
      )}

      <section className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Views today" value={compactNumber(today.views)} />
        <Stat label="Visitors today" value={compactNumber(today.visitors)} hint="cookieless, hashed daily" />
        <Stat label="Views all time" value={compactNumber(allTime.views)} hint={`over ${allTime.days} days`} />
        <Stat
          label="GitHub stars"
          value={latest?.stars != null ? compactNumber(latest.stars) : "—"}
          hint={starDelta != null ? `${starDelta >= 0 ? "+" : ""}${starDelta} in ${snapshots.length} days` : "no snapshots yet"}
        />
      </section>

      <section className="mt-6">
        <Panel>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-dim">Last 30 days</h2>
          <div className="mt-4">
            <DayChart points={byDay} />
          </div>
        </Panel>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <RankList title="Top pages · 30 days" items={paths} empty="No pageviews recorded yet." />
        <RankList title="Referrers · 30 days" items={referrers} empty="No referrers recorded yet." />
        <RankList title="Countries · today" items={today.countries} empty="Nothing today yet." />
        <RankList title="Devices · today" items={today.devices} empty="Nothing today yet." />
      </section>

      <section className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-dim">
            Feedback inbox {feedback.length > 0 && `· ${feedback.length}`}
          </h2>
          {feedback.length === 0 ? (
            <p className="mt-4 text-sm text-dim">Nothing submitted yet.</p>
          ) : (
            <ul className="mt-4 divide-y divide-hair">
              {feedback.map((item) => (
                <li key={item.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.package && <Chip tone="var(--blue)">{item.package.replace("@tahanabavi/", "")}</Chip>}
                    {item.reaction && <Chip>{item.reaction}</Chip>}
                    <span className="ml-auto font-mono text-[11px] text-dim">
                      {relativeTime(item.ts)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{item.message}</p>
                  {item.handle && <p className="mt-1 font-mono text-[11px] text-dim">{item.handle}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <h2 className="font-mono text-[11px] uppercase tracking-wider text-dim">Registry health</h2>
          <dl className="mt-4 space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-dim">built</dt>
              <dd className="text-fg">{relativeTime(generatedAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-dim">npm checked</dt>
              <dd className={registryComplete ? "text-green" : "text-amber"}>
                {registryComplete ? "all packages" : "incomplete"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-dim">packages</dt>
              <dd className="text-fg">{packages.length}</dd>
            </div>
          </dl>

          {behind.length > 0 && (
            <div className="mt-5 border-t border-hair pt-4">
              <p className="font-mono text-[11px] uppercase tracking-wider text-amber">
                workspace ≠ npm
              </p>
              <ul className="mt-2 space-y-1">
                {behind.map((p) => (
                  <li key={p.slug} className="flex justify-between gap-3 font-mono text-[11px]">
                    <span className="truncate text-muted-foreground">{p.short}</span>
                    <span className="text-dim">
                      {p.localVersion} → {p.npmVersion}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </section>
    </Container>
  );
}
