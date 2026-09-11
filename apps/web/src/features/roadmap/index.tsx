import { Panel } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { site } from '@/config/site'
import { packages, publishedPackages, roadmap } from '@/lib/registry'

/**
 * Parsed straight from the root README's roadmap checklist at build time.
 *
 * Drawn as one continuous line rather than two columns, because the point is
 * the boundary: everything above the marker is done, everything below is not,
 * and the marker itself is where the project actually stands today. Two
 * side-by-side lists let a reader mistake "next" for "nearly done".
 */

/**
 * The list a roadmap usually leaves out. Derived where it can be, so it corrects
 * itself instead of becoming the stalest paragraph on the page.
 */
function gaps(): string[] {
  const out: string[] = []

  const drifted = packages.filter(
    (p) => p.published && p.npmVersion && p.npmVersion !== p.localVersion
  )
  for (const p of drifted) {
    out.push(
      `${p.short} is ${p.npmVersion} on npm but ${p.localVersion} in this workspace — the repo is behind its own release.`
    )
  }

  const unpublished = packages.filter((p) => !p.published)
  if (unpublished.length > 0) {
    out.push(
      `${unpublished.length} packages are built and tested but not on npm: ${unpublished
        .map((p) => p.short)
        .join(', ')}.`
    )
  }

  out.push(
    'Size budgets are asserted ceilings, not published measurements — CI fails when one is exceeded, but no measured figure is shown.'
  )
  return out
}

export function RoadmapSection() {
  const unpublished = packages.length - publishedPackages.length

  return (
    <Section
      id="roadmap"
      alt
      kicker="// ROADMAP"
      title="Shipped, and what is next"
      lede="Read from the checklist in the repository README, so it cannot fall behind it."
    >
      <div className="enter-group grid grid-cols-1 gap-10 lg:grid-cols-[1.3fr_1fr]">
        <ol className="relative">
          {/* The spine. Solid through shipped work, dashed through what is not. */}
          <span
            aria-hidden
            className="absolute top-2 bottom-2 left-1.75 w-px bg-linear-to-b from-green via-blue to-transparent"
          />

          {roadmap.shipped.map((item) => (
            <li key={item.title} className="relative flex gap-5 pb-7 pl-0">
              <span
                aria-hidden
                className="relative z-10 mt-1.5 size-3.5 flex-none rounded-full border-2 border-green bg-canvas"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-fg">{item.title}</p>
                {item.detail && (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                )}
              </div>
            </li>
          ))}

          {/* Where the project actually is, between the two halves. */}
          <li className="relative flex gap-5 pb-7">
            <span
              aria-hidden
              className="relative z-10 mt-1 size-3.5 flex-none rounded-full bg-blue"
              style={{
                animation: 'wire-pulse var(--motion-wire) ease-in-out infinite',
              }}
            />
            <div className="min-w-0 flex-1">
              <span className="inline-flex items-center gap-2 rounded-full border border-blue/45 bg-blue/10 px-3 py-1 font-mono text-[10.5px] font-bold tracking-[0.14em] text-blue">
                YOU ARE HERE
              </span>
              <p className="mt-2 font-mono text-xs leading-relaxed text-dim">
                {publishedPackages.length} of {packages.length} packages on npm
                {unpublished > 0
                  ? ` · ${unpublished} built, awaiting a first publish`
                  : ''}
              </p>
            </div>
          </li>

          {roadmap.next.map((item, i) => (
            <li key={item.title} className="relative flex gap-5 pb-7">
              <span
                aria-hidden
                className="relative z-10 mt-1.5 size-3.5 flex-none rounded-full border border-dashed border-dim bg-canvas"
              />
              <div className="min-w-0">
                <p
                  className={
                    i === 0
                      ? 'text-sm font-semibold text-fg'
                      : 'text-sm font-semibold text-muted-foreground'
                  }
                >
                  {item.title}
                  {i === 0 && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-blue">
                      next up
                    </span>
                  )}
                </p>
                {item.detail && (
                  <p className="mt-1 text-sm leading-relaxed text-dim">
                    {item.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="space-y-5">
          {/* What a version bump looks like from the outside. */}
          <div className="code-surface overflow-hidden rounded-xl border border-hair">
            <div className="flex items-center gap-2 border-b border-hair px-3 py-2.5">
              <span aria-hidden className="size-2 rounded-full bg-red/70" />
              <span aria-hidden className="size-2 rounded-full bg-amber/70" />
              <span aria-hidden className="size-2 rounded-full bg-green/70" />
              <span className="ml-1 font-mono text-[11px] text-dim">
                typewire diff
              </span>
              <span className="ml-auto rounded-full border border-amber/45 bg-amber/10 px-2 py-0.5 font-mono text-[9.5px] font-bold tracking-[0.12em] text-amber">
                PROPOSED
              </span>
            </div>
            <pre className="overflow-x-auto p-3.5 font-mono text-[12px] leading-[1.85]">
              <div className="text-dim">$ npx typewire diff v1.4.0 v2.0.0</div>
              <div className="text-green">+ user.getUser.response.email</div>
              <div className="text-red">- user.getUser.response.name</div>
              <div className="text-amber">
                ~ user.listUsers.request.page → cursor
              </div>
              <div className="mt-2 text-dim">3 changes · 1 breaking</div>
              <div className="text-cyan">
                → 2 call sites will fail typecheck
              </div>
            </pre>
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-dim">
            Not a shipped command. The CLI ships init, list, test and
            release-doc today; diff and lint are designed in{' '}
            <a
              href={`${site.repo.url}/blob/main/docs/CLI.md`}
              target="_blank"
              rel="noreferrer"
              className="text-blue hover:underline"
            >
              docs/CLI.md
            </a>{' '}
            and are what the roadmap above is heading towards.
          </p>

          {/* The list every roadmap section leaves out. */}
          <Panel className="border-amber/30">
            <h3 className="pb-1 font-mono text-xs uppercase tracking-[0.18em] text-amber">
              Honest gaps
            </h3>
            <ul className="space-y-3 pt-3">
              {gaps().map((gap) => (
                <li
                  key={gap}
                  className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 size-1.5 flex-none rounded-full bg-amber"
                  />
                  {gap}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <a
        href={`${site.repo.url}/blob/main/docs/ROADMAP.md`}
        target="_blank"
        rel="noreferrer"
        className="mt-10 inline-block text-sm text-blue hover:underline"
      >
        Full sequencing, including the gaps that are still open ↗
      </a>
    </Section>
  )
}
