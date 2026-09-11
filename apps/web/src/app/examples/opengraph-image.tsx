import { ACCENT, OG_CONTENT_TYPE, OG_SIZE, ogImage } from '@/lib/og'
import { examples } from '@/lib/registry'

export const alt =
  'Runnable TypeWire examples that build against the packages in the repository'
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return ogImage({
    eyebrow: 'examples',
    title: 'Runnable, and self-asserting',
    description:
      'Every example builds against the packages in this repo rather than a published version, so it cannot drift from the source.',
    accent: ACCENT.amber,
    chips: [`${examples.length} examples`, 'headless', 'run in CI'],
  })
}
