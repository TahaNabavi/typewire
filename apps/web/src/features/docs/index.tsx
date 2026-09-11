import Link from 'next/link'
import { notFound } from 'next/navigation'

import { JsonLd } from '@/components/shared/json-ld'
import { site } from '@/config/site'
import {
  excerpt,
  renderMarkdown,
  stripReadmeChrome,
} from '@/features/docs/markdown'
import { DocsShell } from '@/features/docs/shell'
import { generatedAt, getDocPage, getPackage } from '@/lib/registry'
import { breadcrumbSchema, docSchema, graph } from '@/lib/seo'

export async function DocsPage({
  pkgSlug,
  pageSlug,
}: {
  pkgSlug: string
  pageSlug: string
}) {
  const pkg = getPackage(pkgSlug)
  const page = pkg && getDocPage(pkg, pageSlug)
  if (!pkg || !page) notFound()

  // A README opens with a banner and an H1 repeating the package name, both of
  // which the shell already renders above.
  const markdown = page.isReadme
    ? stripReadmeChrome(page.markdown)
    : page.markdown
  const html = await renderMarkdown(markdown)

  // The same sentence generateMetadata puts in the description, so the page and
  // its structured data never disagree about what the page is.
  const description = excerpt(page.markdown) ?? pkg.description

  const pages = pkg.docs?.pages ?? []
  const index = pages.findIndex((p) => p.slug === page.slug)
  const previous = index > 0 ? pages[index - 1] : null
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : null

  return (
    <DocsShell pkg={pkg} activeSlug={page.slug} headings={page.headings}>
      <JsonLd
        data={graph(
          docSchema(pkg, page, description, generatedAt),
          breadcrumbSchema([
            { name: 'TypeWire', path: '/' },
            { name: 'Docs', path: '/docs' },
            { name: pkg.short, path: `/docs/${pkg.slug}` },
            { name: page.title, path: `/docs/${pkg.slug}/${page.slug}` },
          ])
        )}
      />

      <article
        className="max-w-none"
        // Our own repository's markdown, rendered on the server at build time.
        // Nothing user-supplied reaches this — see lib/markdown.ts.
        dangerouslySetInnerHTML={{ __html: html }}
      />

      <footer className="mt-14 border-t border-hair pt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {previous ? (
            <Link
              href={`/docs/${pkg.slug}/${previous.slug}`}
              className="text-sm text-blue hover:underline"
            >
              ← {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/docs/${pkg.slug}/${next.slug}`}
              className="text-sm text-blue hover:underline"
            >
              {next.title} →
            </Link>
          )}
        </div>

        <p className="mt-6 font-mono text-[11px] text-dim">
          Rendered from{' '}
          <a
            href={`${site.repo.url}/blob/${site.repo.branch}/${page.path}`}
            target="_blank"
            rel="noreferrer"
            className="text-blue hover:underline"
          >
            {page.path}
          </a>{' '}
          — edit that file and this page follows.
        </p>
      </footer>
    </DocsShell>
  )
}
