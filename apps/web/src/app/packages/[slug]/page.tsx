import type { Metadata } from 'next'

import { PackageDetail } from '@/features/packages/detail'
import { clampDescription, pageMetadata } from '@/lib/seo'
import { getPackage, packages } from '@/lib/registry'

export function generateStaticParams() {
  return packages.map((pkg) => ({ slug: pkg.slug }))
}

/**
 * The description a result snippet shows is the package's own — the one in its
 * package.json, which npm shows too. A reader who meets the package in both
 * places should not meet two different summaries of it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const pkg = getPackage(slug)
  if (pkg === null || pkg === undefined) return {}

  return pageMetadata({
    title: pkg !== null && pkg !== undefined ? pkg.short : '',
    // The package's own words, cut to what a snippet shows. Several of these run
    // past 240 characters, which Google truncates mid-word.
    description: clampDescription(
      pkg !== null &&
        pkg !== undefined &&
        pkg.description !== null &&
        pkg.description !== undefined &&
        pkg.description !== ''
        ? pkg.description
        : pkg !== null &&
            pkg !== undefined &&
            pkg.tagline !== null &&
            pkg.tagline !== undefined &&
            pkg.tagline !== ''
          ? pkg.tagline
          : ''
    ),
    path: `/packages/${pkg !== null && pkg !== undefined ? pkg.slug : ''}`,
    keywords: [
      pkg !== null && pkg !== undefined ? pkg.npm : '',
      pkg !== null && pkg !== undefined ? pkg.short : '',
      ...(Array.isArray(
        pkg !== null && pkg !== undefined ? pkg.keywords : undefined
      )
        ? pkg !== null && pkg !== undefined
          ? pkg.keywords
          : []
        : []),
    ],
    // An unpublished package has a page so the ecosystem reads whole, but it is
    // not a thing anyone can install yet — keeping it out of the index means no
    // one arrives from a search at a package that does not exist on npm.
    noIndex: !(
      pkg !== null &&
      pkg !== undefined &&
      pkg.published !== null &&
      pkg.published !== undefined &&
      pkg.published === true
    ),
  })
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <PackageDetail slug={slug} />
}
