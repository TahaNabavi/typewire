import { Chip } from '@/components/ui/chip'
import { Container } from '@/components/ui/container'
import { JsonLd } from '@/components/shared/json-ld'
import { PackageCard } from '@/features/packages/package-card'
import { StatusChip } from '@/features/packages/status-chip'
import {
  CATEGORY_LABEL,
  packages,
  packagesByCategory,
  publishedPackages,
} from '@/lib/registry'
import { breadcrumbSchema, collectionSchema, graph } from '@/lib/seo'
import { PATHS } from '@/routes/paths'
import { gzipSize } from '@/utils/format'

export const PACKAGES_DESCRIPTION =
  'Every package in the TypeWire ecosystem, read from its own manifest, README and npm \u2014 versions, sizes, dependencies and release history included.'

export function PackagesPage() {
  const groups = packagesByCategory()

  return (
    <Container className="py-16">
      <JsonLd
        data={graph(
          collectionSchema(
            'TypeWire packages',
            PACKAGES_DESCRIPTION,
            PATHS.PACKAGES,
            packages.map((pkg) => ({
              name: pkg.npm,
              path: `/packages/${pkg.slug}`,
            }))
          ),
          breadcrumbSchema([
            { name: 'TypeWire', path: '/' },
            { name: 'Packages', path: '/packages' },
          ])
        )}
      />

      <header className="max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-blue">
          // PACKAGES
        </p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">
          {packages.length} packages, one contract
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          {publishedPackages.length} published on npm. Versions, sizes,
          dependencies and release history are derived from the monorepo at
          build time.
        </p>
      </header>

      <div className="mt-14 space-y-14">
        {groups.map((group) => (
          <section key={group.category}>
            <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-dim">
              {CATEGORY_LABEL[group.category]}
            </h2>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {group.items.map((pkg) => (
                <PackageCard key={pkg.slug} pkg={pkg} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-16">
        <h2 className="mb-4 font-mono text-xs uppercase tracking-[0.18em] text-dim">
          Compare
        </h2>
        <div className="overflow-x-auto rounded-xl border border-hair">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-hair bg-panel/50 font-mono text-[11px] uppercase tracking-wider text-dim">
              <tr>
                <th className="px-4 py-3">Package</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Wires</th>
                <th className="px-4 py-3">Runtime deps</th>
                <th className="px-4 py-3">Size ceiling</th>
                <th className="px-4 py-3">Releases</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hair">
              {packages.map((pkg) => (
                <tr key={pkg.slug}>
                  <td className="px-4 py-3 font-mono text-xs text-fg">
                    {pkg.short}
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip
                      published={pkg.published}
                      version={pkg.version}
                    />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {CATEGORY_LABEL[pkg.category]}
                  </td>
                  <td className="px-4 py-3">
                    {pkg.transports.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {pkg.transports.map((t) => (
                          <Chip key={t}>{t}</Chip>
                        ))}
                      </span>
                    ) : (
                      <span className="text-dim">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {pkg.zeroDeps ? '0' : pkg.runtimeDeps.length}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {pkg.sizeCeilingGzip
                      ? `≤ ${gzipSize(pkg.sizeCeilingGzip)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {pkg.releases.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Container>
  )
}
