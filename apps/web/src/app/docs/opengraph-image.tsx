import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og'
import { documentedPackages } from '@/lib/registry'

export const alt =
  'TypeWire documentation — reference for every package, rendered from the packages themselves'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  const pages = documentedPackages.reduce(
    (total, pkg) => total + pkg.docs.pages.length,
    0
  )

  return ogImage({
    eyebrow: 'docs',
    title: 'Reference',
    description:
      'Every page is rendered from the package it documents — its own markdown, in its own directory, in this repository.',
    accent: ACCENT.blue,
    chips: [
      `${documentedPackages.length} packages`,
      `${pages} pages`,
      'version-checked in CI',
    ],
  })
}
