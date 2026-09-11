import type { Metadata } from 'next'

import { JsonLd } from '@/components/shared/json-ld'
import { site } from '@/config/site'
import { HomePage } from '@/features/home'
import { faq } from '@/features/support/constants'
import { faqSchema, graph, pageMetadata } from '@/lib/seo'
import { PATHS } from '@/routes/paths'

/**
 * The home page keeps the layout's title rather than adding one — "TypeWire ·
 * TypeWire" is what the template would produce — so only the canonical and the
 * fuller description are set here.
 */
export const metadata: Metadata = {
  ...pageMetadata({
    title: site.name,
    description: site.metaDescription,
    path: PATHS.ROOT,
    keywords: site.keywords,
  }),
  title: { absolute: `${site.name} — ${site.tagline}` },
}

export default function Page() {
  return (
    <>
      {/* The FAQ is on this page, in the Support section — the questions and
          answers a crawler reads here are the ones a reader can open below. */}
      <JsonLd data={graph(faqSchema(faq))} />
      <HomePage />
    </>
  )
}
