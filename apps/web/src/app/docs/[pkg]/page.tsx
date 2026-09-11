import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'

import { documentedPackages, getPackage } from '@/lib/registry'

interface Params {
  params: Promise<{ pkg: string }>
}

export function generateStaticParams() {
  return documentedPackages.map((pkg) => ({ pkg: pkg.slug }))
}

/**
 * A package's docs root is its first page, not a landing page of its own — an
 * index that only links to "Overview" is a click that tells the reader nothing.
 */
export default async function PackageDocsPage({ params }: Params) {
  const { pkg: slug } = await params
  const pkg = getPackage(slug)
  const first =
    pkg !== null &&
    pkg !== undefined &&
    pkg.docs !== null &&
    pkg.docs !== undefined &&
    Array.isArray(pkg.docs.pages) &&
    pkg.docs.pages.length > 0
      ? pkg.docs.pages[0]
      : null
  if (
    pkg === null ||
    pkg === undefined ||
    first === null ||
    first === undefined
  )
    notFound()
  redirect(`/docs/${pkg.slug}/${first.slug}`)
}
