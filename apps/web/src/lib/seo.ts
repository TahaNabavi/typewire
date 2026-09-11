/**
 * Everything a crawler reads, in one place.
 *
 * Two rules hold the site's SEO together, and both are enforced here rather
 * than remembered at each call site:
 *
 *   1. Every indexable page declares its own canonical URL. Without one, a page
 *      reachable at more than one address (a trailing slash, a `?ref=` from a
 *      newsletter, a preview deployment) splits its own ranking.
 *   2. Every page's social card and its <title>/<meta description> come from
 *      the same strings, so a link never promises something the page doesn't
 *      say.
 *
 * `pageMetadata()` returns both, from one object. `metadataBase` in the root
 * layout resolves the relative paths, so nothing here hardcodes the origin.
 */

import type { Metadata } from 'next'

import { site } from '@/config/site'
import type { DocPage, PackageEntry } from '@/lib/registry'

/** Absolute URL for a site-relative path — schema.org needs fully qualified. */
export function absoluteUrl(path = '/'): string {
  return new URL(path, site.url).toString()
}

/**
 * A description Google will print whole.
 *
 * Result snippets are cut at roughly 160 characters, mid-word and without an
 * ellipsis, so a long description does not merely get shortened — it gets
 * shortened badly. Descriptions written for this site are written to fit; this
 * is for the ones that are not ours to rewrite, like a package's own
 * `package.json` description.
 *
 * (`excerpt()` in lib/markdown.ts is the markdown-aware sibling of this — it
 * strips syntax first, then cuts by the same rule.)
 */
export function clampDescription(text: string, limit = 158): string {
  const plain = text.replace(/\s+/g, ' ').trim()
  if (plain.length <= limit) return plain

  const window = plain.slice(0, limit)
  // Prefer ending on a sentence; fall back to a word, never mid-word.
  const sentence = window.lastIndexOf('. ')
  if (sentence > limit * 0.55) return window.slice(0, sentence + 1)
  return `${window
    .slice(0, window.lastIndexOf(' '))
    .replace(/[,;:—-]+$/, '')
    .trim()}…`
}

interface PageSeo {
  /** Fills the `%s` in the root layout's title template. */
  title: string
  /** ~155 characters is what a result snippet shows; longer is truncated. */
  description: string
  /** Site-relative, leading slash, no trailing slash. Becomes the canonical. */
  path: string
  /** `article` for a documentation page, `website` for a section landing. */
  type?: 'website' | 'article'
  /** ISO date, for docs pages that describe a released version. */
  publishedTime?: string
  keywords?: readonly string[]
  /** Set on pages that exist for a signed-in human rather than for a reader. */
  noIndex?: boolean
}

/**
 * The metadata every page exports.
 *
 * Note what is *not* set: `openGraph.images`. Next resolves the segment's
 * `opengraph-image.tsx` into it automatically, and naming an image here would
 * override the one the section actually generates.
 */
export function pageMetadata({
  title,
  description,
  path,
  type = 'website',
  publishedTime,
  keywords,
  noIndex,
}: PageSeo): Metadata {
  const url = absoluteUrl(path)
  // "TypeWire · TypeWire" is what the plain form produces for the home page.
  const social =
    title === site.name
      ? `${site.name} \u2014 ${site.tagline}`
      : `${title} \u00b7 ${site.name}`

  return {
    title,
    description,
    ...(keywords ? { keywords: [...keywords] } : {}),
    alternates: { canonical: url },
    openGraph: {
      type,
      url,
      title: social,
      description,
      siteName: site.name,
      locale: site.locale,
      ...(publishedTime ? { publishedTime } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: social,
      description,
      creator: site.twitter.creator,
    },
    ...(noIndex ? { robots: { index: false, follow: false } } : {}),
  }
}

/* -------------------------------------------------------------------------
   Structured data
   -------------------------------------------------------------------------
   Google reads JSON-LD to decide what a page *is* rather than guessing from
   its markup, and it is the only channel that can say "these twelve pages are
   one software project". Each builder below returns a plain object; render it
   with <JsonLd>, which is what escapes it.
   ------------------------------------------------------------------------- */

type Json = Record<string, unknown>

/** Stable @id values, so separate nodes on separate pages refer to one entity. */
export const ID = {
  site: absoluteUrl('/#website'),
  organization: absoluteUrl('/#organization'),
  software: absoluteUrl('/#software'),
  author: absoluteUrl('/#author'),
} as const

export function organizationSchema(): Json {
  return {
    '@type': 'Organization',
    '@id': ID.organization,
    name: site.name,
    url: site.url,
    logo: absoluteUrl('/icon.svg'),
    description: site.summary,
    sameAs: [
      site.repo.url,
      'https://www.npmjs.com/org/tahanabavi',
      site.author.url,
    ],
    founder: {
      '@type': 'Person',
      '@id': ID.author,
      name: site.author.name,
      url: site.author.url,
    },
  }
}

export function websiteSchema(): Json {
  return {
    '@type': 'WebSite',
    '@id': ID.site,
    name: site.name,
    alternateName: `${site.name} — ${site.tagline}`,
    url: site.url,
    description: site.description,
    inLanguage: 'en',
    publisher: { '@id': ID.organization },
  }
}

/**
 * The project itself, as a thing rather than as a website. `SoftwareApplication`
 * with a DeveloperApplication category is what a library is closest to in
 * schema.org's vocabulary; `offers` at price 0 is how "free and open source"
 * is expressed there.
 */
export function softwareSchema(
  packageCount: number,
  version: string | null
): Json {
  return {
    '@type': 'SoftwareApplication',
    '@id': ID.software,
    name: site.name,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'TypeScript library',
    operatingSystem: 'Node.js 18+, Bun, Deno, browsers',
    url: site.url,
    downloadUrl: 'https://www.npmjs.com/org/tahanabavi',
    codeRepository: site.repo.url,
    programmingLanguage: 'TypeScript',
    description: site.summary,
    ...(version ? { softwareVersion: version } : {}),
    license: `${site.repo.url}/blob/${site.repo.branch}/LICENSE`,
    author: {
      '@type': 'Person',
      '@id': ID.author,
      name: site.author.name,
      url: site.author.url,
    },
    publisher: { '@id': ID.organization },
    keywords: site.keywords.join(', '),
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' },
    isPartOf: { '@id': ID.site },
    about: `${packageCount} packages sharing one contract format`,
  }
}

/** The trail Google prints under a result instead of the raw URL. */
export function breadcrumbSchema(
  trail: Array<{ name: string; path: string }>
): Json {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  }
}

export function faqSchema(
  items: ReadonlyArray<{ q: string; a: string }>
): Json {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/** A section that is a list of things — /packages, /examples. */
export function collectionSchema(
  name: string,
  description: string,
  path: string,
  items: Array<{ name: string; path: string }>
): Json {
  return {
    '@type': 'CollectionPage',
    name,
    description,
    url: absoluteUrl(path),
    isPartOf: { '@id': ID.site },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: item.name,
        url: absoluteUrl(item.path),
      })),
    },
  }
}

/** One npm package, described as source code rather than as a web page. */
export function packageSchema(pkg: PackageEntry): Json {
  return {
    '@type': 'SoftwareSourceCode',
    name: pkg.npm,
    alternateName: pkg.short,
    description: pkg.description,
    url: absoluteUrl(`/packages/${pkg.slug}`),
    codeRepository: `${site.repo.url}/tree/${site.repo.branch}/${pkg.path}`,
    programmingLanguage: { '@type': 'ComputerLanguage', name: 'TypeScript' },
    runtimePlatform: 'Node.js',
    ...(pkg.version ? { softwareVersion: pkg.version } : {}),
    ...(pkg.keywords.length > 0 ? { keywords: pkg.keywords.join(', ') } : {}),
    license: `${site.repo.url}/blob/${site.repo.branch}/LICENSE`,
    author: {
      '@type': 'Person',
      '@id': ID.author,
      name: site.author.name,
      url: site.author.url,
    },
    isPartOf: { '@id': ID.software },
  }
}

/** A documentation page. `TechArticle` is what Google expects for reference docs. */
export function docSchema(
  pkg: PackageEntry,
  page: DocPage,
  description: string,
  modified?: string
): Json {
  return {
    '@type': 'TechArticle',
    headline: `${page.title} · ${pkg.short}`,
    description,
    url: absoluteUrl(`/docs/${pkg.slug}/${page.slug}`),
    inLanguage: 'en',
    ...(modified ? { dateModified: modified } : {}),
    author: {
      '@type': 'Person',
      '@id': ID.author,
      name: site.author.name,
      url: site.author.url,
    },
    publisher: { '@id': ID.organization },
    isPartOf: { '@id': ID.site },
    about: { '@type': 'SoftwareSourceCode', name: pkg.npm },
    ...(page.headings.length > 0
      ? {
          articleSection: page.headings
            .filter((h) => h.depth === 2)
            .map((h) => h.text),
        }
      : {}),
  }
}

/**
 * Wraps the nodes a page emits into one `@graph`, which is how several entities
 * share one script tag without repeating `@context` — and how `@id` references
 * between them resolve.
 */
export function graph(...nodes: Json[]): Json {
  return { '@context': 'https://schema.org', '@graph': nodes }
}
