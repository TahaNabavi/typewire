import { RoadmapSection } from '@/features/roadmap'
import { JsonLd } from '@/components/shared/json-ld'
import { breadcrumbSchema, graph, pageMetadata } from '@/lib/seo'

export const metadata = pageMetadata({
  title: 'Roadmap',
  description:
    'What has shipped and what is next, read from the repository README at build time \u2014 so the plan on this page is the plan in the repo, not a copy of it.',
  path: '/roadmap',
  keywords: [
    'TypeWire roadmap',
    'API surface lockfile',
    'contract drift detection',
  ],
})

export default function RoadmapPage() {
  return (
    <>
      <JsonLd
        data={graph(
          breadcrumbSchema([
            { name: 'TypeWire', path: '/' },
            { name: 'Roadmap', path: '/roadmap' },
          ])
        )}
      />
      <RoadmapSection />
    </>
  )
}
