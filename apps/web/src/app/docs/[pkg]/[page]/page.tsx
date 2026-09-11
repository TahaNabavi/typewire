import type { Metadata } from 'next'

import { DocsPage } from '@/features/docs'
import { excerpt } from '@/features/docs/markdown'
import { pageMetadata } from '@/lib/seo'
import { documentedPackages, getDocPage, getPackage } from '@/lib/registry'

interface Params {
  params: Promise<{ pkg: string; page: string }>
}

/** Every page is known at build time — the registry is the whole input. */
export function generateStaticParams() {
  return documentedPackages.flatMap((pkg) =>
    pkg.docs.pages.map((page) => ({ pkg: pkg.slug, page: page.slug }))
  )
}

/**
 * A docs page describes itself, in its own opening words.
 *
 * Eighty pages across twelve packages is enough that a shared description makes
 * them near-duplicates of each other: Google shows one and drops the rest. So
 * the page's own first paragraph is the description, and the package summary is
 * only the fallback for a page that opens straight into a table or a fence.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { pkg: pkgSlug, page: pageSlug } = await params
  const pkg = getPackage(pkgSlug)
  const page =
    pkg !== null && pkg !== undefined ? getDocPage(pkg, pageSlug) : null
  if (pkg === null || pkg === undefined || page === null || page === undefined)
    return {}

  const sections =
    page !== null && page !== undefined
      ? page.headings.filter((h) => h.depth === 2).map((h) => h.text)
      : []
  const description =
    (excerpt(page !== null && page !== undefined ? page.markdown : '') ?? '') ||
    (sections.length > 1
      ? `${page !== null && page !== undefined ? page.title : ''} in ${pkg !== null && pkg !== undefined ? pkg.npm : ''} \u2014 ${sections.slice(0, 4).join(', ')}.`
      : `${page !== null && page !== undefined ? page.title : ''} \u2014 ${pkg !== null && pkg !== undefined ? pkg.description : ''}`)

  return pageMetadata({
    title: `${page.title} · ${pkg.short}`,
    description,
    path: `/docs/${pkg.slug}/${page.slug}`,
    type: 'article',
    keywords: [pkg.npm, pkg.short, page.title, ...pkg.keywords.slice(0, 6)],
  })
}

export default async function Page({ params }: Params) {
  const { pkg, page } = await params
  return <DocsPage pkgSlug={pkg} pageSlug={page} />
}
