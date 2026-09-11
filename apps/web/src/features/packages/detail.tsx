import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Chip } from '@/components/ui/chip'
import { CommandBar } from '@/components/ui/command-bar'
import { Container } from '@/components/ui/container'
import { Panel } from '@/components/ui/panel'
import { JsonLd } from '@/components/shared/json-ld'
import { site } from '@/config/site'
import { StatusChip } from '@/features/packages/status-chip'
import { TransportBadge } from '@/features/packages/transport-badge'
import { getPackage, repoUrls } from '@/lib/registry'
import { breadcrumbSchema, graph, packageSchema } from '@/lib/seo'
import { gzipSize } from '@/utils/format'

export function PackageDetail({ slug }: { slug: string }) {
  const pkg = getPackage(slug)
  if (!pkg) notFound()

  const urls = repoUrls(pkg, site.repo.url, site.repo.branch)

  return (
    <Container className="py-16">
      <JsonLd
        data={graph(
          packageSchema(pkg),
          breadcrumbSchema([
            { name: 'TypeWire', path: '/' },
            { name: 'Packages', path: '/packages' },
            { name: pkg.short, path: `/packages/${pkg.slug}` },
          ])
        )}
      />

      <Link
        href="/packages"
        className="font-mono text-xs text-dim hover:text-fg"
      >
        ← all packages
      </Link>

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
        {/* min-w-0 plus a wrap point: the scoped name is one long unbreakable
            mono token, and a flex item defaults to min-width:auto — together
            they push the header past the viewport on a phone. */}
        <div className="min-w-0">
          <h1 className="font-mono text-3xl font-bold break-words">
            <span className="text-dim">@tahanabavi/</span>
            <wbr />
            <span className="text-fg">{pkg.short}</span>
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
            {pkg.description}
          </p>
        </div>
        <StatusChip
          published={pkg.published}
          version={pkg.version}
          pending={pkg.pendingVersion}
        />
      </header>

      <div className="mt-8 flex flex-wrap gap-2">
        {pkg.zeroDeps && <Chip tone="var(--cyan)">0 runtime deps</Chip>}
        {pkg.sizeCeilingGzip !== null && (
          <Chip>≤ {gzipSize(pkg.sizeCeilingGzip)} gzipped (CI ceiling)</Chip>
        )}
        {pkg.transports.map((t) => (
          <TransportBadge key={t} transport={t} />
        ))}
      </div>

      {pkg.published && (
        <CommandBar command={pkg.install} className="mt-8 max-w-lg" />
      )}

      <div className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {pkg.tagline && (
            <Panel>
              <h2 className="text-sm font-bold text-fg">What it does</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {pkg.tagline}
              </p>
            </Panel>
          )}

          {pkg.features.length > 0 && (
            <Panel>
              <h2 className="text-sm font-bold text-fg">Features</h2>
              <ul className="mt-3 space-y-2">
                {pkg.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-blue"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-mono text-[11px] text-dim">
                read from the package README
              </p>
            </Panel>
          )}

          {pkg.releases.length > 0 && (
            <Panel>
              <h2 className="text-sm font-bold text-fg">Release notes</h2>
              <ul className="mt-3 space-y-2">
                {pkg.releases.map((release) => (
                  <li
                    key={release.version}
                    className="flex items-baseline gap-3 text-sm"
                  >
                    <span className="font-mono text-xs text-blue">
                      v{release.version}
                    </span>
                    <a
                      href={urls.release(release)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-fg"
                    >
                      {release.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          <Panel>
            <h2 className="text-sm font-bold text-fg">Details</h2>
            <dl className="mt-3 space-y-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-dim">npm version</dt>
                <dd className="font-mono text-fg">{pkg.npmVersion ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-dim">in this repo</dt>
                <dd className="font-mono text-fg">{pkg.localVersion}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-dim">runtime deps</dt>
                <dd className="font-mono text-fg">{pkg.runtimeDeps.length}</dd>
              </div>
              {pkg.exports.length > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-dim">entry points</dt>
                  <dd className="font-mono text-fg">{pkg.exports.join(' ')}</dd>
                </div>
              )}
            </dl>
          </Panel>

          {pkg.peerDeps.length > 0 && (
            <Panel>
              <h2 className="text-sm font-bold text-fg">Peer dependencies</h2>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {pkg.peerDeps.map((peer) => (
                  <li key={peer}>
                    <Chip>{peer}</Chip>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel>
            <h2 className="text-sm font-bold text-fg">Links</h2>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <a
                  href={urls.readme}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue hover:underline"
                >
                  README ↗
                </a>
              </li>
              <li>
                <a
                  href={urls.source}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue hover:underline"
                >
                  Source ↗
                </a>
              </li>
              {pkg.published && (
                <li>
                  <a
                    href={urls.npm}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue hover:underline"
                  >
                    npm ↗
                  </a>
                </li>
              )}
            </ul>
          </Panel>
        </div>
      </div>
    </Container>
  )
}
