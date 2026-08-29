import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { site } from "@/config/site";
import { BudgetGauge } from "@/features/project-status/budget-gauge";
import { CommitHeatmap } from "@/features/project-status/commit-heatmap";
import { RunDots } from "@/features/project-status/run-dots";
import { Sparkline } from "@/features/project-status/sparkline";
import { compactNumber, relativeTime } from "@/utils/format";
import {
  getCommitActivity,
  getContributors,
  getLatestCiRun,
  getLatestRelease,
  getRecentCiRuns,
  getRepoStats,
} from "@/features/project-status/github";
import { getWeeklyDownloadsFor } from "@/features/project-status/npm";
import { packages, publishedPackages } from "@/lib/registry";

/** Renders `cached` rather than a broken grid when an API declines to answer. */
function StaleChip({ stale }: { stale: boolean }) {
  if (!stale) return null;
  return (
    <Chip tone="var(--dim)" dashed>
      cached
    </Chip>
  );
}

/**
 * The one thing this band must not do is imply a number it does not have. Every
 * card below either shows live data, or says in words why it cannot.
 */
function Unavailable({ children }: { children: string }) {
  return <p className="mt-3 font-mono text-xs leading-relaxed text-dim">{children}</p>;
}

export async function GithubStatus() {
  const [stats, release, contributors, ci, runs, activity, downloads] = await Promise.all([
    getRepoStats(),
    getLatestRelease(),
    getContributors(),
    getLatestCiRun(),
    getRecentCiRuns(),
    getCommitActivity(),
    getWeeklyDownloadsFor(publishedPackages.map((p) => p.npm)),
  ]);

  const budgets = packages.filter((p) => p.sizeCeilingGzip !== null);
  const totalDownloads = downloads.reduce((sum, d) => sum + (d.downloads ?? 0), 0);
  const green = ci.data?.conclusion === "success";

  const weekly = activity.data.map((w) => w.total);
  const commitsThisYear = weekly.reduce((sum, n) => sum + n, 0);
  const passed = runs.data.filter((r) => r.conclusion === "success").length;
  const rate = runs.data.length > 0 ? Math.round((passed / runs.data.length) * 100) : null;

  return (
    <Section
      id="status"
      kicker="// LIVE FROM THE REPO"
      title="The guarantees, as they actually stand"
      lede="Every number here is fetched from GitHub and npm at build time, revalidated hourly. Where an API declines to answer, the card says so rather than showing a zero."
    >
      <div className="enter-group grid grid-cols-1 items-start gap-5 md:grid-cols-2 lg:grid-cols-3">
        {/* CI — the headline card, and the only one that gets the run history. */}
        <Panel className="md:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-fg">Cross-package integrity gate</h3>
            <div className="flex items-center gap-2">
              {rate !== null && (
                <span className="font-mono text-[11px] text-dim">
                  {passed}/{runs.data.length} green · {rate}%
                </span>
              )}
              <StaleChip stale={ci.stale} />
            </div>
          </div>

          {ci.data ? (
            <p className="mt-3 flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{
                  background: green ? "var(--green)" : "var(--red)",
                  animation: green ? "wire-pulse var(--motion-wire) ease-in-out infinite" : undefined,
                }}
              />
              <span className="font-mono text-sm text-fg">
                {ci.data.conclusion ?? ci.data.status}
              </span>
              <Chip>{ci.data.branch}</Chip>
              <span className="font-mono text-xs text-dim">{relativeTime(ci.data.updatedAt)}</span>
            </p>
          ) : (
            <Unavailable>
              No run data — the workflow has not reported, or the API is rate-limited.
            </Unavailable>
          )}

          {runs.data.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                last {runs.data.length} runs · oldest first
              </p>
              <RunDots runs={runs.data} />
            </div>
          )}

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            build → typecheck → test, in topological order. A breaking change in query-core fails the
            react build — the check goes red.
          </p>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-fg">Repository</h3>
            <StaleChip stale={stats.stale} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            {[
              ["stars", stats.data.stars],
              ["forks", stats.data.forks],
              ["watchers", stats.data.watchers],
              ["open issues", stats.data.openIssues],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="font-mono text-[11px] uppercase tracking-wider text-dim">{label}</dt>
                <dd className="font-mono text-xl text-fg">{compactNumber(Number(value))}</dd>
              </div>
            ))}
          </dl>
          {stats.data.pushedAt && (
            <p className="mt-4 font-mono text-[11px] text-dim">
              last push {relativeTime(stats.data.pushedAt)}
            </p>
          )}
        </Panel>

        {/* Commit activity — sparkline and heatmap read the same 52 weeks. */}
        <Panel className="lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-fg">Commit activity · 52 weeks</h3>
            {activity.data.length > 0 && (
              <span className="font-mono text-[11px] text-dim">
                {compactNumber(commitsThisYear)} commits
              </span>
            )}
          </div>

          {activity.data.length > 0 ? (
            <>
              <Sparkline values={weekly} tone="var(--cyan)" className="mt-4" />
              <CommitHeatmap weeks={activity.data} className="mt-4" />
              <div className="mt-3 flex items-center gap-2 font-mono text-[10px] text-dim">
                <span>less</span>
                {[0, 1, 2, 3, 4].map((level) => (
                  <span
                    key={level}
                    aria-hidden
                    className="size-2.5 rounded-[2px]"
                    style={{
                      background:
                        level === 0
                          ? "var(--hair)"
                          : `color-mix(in oklab, var(--green) ${level * 22 + 12}%, transparent)`,
                    }}
                  />
                ))}
                <span>more</span>
              </div>
            </>
          ) : (
            <Unavailable>
              GitHub computes this series asynchronously and answered 202 — it fills in on the next
              revalidation.
            </Unavailable>
          )}
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-fg">Latest release</h3>
            <StaleChip stale={release.stale} />
          </div>
          {release.data ? (
            <>
              <p className="mt-3 font-mono text-lg text-fg">{release.data.tag}</p>
              <p className="mt-1 font-mono text-xs text-dim">
                {relativeTime(release.data.publishedAt)}
              </p>
              <a
                href={release.data.url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-xs text-blue hover:underline"
              >
                Release notes ↗
              </a>
            </>
          ) : (
            <Unavailable>
              No GitHub release yet — versions are published from Changesets, so npm is ahead of the
              releases tab.
            </Unavailable>
          )}
        </Panel>

        <Panel>
          <h3 className="text-sm font-bold text-fg">npm downloads · last week</h3>
          <p className="mt-3 font-mono text-3xl text-fg">{compactNumber(totalDownloads)}</p>
          <ul className="mt-4 space-y-1.5">
            {downloads
              .filter((d) => d.downloads !== null)
              .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
              .slice(0, 8)
              .map((d) => (
                <li
                  key={d.pkg}
                  className="flex items-baseline justify-between gap-3 font-mono text-xs"
                >
                  <span className="truncate text-muted-foreground">
                    {d.pkg.replace("@tahanabavi/", "")}
                  </span>
                  <span className="shrink-0 text-dim">{compactNumber(d.downloads ?? 0)}</span>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-fg">Contributors</h3>
            <StaleChip stale={contributors.stale} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {contributors.data.slice(0, 12).map((c) => (
              <a key={c.login} href={c.url} target="_blank" rel="noreferrer" title={c.login}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={c.avatar}
                  alt={c.login}
                  className="size-9 rounded-full border border-hair"
                />
              </a>
            ))}
            {contributors.data.length === 0 && (
              <p className="text-sm text-dim">Contributor list unavailable.</p>
            )}
          </div>
        </Panel>

        <Panel>
          <h3 className="text-sm font-bold text-fg">Gzipped size budgets</h3>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-dim">
            CI ceilings, not measurements — a dashed track means the limit is asserted but no
            published figure exists to fill it.
          </p>
          <ul className="mt-4 space-y-3">
            {budgets.map((p) => (
              <BudgetGauge key={p.slug} label={p.short} ceiling={p.sizeCeilingGzip ?? 0} />
            ))}
          </ul>
        </Panel>
      </div>

      <a
        href={`${site.repo.url}/actions`}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-block text-sm text-blue hover:underline"
      >
        All workflow runs ↗
      </a>
    </Section>
  );
}
