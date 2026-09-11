import Link from 'next/link'

import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/panel'
import { StatusChip } from '@/features/packages/status-chip'
import { TransportBadge } from '@/features/packages/transport-badge'
import { gzipSize } from '@/utils/format'
import type { PackageEntry } from '@/lib/registry'

/**
 * Every value here comes from the package's own manifest, README or npm — see
 * scripts/generate-registry.mjs. Nothing on this card is maintained by hand.
 */
export function PackageCard({ pkg }: { pkg: PackageEntry }) {
  return (
    <Panel
      dashed={!pkg.published}
      className={pkg.published ? '' : 'opacity-85'}
    >
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/packages/${pkg.slug}`}
          className="group font-mono text-sm"
        >
          <span className="text-dim">@tahanabavi/</span>
          <span className="font-semibold text-fg group-hover:text-blue">
            {pkg.short}
          </span>
        </Link>
        <StatusChip
          published={pkg.published}
          version={pkg.version}
          pending={pkg.pendingVersion}
        />
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {pkg.description}
      </p>

      {pkg.transports.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {pkg.transports.map((t) => (
            <TransportBadge key={t} transport={t} />
          ))}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-hair pt-4">
        {pkg.zeroDeps && <Chip tone="var(--cyan)">0 deps</Chip>}
        {pkg.sizeCeilingGzip !== null && (
          <Chip title="Gzipped ceiling enforced in CI — not a measurement">
            ≤ {gzipSize(pkg.sizeCeilingGzip)} gz
          </Chip>
        )}
        {pkg.releases.length > 0 && (
          <Chip>
            {pkg.releases.length} release{pkg.releases.length === 1 ? '' : 's'}
          </Chip>
        )}
      </div>
    </Panel>
  )
}
