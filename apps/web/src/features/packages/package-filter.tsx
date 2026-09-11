'use client'

import { useMemo } from 'react'
import { Search, X } from 'lucide-react'

import { usePackageFilter } from '@/features/packages/store'
import { PackageCard } from '@/features/packages/package-card'
import { CATEGORY_LABEL, type PackageEntry } from '@/lib/registry'
import { cn } from '@/utils'

/**
 * The package grid, filtered.
 *
 * Twelve packages is past the point where a reader scans the whole grid, so the
 * chips and the search field are how someone with a specific need ("which one
 * does gRPC?") gets there. Both live in the feature's own store rather than
 * local state, so the chips and the field stay in step without either owning
 * the other.
 *
 * Matching is deliberately wide — name, description, keywords and transports —
 * because the word someone types is more often a capability than a package
 * name.
 */

const ALL = 'All'

export function PackageFilter({ packages }: { packages: PackageEntry[] }) {
  const category = usePackageFilter((s) => s.category)
  const setCategory = usePackageFilter((s) => s.setCategory)
  const query = usePackageFilter((s) => s.query)
  const setQuery = usePackageFilter((s) => s.setQuery)

  const categories = useMemo(() => {
    const seen = new Map<string, number>()
    for (const pkg of packages)
      seen.set(pkg.category, (seen.get(pkg.category) ?? 0) + 1)
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [packages])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return packages.filter((pkg) => {
      if (category !== ALL && pkg.category !== category) return false
      if (!needle) return true
      const haystack = [
        pkg.short,
        pkg.npm,
        pkg.description,
        pkg.tagline,
        ...pkg.keywords,
        ...pkg.transports,
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [packages, category, query])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setCategory(ALL)}
          aria-pressed={category === ALL}
          className={cn(
            'rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors',
            category === ALL
              ? 'border-blue/50 bg-blue/10 text-blue'
              : 'border-hair text-muted-foreground hover:border-hair-strong hover:text-fg'
          )}
        >
          All <span className="text-dim">{packages.length}</span>
        </button>

        {categories.map(([key, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            aria-pressed={category === key}
            className={cn(
              'rounded-full border px-3 py-1.5 font-mono text-[11px] transition-colors',
              category === key
                ? 'border-blue/50 bg-blue/10 text-blue'
                : 'border-hair text-muted-foreground hover:border-hair-strong hover:text-fg'
            )}
          >
            {CATEGORY_LABEL[key as keyof typeof CATEGORY_LABEL] ?? key}{' '}
            <span className="text-dim">{count}</span>
          </button>
        ))}

        <label className="ml-auto flex min-w-52 flex-1 items-center gap-2 rounded-full border border-hair px-3 py-1.5 focus-within:border-hair-strong sm:flex-none">
          <Search className="size-3.5 shrink-0 text-dim" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="filter packages…"
            aria-label="Filter packages"
            className="w-full bg-transparent font-mono text-[11px] text-fg outline-none placeholder:text-dim"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear filter"
              className="shrink-0 text-dim transition-colors hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
      </div>

      <p className="mt-4 font-mono text-[11px] text-dim" aria-live="polite">
        {shown.length} of {packages.length} packages
      </p>

      {shown.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((pkg) => (
            <PackageCard key={pkg.slug} pkg={pkg} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-hair-strong p-10 text-center">
          <p className="font-mono text-sm text-muted-foreground">
            Nothing matches “{query}”{category !== ALL ? ` in ${category}` : ''}
            .
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setCategory(ALL)
            }}
            className="mt-3 font-mono text-[11px] text-blue hover:underline"
          >
            clear filters
          </button>
        </div>
      )}
    </div>
  )
}
