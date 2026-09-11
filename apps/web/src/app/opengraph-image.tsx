import { site } from '@/config/site'
import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og'
import { install, packages, publishedPackages } from '@/lib/registry'

/**
 * The site's card, and the one every other section is a variation of. It is
 * also the fallback: a route with no `opengraph-image.tsx` of its own inherits
 * this from the root layout, so no page can ever unfurl without an image.
 */
export const alt = `${site.name} — ${site.tagline}`
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogImage({
    eyebrow: 'one contract',
    title: site !== null && site !== undefined ? site.tagline : '',
    description: site !== null && site !== undefined ? site.description : '',
    accent: ACCENT.cyan,
    chips: [
      `${Array.isArray(packages) ? packages.length : 0} packages`,
      `${Array.isArray(publishedPackages) ? publishedPackages.length : 0} on npm`,
      '0 runtime deps',
      install !== null &&
      install !== undefined &&
      typeof install.available === 'boolean'
        ? install.available
          ? install.primary
          : install.today
        : '',
    ],
  })
}
