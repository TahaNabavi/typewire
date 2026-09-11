import Link from 'next/link'
import type { ReactNode } from 'react'

import { Chip } from '@/components/ui/chip'
import { Container } from '@/components/ui/container'
import {
  documentedPackages,
  docsBehind,
  type DocHeading,
  type PackageEntry,
} from '@/lib/registry'
import { cn } from '@/utils'

/**
 * The docs frame: package tree on the left, page in the middle, this page's own
 * headings on the right.
 *
 * The sidebar lists every documented package rather than only the current one,
 * because the thing a reader most often wants from a package's docs is the
 * neighbouring package's docs — this is one library in twelve pieces, and the
 * navigation should say so.
 */

function VersionBadge({ pkg }: { pkg: PackageEntry }) {
  const documented = pkg.docs?.documentsVersion
  if (!documented) return null

  // A page describing an older minor is a fact the reader needs, not something
  // to hide until CI catches it.
  if (docsBehind(pkg)) {
    return (
      <Chip
        tone="var(--amber)"
        dashed
        title="These pages have not been reviewed against the current release"
      >
        documents v{documented}
      </Chip>
    )
  }
  return <Chip tone="var(--green)">v{documented}</Chip>
}

export function DocsShell({
  pkg,
  activeSlug,
  headings,
  children,
}: {
  pkg?: PackageEntry
  activeSlug?: string
  headings?: DocHeading[]
  children: ReactNode
}) {
  return (
    <Container className="py-12">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_200px]">
        {/* Package tree. Scrolls with the page on narrow widths; sticks on wide. */}
        <nav
          aria-label="Documentation"
          className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto"
        >
          <Link
            href="/docs"
            className={cn(
              'block font-mono text-xs uppercase tracking-[0.18em] transition-colors duration-(--motion-ui)',
              pkg ? 'text-dim hover:text-fg' : 'text-blue'
            )}
          >
            // ALL PACKAGES
          </Link>

          <ul className="mt-4 space-y-1">
            {documentedPackages.map((entry) => {
              const current = entry.slug === pkg?.slug
              return (
                <li key={entry.slug}>
                  <Link
                    href={`/docs/${entry.slug}`}
                    className={cn(
                      'block rounded-lg px-2.5 py-1.5 font-mono text-[12.5px] transition-colors duration-(--motion-ui)',
                      current
                        ? 'bg-blue/10 text-blue'
                        : 'text-muted-foreground hover:bg-panel hover:text-fg'
                    )}
                  >
                    {entry.short}
                  </Link>

                  {/* Only the open package expands — twelve packages' worth of
                      pages at once would bury the one being read. */}
                  {current && entry.docs && entry.docs.pages.length > 1 && (
                    <ul className="mt-1 mb-2 ml-2.5 space-y-0.5 border-l border-hair pl-3">
                      {entry.docs.pages.map((page) => (
                        <li key={page.slug}>
                          <Link
                            href={`/docs/${entry.slug}/${page.slug}`}
                            className={cn(
                              'block rounded px-2 py-1 text-[12.5px] transition-colors duration-(--motion-ui)',
                              page.slug === activeSlug
                                ? 'text-fg'
                                : 'text-dim hover:text-muted-foreground'
                            )}
                          >
                            {page.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="min-w-0">
          {pkg && (
            <header className="mb-8 border-b border-hair pb-6">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-mono text-2xl font-bold text-fg">
                  <span className="text-dim">@tahanabavi/</span>
                  {pkg.short}
                </h1>
                <VersionBadge pkg={pkg} />
                {!pkg.published && (
                  <Chip tone="var(--amber)" dashed>
                    UNPUBLISHED
                  </Chip>
                )}
              </div>
              <p className="mt-2 text-muted-foreground">
                {pkg.docs?.summary ?? pkg.description}
              </p>
            </header>
          )}
          {children}
        </main>

        {/* This page's headings. Wide screens only — below xl it would push the
            body narrower than a code block wants to be. */}
        {headings && headings.length > 2 && (
          <aside className="hidden xl:sticky xl:top-20 xl:block xl:max-h-[calc(100vh-6rem)] xl:self-start xl:overflow-y-auto">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
              On this page
            </p>
            <ul className="mt-3 space-y-1.5">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className={cn(
                      'block text-[12.5px] leading-snug text-dim transition-colors duration-(--motion-ui) hover:text-fg',
                      heading.depth === 3 && 'pl-3'
                    )}
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </Container>
  )
}
