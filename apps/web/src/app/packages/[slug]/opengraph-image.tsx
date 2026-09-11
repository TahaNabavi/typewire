import { notFound } from 'next/navigation'

import {
  ACCENT,
  type Accent,
  OG_CONTENT_TYPE,
  OG_SIZE,
  ogImage,
} from '@/lib/og'
import { gzipSize } from '@/utils/format'
import {
  CATEGORY_LABEL,
  TRANSPORT_LABEL,
  getPackage,
  packages,
} from '@/lib/registry'

export const alt = 'A TypeWire package'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

/** The registry is the whole input, so every card is drawn once at build time. */
export function generateStaticParams() {
  return packages.map((pkg) => ({ slug: pkg.slug }))
}

/** A slug that is not in the registry has no page either — nothing to draw. */
export const dynamicParams = false

/**
 * Category picks the accent, so a link to a transport package and a link to a
 * devtools package are distinguishable in a feed before either title is read.
 */
const ACCENT_BY_CATEGORY: Record<string, Accent> = {
  core: ACCENT.cyan,
  transport: ACCENT.purple,
  server: ACCENT.blue,
  state: ACCENT.green,
  devtools: ACCENT.amber,
  tooling: ACCENT.blue,
}

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const pkg = getPackage(slug)
  if (pkg === null || pkg === undefined) notFound()

  const chips = [
    ...(Array.isArray(pkg.transports)
      ? pkg.transports.map((t) => TRANSPORT_LABEL[t])
      : []),
    ...(pkg.zeroDeps === true ? ['0 deps'] : []),
    ...(pkg.sizeCeilingGzip !== null && pkg.sizeCeilingGzip !== undefined
      ? [`≤ ${gzipSize(pkg.sizeCeilingGzip)} gz`]
      : []),
  ]

  return ogImage({
    eyebrow:
      pkg !== null &&
      pkg !== undefined &&
      pkg.category !== null &&
      pkg.category !== undefined &&
      CATEGORY_LABEL[pkg.category] !== null &&
      CATEGORY_LABEL[pkg.category] !== undefined
        ? CATEGORY_LABEL[pkg.category]
        : '',
    // The scope is on every package and says nothing about this one; the
    // unscoped name is what a reader recognises and what they type.
    title: pkg !== null && pkg !== undefined ? pkg.short : '',
    // package.json's description, not the README tagline: it is what npm shows
    // for the same package, and it is written short.
    description:
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
          : '',
    accent:
      pkg !== null &&
      pkg !== undefined &&
      pkg.category !== null &&
      pkg.category !== undefined &&
      ACCENT_BY_CATEGORY[pkg.category] !== null &&
      ACCENT_BY_CATEGORY[pkg.category] !== undefined
        ? ACCENT_BY_CATEGORY[pkg.category]
        : ACCENT.blue,
    kicker:
      pkg !== null &&
      pkg !== undefined &&
      pkg.version !== null &&
      pkg.version !== undefined &&
      pkg.version !== ''
        ? `v${pkg.version}`
        : 'unpublished',
    chips,
  })
}
