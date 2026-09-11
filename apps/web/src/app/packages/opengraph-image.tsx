import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og'
import { packages, publishedPackages } from '@/lib/registry'

export const alt = 'Every package in the TypeWire ecosystem'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogImage({
    eyebrow: 'packages',
    title: `${packages.length} packages, one contract`,
    description:
      'Versions, sizes, dependencies and release history are derived from the monorepo at build time — never maintained by hand.',
    accent: ACCENT.purple,
    chips: [
      `${publishedPackages.length} published`,
      'zero-dep core',
      'size-budgeted',
    ],
  })
}
